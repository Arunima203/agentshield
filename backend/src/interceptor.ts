/**
 * interceptor.ts
 *
 * The core AgentShield pipeline:
 *   ToolCall → Secrets Scan → Deterministic Risk Assessment → LLM Semantic Analysis → Combined Score → Decision → Approval Gate → Audit
 */

import { v4 as uuidv4 } from "uuid";
import { getConfig } from "./config";
import { assessRisk } from "./riskDetector";
import { scanAndRedact } from "./secretsScanner";
import { createApprovalRequest, autoApprove, autoBlock } from "./approvalGate";
import { writeAuditEntry } from "./auditLogger";
import { logger } from "./logger";
import { getLLMService, type LLMSecurityAnalysis } from "./llmService";
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

// ─── Combine deterministic and LLM scores ────────────────────────────────────

function combineScores(
  deterministicScore: number,
  llmAnalysis: LLMSecurityAnalysis,
  config: any
): { finalScore: number; sources: string[] } {
  // If LLM is unavailable, use deterministic score
  if (!llmAnalysis.llm_available || llmAnalysis.risk_score === null) {
    return {
      finalScore: deterministicScore,
      sources: ["deterministic"],
    };
  }

  // Weight: 60% deterministic, 40% LLM semantic
  const llmWeight = 0.4;
  const detWeight = 0.6;

  const combinedScore = Math.round(
    deterministicScore * detWeight + llmAnalysis.risk_score * llmWeight
  );

  return {
    finalScore: Math.min(100, Math.max(0, combinedScore)),
    sources: ["deterministic", "llm_semantic"],
  };
}

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

  // ── Step 1: Secrets scan ──────────────────────────────────────────────────
  const { sanitized: sanitizedArgs, findings: secretFindings } = scanAndRedact(toolCall.args);

  // ── Step 2: Deterministic risk assessment ─────────────────────────────────
  const riskAssessment = assessRisk({ ...toolCall, args: sanitizedArgs as Record<string, unknown> });

  // ── Step 3: LLM semantic analysis ──────────────────────────────────────────
  let llmAnalysis: LLMSecurityAnalysis;
  const enableLLM = process.env.ENABLE_LLM !== "false";

  if (enableLLM) {
    try {
      const llmService = getLLMService();
      llmAnalysis = await llmService.analyze({
        tool: toolCall.tool,
        arguments: sanitizedArgs as Record<string, any>,
        agent_id: toolCall.agentId,
        context: {
          sessionId: toolCall.sessionId,
          secretsDetected: secretFindings.length > 0,
        },
      });
      logger.info(
        CTX,
        `LLM analysis for "${toolCall.tool}": score=${llmAnalysis.risk_score}, decision=${llmAnalysis.decision}`
      );
    } catch (error) {
      logger.warn(CTX, `LLM analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      llmAnalysis = {
        risk_score: null,
        severity: "UNKNOWN",
        decision: "REVIEW",
        categories: [],
        reason: "LLM analysis unavailable",
        safe_alternative: null,
        confidence: 0.0,
        model: "unavailable",
        llm_available: false,
      };
    }
  } else {
    llmAnalysis = {
      risk_score: null,
      severity: "UNKNOWN",
      decision: "REVIEW",
      categories: [],
      reason: "LLM analysis disabled",
      safe_alternative: null,
      confidence: 0.0,
      model: "disabled",
      llm_available: false,
    };
  }

  // ── Step 4: Combine scores ────────────────────────────────────────────────
  const { finalScore, sources: scoreSources } = combineScores(
    riskAssessment.riskScore,
    llmAnalysis,
    config
  );

  // ── Step 5: Determine decision ────────────────────────────────────────────
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
    // Auto mode — use combined risk score thresholds
    // CRITICAL: Check requireApproval BEFORE block threshold
    // This allows high-risk tools (90, 85) to reach human approval instead of auto-blocking
    if (
      riskAssessment.requireApproval ||
      finalScore >= config.risk.review_threshold
    ) {
      // Tool marked for approval OR score between review and block thresholds
      decision = "require_approval";
      approvalStatus = "pending";
    } else if (finalScore >= config.risk.block_threshold) {
      // Score exceeds block threshold AND not marked for approval
      decision = "block";
      approvalStatus = "auto_blocked";
    } else {
      // Low risk
      decision = "allow";
      approvalStatus = "auto_approved";
    }
  }

  // ── Step 6: Build InspectionResult ───────────────────────────────────────
  const inspection: InspectionResult = {
    toolCallId: toolCall.id,
    tool: toolCall.tool,
    riskScore: finalScore, // Combined score
    riskLevel: riskAssessment.riskLevel,
    decision,
    riskFindings: riskAssessment.findings,
    secretFindings,
    blockedPatternMatch: riskAssessment.blockedPattern?.name,
    sanitizedArgs: sanitizedArgs as Record<string, unknown>,
    inspectedAt: now,
    llmAnalysis: llmAnalysis.llm_available ? {
      score: llmAnalysis.risk_score,
      severity: llmAnalysis.severity,
      decision: llmAnalysis.decision,
      categories: llmAnalysis.categories,
      reason: llmAnalysis.reason,
      confidence: llmAnalysis.confidence,
      model: llmAnalysis.model,
    } : undefined,
    scoreSources: scoreSources,
  };

  // ── Step 7: Approval request ──────────────────────────────────────────────
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

  // ── Step 8: Audit log ─────────────────────────────────────────────────────
  const auditEntry: AuditEntry = {
    id: uuidv4(),
    toolCallId: toolCall.id,
    tool: toolCall.tool,
    agentId: toolCall.agentId,
    sessionId: toolCall.sessionId,
    riskScore: finalScore,
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

  // ── Step 9: Response ──────────────────────────────────────────────────────
  const message = buildMessage(
    decision,
    finalScore,
    riskAssessment.blockedPattern?.reason,
    llmAnalysis
  );

  logger.info(
    CTX,
    `Decision for tool="${toolCall.tool}": ${decision.toUpperCase()} (score=${finalScore}, sources=${scoreSources.join("+")})`
  );

  return {
    toolCallId: toolCall.id,
    decision,
    riskScore: finalScore,
    riskLevel: riskAssessment.riskLevel,
    riskFindings: riskAssessment.findings,
    secretsDetected: secretFindings.length > 0,
    approvalRequestId,
    message,
    llmAnalysis: llmAnalysis.llm_available ? llmAnalysis : undefined,
  };
}

function buildMessage(
  decision: Decision,
  score: number,
  blockReason?: string,
  llmAnalysis?: LLMSecurityAnalysis
): string {
  const llmNote = llmAnalysis?.llm_available
    ? ` (semantic: ${llmAnalysis.risk_score}, deterministic: ${score})`
    : "";

  switch (decision) {
    case "allow":
      return `Tool call approved automatically (risk score: ${score}${llmNote})`;
    case "block":
      return `Tool call blocked${blockReason ? `: ${blockReason}` : ` due to high risk (score: ${score}${llmNote})`}`;
    case "require_approval":
      return `Tool call queued for human approval (risk score: ${score}${llmNote})`;
  }
}
