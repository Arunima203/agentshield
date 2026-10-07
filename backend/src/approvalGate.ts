/**
 * approvalGate.ts
 *
 * Manages the human-in-the-loop approval queue backed by sql.js.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb, updateAuditApproval } from "./auditLogger";
import { logger } from "./logger";
import { eventBus } from "./realtime/eventBus";
import { emitApprovalCreated, emitApprovalResolved } from "./realtime/socketServer";
import type {
  ApprovalRequest,
  ApprovalDecision,
  ApprovalStatus,
  InspectionResult,
  ToolCall,
} from "./types";

const CTX = "ApprovalGate";

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createApprovalRequest(
  toolCall: ToolCall,
  inspection: InspectionResult,
  timeoutMs?: number
): Promise<ApprovalRequest> {
  const db = await getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO approval_requests
       (id, tool_call_id, tool_call_json, inspection_json, status, created_at, timeout_ms)
     VALUES (?,?,?,?,?,?,?)`,
    [
      id,
      toolCall.id,
      JSON.stringify(toolCall),
      JSON.stringify(inspection),
      "pending",
      now,
      timeoutMs ?? null,
    ]
  );
  // flush is done by auditLogger on the shared db instance

  const approval = {
    id,
    toolCall,
    inspection,
    status: "pending",
    createdAt: now,
    timeoutMs,
  };

  logger.info(
    CTX,
    `Approval request created: id=${id} tool="${toolCall.tool}" score=${inspection.riskScore}`
  );

  // Emit real-time event for WebSocket clients
  try {
    await eventBus.publishApprovalCreated(approval);
    emitApprovalCreated(approval);
  } catch (error) {
    logger.warn(CTX, `Failed to emit approval:created event: ${error}`);
  }

  return approval;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
  const db = await getDb();
  const stmt = db.prepare("SELECT * FROM approval_requests WHERE id = ?");
  stmt.bind([id]);
  const exists = stmt.step();
  if (!exists) { stmt.free(); return null; }
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  return rowToRequest(row);
}

export async function listApprovalRequests(
  status?: ApprovalStatus,
  limit = 50
): Promise<ApprovalRequest[]> {
  const db = await getDb();

  let stmt;
  if (status) {
    stmt = db.prepare(
      "SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at DESC LIMIT ?"
    );
    stmt.bind([status, limit]);
  } else {
    stmt = db.prepare(
      "SELECT * FROM approval_requests ORDER BY created_at DESC LIMIT ?"
    );
    stmt.bind([limit]);
  }

  const rows: ApprovalRequest[] = [];
  while (stmt.step()) {
    rows.push(rowToRequest(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  return rows;
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

export async function resolveApproval(decision: ApprovalDecision): Promise<ApprovalRequest> {
  const now = new Date().toISOString();

  const existing = await getApprovalRequest(decision.requestId);
  if (!existing) {
    throw new Error(`Approval request "${decision.requestId}" not found`);
  }
  if (existing.status !== "pending") {
    throw new Error(
      `Approval request "${decision.requestId}" is already resolved (status: ${existing.status})`
    );
  }

  const newStatus: ApprovalStatus = decision.approved ? "approved" : "rejected";

  const db = await getDb();
  db.run(
    `UPDATE approval_requests
     SET status=?, resolved_at=?, resolved_by=?, rejection_reason=?
     WHERE id=?`,
    [
      newStatus,
      now,
      decision.resolvedBy,
      decision.rejectionReason ?? null,
      decision.requestId,
    ]
  );

  await updateAuditApproval(existing.toolCall.id, newStatus, now);

  const updated = { ...existing, status: newStatus, resolvedAt: now };

  logger.info(
    CTX,
    `Approval request ${decision.requestId} ${newStatus} by "${decision.resolvedBy}"`
  );

  // Emit real-time event for WebSocket clients
  try {
    await eventBus.publishApprovalResolved(updated);
    emitApprovalResolved(updated);
  } catch (error) {
    logger.warn(CTX, `Failed to emit approval:resolved event: ${error}`);
  }

  return updated;
}

// ─── Auto-resolve helpers ─────────────────────────────────────────────────────

export async function autoApprove(requestId: string, toolCallId: string): Promise<void> {
  const now = new Date().toISOString();
  const db = await getDb();
  db.run(
    `UPDATE approval_requests SET status='auto_approved', resolved_at=?, resolved_by='system' WHERE id=?`,
    [now, requestId]
  );
  await updateAuditApproval(toolCallId, "auto_approved", now);

  // Emit event
  try {
    const req = await getApprovalRequest(requestId);
    if (req) {
      await eventBus.publishApprovalResolved({ ...req, status: "auto_approved", resolvedAt: now });
      emitApprovalResolved({ ...req, status: "auto_approved", resolvedAt: now });
    }
  } catch (error) {
    logger.warn(CTX, `Failed to emit auto-approve event: ${error}`);
  }
}

export async function autoBlock(requestId: string, toolCallId: string): Promise<void> {
  const now = new Date().toISOString();
  const db = await getDb();
  db.run(
    `UPDATE approval_requests SET status='auto_blocked', resolved_at=?, resolved_by='system' WHERE id=?`,
    [now, requestId]
  );
  await updateAuditApproval(toolCallId, "auto_blocked", now);

  // Emit event
  try {
    const req = await getApprovalRequest(requestId);
    if (req) {
      await eventBus.publishApprovalResolved({ ...req, status: "auto_blocked", resolvedAt: now });
      emitApprovalResolved({ ...req, status: "auto_blocked", resolvedAt: now });
    }
  } catch (error) {
    logger.warn(CTX, `Failed to emit auto-block event: ${error}`);
  }
}

// ─── Timeout sweep ────────────────────────────────────────────────────────────

export async function sweepTimeouts(): Promise<number> {
  const db = await getDb();
  const now = Date.now();

  const stmt = db.prepare(
    `SELECT id, tool_call_id, created_at, timeout_ms
     FROM approval_requests
     WHERE status = 'pending' AND timeout_ms IS NOT NULL`
  );

  const toTimeout: Array<{ id: string; tool_call_id: string }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: string;
      tool_call_id: string;
      created_at: string;
      timeout_ms: number;
    };
    const created = new Date(row.created_at).getTime();
    if (now - created >= row.timeout_ms) {
      toTimeout.push({ id: row.id, tool_call_id: row.tool_call_id });
    }
  }
  stmt.free();

  for (const item of toTimeout) {
    const ts = new Date().toISOString();
    db.run(
      `UPDATE approval_requests SET status='timeout', resolved_at=? WHERE id=?`,
      [ts, item.id]
    );
    await updateAuditApproval(item.tool_call_id, "timeout", ts);
    logger.warn(CTX, `Approval request ${item.id} timed out`);

    // Emit event
    try {
      const req = await getApprovalRequest(item.id);
      if (req) {
        await eventBus.publishApprovalResolved({ ...req, status: "timeout", resolvedAt: ts });
        emitApprovalResolved({ ...req, status: "timeout", resolvedAt: ts });
      }
    } catch (error) {
      logger.warn(CTX, `Failed to emit timeout event: ${error}`);
    }
  }

  return toTimeout.length;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToRequest(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: row.id as string,
    toolCall: JSON.parse(row.tool_call_json as string) as ToolCall,
    inspection: JSON.parse(row.inspection_json as string) as InspectionResult,
    status: row.status as ApprovalStatus,
    createdAt: row.created_at as string,
    resolvedAt: row.resolved_at as string | undefined,
    resolvedBy: row.resolved_by as string | undefined,
    rejectionReason: row.rejection_reason as string | undefined,
    timeoutMs: row.timeout_ms as number | undefined,
  };
}
