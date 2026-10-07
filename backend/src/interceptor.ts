/**
 * interceptor.ts
 *
 * The core AgentShield pipeline:
 *   ToolCall → Risk Assessment → Secrets Scan → Decision → Approval Gate → Audit
 */

import { v4 as uuidv4 } from "uuid";
import { getConfig } from "./config";
import { assessRisk } from "./riskDetector";
import { scanAndRedact } from "./secretsScanner";
import { createApprovalRequest, autoApprove, autoBlock } from "./approvalGate";
import { writeAuditEntry } from "./auditLogger";
import { logger } from "./logger";
import type {
  ToolCall,
  InspectionResult,
  Decision,
  ApprovalStatus,
  AuditEntry,
  InspectRequest,
  InspectResponse,
} from "./types";

const CTX = "Interceptor";

// ─── Inspect a tool call ─────────────────────────────────────────────────────

export async function inspect(req: InspectRequest): Promise<InspectResponse> {
  const config = getConfig();
  const now = new Date().toISOString();

  const toolCall: ToolCall = {
    id: uuidv4(),
    tool: req.tool,
    args: req.args,
    agentId: req.agentId,
    sessionId: req.sessionId,
    metadata: req.metadata,
    timestamp: now,
  };

  logger.info(CTX, `Inspecting tool call: id=${toolCall.id} tool="${toolCall.tool}"`);

  try {
    // ── Step 1: Secrets scan ──────────────────────────────────────────────────
    const { sanitized: sanitizedArgs, findings: secretFindings } = scanAndRedact(toolCall.args);

    // ── Step 2: Risk assessment ───────────────────────────────────────────────
    const riskAssessment = assessRisk({ ...toolCall, args: sanitizedArgs as Record<string, unknown> });

    // ── Step 3: Determine decision ────────────────────────────────────────────
    let decision: Decision;
    let approvalStatus: ApprovalStatus;

    const approvalMode = (process.env.APPROVAL_MODE ?? "auto") as "auto" | "strict" | "audit";

    if (riskAssessment.blockedPattern) {
      decision = "block";
      approvalStatus = "auto_blocked";
    } else if (approvalMode === "audit") {
      decision = "allow";
      approvalStatus = "auto_approved";
    } else if (approvalMode === "strict") {
      decision = "require_approval";
      approvalStatus = "pending";
    } else {
      // Auto mode — use risk thresholds
      if (riskAssessment.riskScore >= config.risk.block_threshold) {
        decision = "block";
        approvalStatus = "auto_blocked";
      } else if (
        riskAssessment.riskScore >= config.risk.review_threshold ||
        riskAssessment.requireApproval
      ) {
        decision = "require_approval";
        approvalStatus = "pending";
      } else {
        decision = "allow";
        approvalStatus = "auto_approved";
      }
    }

    // ── Step 4: Build InspectionResult ───────────────────────────────────────
    const inspection: InspectionResult = {
      toolCallId: toolCall.id,
      tool: toolCall.tool,
      riskScore: riskAssessment.riskScore,
      riskLevel: riskAssessment.riskLevel,
      decision,
      riskFindings: riskAssessment.findings,
      secretFindings,
      blockedPatternMatch: riskAssessment.blockedPattern?.name,
      sanitizedArgs: sanitizedArgs as Record<string, unknown>,
      inspectedAt: now,
    };

    // ── Step 5: Approval request ──────────────────────────────────────────────
    let approvalRequestId: string | undefined;

    if (decision === "require_approval") {
      const approvalReq = await createApprovalRequest(toolCall, inspection);
      approvalRequestId = approvalReq.id;
      logger.info(CTX, `Approval required — request id=${approvalRequestId} for tool="${toolCall.tool}"`);
    } else {
      // Still persist an already-resolved approval record for full audit trail
      const rec = await createApprovalRequest(toolCall, inspection);
      if (decision === "allow") {
        await autoApprove(rec.id, toolCall.id);
      } else {
        await autoBlock(rec.id, toolCall.id);
      }
    }

    // ── Step 6: Audit log ─────────────────────────────────────────────────────
    const auditEntry: AuditEntry = {
      id: uuidv4(),
      toolCallId: toolCall.id,
      tool: toolCall.tool,
      agentId: toolCall.agentId,
      sessionId: toolCall.sessionId,
      riskScore: riskAssessment.riskScore,
      riskLevel: riskAssessment.riskLevel,
      decision,
      approvalStatus,
      riskFindings: JSON.stringify(riskAssessment.findings),
      secretFindings: JSON.stringify(
        secretFindings.map((f) => ({ name: f.name, argKey: f.argKey }))
      ),
      sanitizedArgsSnapshot: JSON.stringify(sanitizedArgs),
      createdAt: now,
    };

    await writeAuditEntry(auditEntry);

    // ── Step 7: Response ──────────────────────────────────────────────────────
    const message = buildMessage(decision, riskAssessment.riskScore, riskAssessment.blockedPattern?.reason);

    logger.info(
      CTX,
      `Decision for tool="${toolCall.tool}": ${decision.toUpperCase()} (score=${riskAssessment.riskScore})`
    );

    return {
      toolCallId: toolCall.id,
      decision,
      riskScore: riskAssessment.riskScore,
      riskLevel: riskAssessment.riskLevel,
      riskFindings: riskAssessment.findings,
      secretsDetected: secretFindings.length > 0,
      approvalRequestId,
      message,
    };
  } catch (error) {
    // Log error with context
    logger.error(CTX, `Inspection failed for tool "${req.tool}": ${error instanceof Error ? error.message : String(error)}`, {
      toolId: req.tool,
      error: error instanceof Error ? error.stack : String(error),
    });

    // Fallback: Return default allow response with rule-based scoring
    const fallbackRiskScore = 50; // Medium risk fallback
    const now = new Date().toISOString();

    const toolCall: ToolCall = {
      id: uuidv4(),
      tool: req.tool,
      args: req.args,
      agentId: req.agentId,
      sessionId: req.sessionId,
      metadata: req.metadata,
      timestamp: now,
    };

    // Still write audit entry with error indicator
    const auditEntry: AuditEntry = {
      id: uuidv4(),
      toolCallId: toolCall.id,
      tool: req.tool,
      agentId: req.agentId,
      sessionId: req.sessionId,
      riskScore: fallbackRiskScore,
      riskLevel: "medium",
      decision: "allow", // Fail-safe: allow on error
      approvalStatus: "auto_approved",
      riskFindings: JSON.stringify([{ name: "Inspection Error", severity: "medium" }]),
      secretFindings: JSON.stringify([]),
      sanitizedArgsSnapshot: JSON.stringify(req.args),
      createdAt: now,
    };

    try {
      await writeAuditEntry(auditEntry);
    } catch (auditErr) {
      logger.error(CTX, `Failed to write fallback audit entry: ${auditErr}`);
    }

    return {
      toolCallId: toolCall.id,
      decision: "allow",
      riskScore: fallbackRiskScore,
      riskLevel: "medium",
      riskFindings: [{ severity: "medium" as const, rule: "inspection_error", reason: "Fallback decision due to inspection error" }],
      secretsDetected: false,
      message: "Tool call approved with fallback scoring (inspection error occurred)",
    };
  }
}

function buildMessage(decision: Decision, score: number, blockReason?: string): string {
  switch (decision) {
    case "allow":
      return `Tool call approved automatically (risk score: ${score})`;
    case "block":
      return `Tool call blocked${blockReason ? `: ${blockReason}` : ` due to high risk (score: ${score})`}`;
    case "require_approval":
      return `Tool call queued for human approval (risk score: ${score})`;
  }
}
