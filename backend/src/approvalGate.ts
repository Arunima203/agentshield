/**
 * approvalGate.ts
 *
 * Manages the human-in-the-loop approval queue backed by PostgreSQL.
 * Replaces sql.js with production-grade database.
 */

import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, transaction } from './database';
import { logger } from './logger';
import type {
  ApprovalRequest,
  ApprovalDecision,
  ApprovalStatus,
  AuditEntry,
  InspectionResult,
  ToolCall,
} from './types';

const CTX = 'ApprovalGate';

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createApprovalRequest(
  toolCall: ToolCall,
  inspection: InspectionResult,
  auditEntry: AuditEntry,
  timeoutMs?: number
): Promise<ApprovalRequest> {
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    const auditSql = `
      INSERT INTO audit_log (
        id, tool_call_id, tool, agent_id, session_id,
        risk_score, risk_level, decision, approval_status,
        risk_findings, secret_findings, sanitized_args_snapshot, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;
    const approvalSql = `
      INSERT INTO approval_requests (
        id, tool_call_id, tool_call_json, inspection_json, 
        status, created_at, timeout_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    await transaction(async (t) => {
      await t.none(auditSql, [
        auditEntry.id,
        auditEntry.toolCallId,
        auditEntry.tool,
        auditEntry.agentId || null,
        auditEntry.sessionId || null,
        auditEntry.riskScore,
        auditEntry.riskLevel,
        auditEntry.decision,
        auditEntry.approvalStatus,
        auditEntry.riskFindings || null,
        auditEntry.secretFindings || null,
        auditEntry.sanitizedArgsSnapshot || null,
        auditEntry.createdAt,
      ]);
      await t.none(approvalSql, [
        id,
        toolCall.id,
        JSON.stringify(toolCall),
        JSON.stringify(inspection),
        'pending',
        now,
        timeoutMs ?? null,
      ]);
    });

    logger.info(
      CTX,
      `Approval request created: id=${id} tool="${toolCall.tool}" score=${inspection.riskScore}`
    );

    return {
      id,
      toolCall,
      inspection,
      status: 'pending',
      createdAt: now,
      timeoutMs,
    };
  } catch (error) {
    logger.error(CTX, `Failed to create approval request: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function updateAuditApprovalInTransaction(
  t: any,
  toolCallId: string,
  status: ApprovalStatus,
  timestamp: string
): Promise<void> {
  await t.none(
    'UPDATE audit_log SET approval_status = $1, updated_at = $2 WHERE tool_call_id = $3',
    [status, timestamp, toolCallId]
  );
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
  try {
    const sql = 'SELECT * FROM approval_requests WHERE id = $1';
    const row = await queryOne<any>(sql, [id]);

    if (!row) return null;

    return {
      id: row.id,
      toolCall: JSON.parse(row.tool_call_json),
      inspection: JSON.parse(row.inspection_json),
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      rejectionReason: row.rejection_reason,
      timeoutMs: row.timeout_ms,
    };
  } catch (error) {
    logger.error(CTX, `Failed to get approval request: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function listApprovalRequests(
  status?: ApprovalStatus,
  limit = 50
): Promise<ApprovalRequest[]> {
  try {
    let sql = 'SELECT * FROM approval_requests';
    const params: any[] = [];

    if (status) {
      sql += ' WHERE status = $1';
      params.push(status);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);
    } else {
      sql += ` ORDER BY created_at DESC LIMIT $1`;
      params.push(limit);
    }

    const rows = await query<any>(sql, params);

    return rows.map((row) => ({
      id: row.id,
      toolCall: JSON.parse(row.tool_call_json),
      inspection: JSON.parse(row.inspection_json),
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      rejectionReason: row.rejection_reason,
      timeoutMs: row.timeout_ms,
    }));
  } catch (error) {
    logger.error(CTX, `Failed to list approval requests: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

export async function resolveApproval(decision: ApprovalDecision): Promise<ApprovalRequest> {
  try {
    const existing = await getApprovalRequest(decision.requestId);
    if (!existing) {
      throw new Error(`Approval request "${decision.requestId}" not found`);
    }
    if (existing.status !== 'pending') {
      throw new Error(
        `Approval request "${decision.requestId}" is already resolved (status: ${existing.status})`
      );
    }

    const newStatus: ApprovalStatus = decision.approved ? 'approved' : 'rejected';
    const now = new Date().toISOString();

    // Update approval request and audit log in transaction
    await transaction(async (t) => {
      const sql = `
        UPDATE approval_requests
        SET status = $1, resolved_at = $2, resolved_by = $3, rejection_reason = $4
        WHERE id = $5
      `;
      await t.none(sql, [newStatus, now, decision.resolvedBy, decision.rejectionReason ?? null, decision.requestId]);

      await updateAuditApprovalInTransaction(t, existing.toolCall.id, newStatus, now);
    });

    logger.info(
      CTX,
      `Approval request ${decision.requestId} ${newStatus} by "${decision.resolvedBy}"`
    );

    return { ...existing, status: newStatus, resolvedAt: now };
  } catch (error) {
    logger.error(CTX, `Failed to resolve approval: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ─── Auto-resolve helpers ─────────────────────────────────────────────────────

export async function autoApprove(requestId: string, toolCallId: string): Promise<void> {
  try {
    const now = new Date().toISOString();

    await transaction(async (t) => {
      const sql = `
        UPDATE approval_requests 
        SET status = 'auto_approved', resolved_at = $1, resolved_by = 'system' 
        WHERE id = $2
      `;
      await t.none(sql, [now, requestId]);
      await updateAuditApprovalInTransaction(t, toolCallId, 'auto_approved', now);
    });

    logger.debug(CTX, `Auto-approved: requestId=${requestId}`);
  } catch (error) {
    logger.error(CTX, `Failed to auto-approve: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function autoBlock(requestId: string, toolCallId: string): Promise<void> {
  try {
    const now = new Date().toISOString();

    await transaction(async (t) => {
      const sql = `
        UPDATE approval_requests 
        SET status = 'auto_blocked', resolved_at = $1, resolved_by = 'system' 
        WHERE id = $2
      `;
      await t.none(sql, [now, requestId]);
      await updateAuditApprovalInTransaction(t, toolCallId, 'auto_blocked', now);
    });

    logger.debug(CTX, `Auto-blocked: requestId=${requestId}`);
  } catch (error) {
    logger.error(CTX, `Failed to auto-block: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ─── Timeout sweep ────────────────────────────────────────────────────────────

export async function sweepTimeouts(): Promise<number> {
  try {
    const sql = `
      SELECT id, tool_call_id 
      FROM approval_requests
      WHERE status = 'pending' 
        AND timeout_ms IS NOT NULL
      AND CURRENT_TIMESTAMP - created_at >= timeout_ms * INTERVAL '1 millisecond'
    `;

    const toTimeout = await query<any>(sql);
    const now = new Date().toISOString();

    for (const item of toTimeout) {
      await transaction(async (t) => {
        const updateSql = `
          UPDATE approval_requests 
          SET status = 'timeout', resolved_at = $1 
          WHERE id = $2
        `;
        await t.none(updateSql, [now, item.id]);
        await updateAuditApprovalInTransaction(t, item.tool_call_id, 'timeout', now);
      });

      logger.warn(CTX, `Approval request ${item.id} timed out`);
    }

    return toTimeout.length;
  } catch (error) {
    logger.error(CTX, `Failed to sweep timeouts: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ─── Health Check ────────────────────────────────────────────────────────────

export async function healthCheck(): Promise<boolean> {
  try {
    await queryOne('SELECT COUNT(*) FROM approval_requests LIMIT 1');
    return true;
  } catch {
    return false;
  }
}
