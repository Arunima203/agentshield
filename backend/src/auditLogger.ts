/**
 * auditLogger.ts
 *
 * PostgreSQL-backed audit logging for all tool inspection decisions.
 * Replaces sql.js with production-grade PostgreSQL.
 */

import { v4 as uuidv4 } from 'uuid';
import { query, queryNone, queryOne, transaction } from './database';
import { logger } from './logger';
import type { AuditEntry, ApprovalStatus } from './types';

const CTX = 'AuditLogger';

// ─── Write Operations ────────────────────────────────────────────────────────

/**
 * Write an audit entry to the database.
 * Includes tool call details, risk assessment, and decision made.
 */
export async function writeAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    const sql = `
      INSERT INTO audit_log (
        id, tool_call_id, tool, agent_id, session_id, 
        risk_score, risk_level, decision, approval_status,
        risk_findings, secret_findings, sanitized_args_snapshot, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
      ON CONFLICT (tool_call_id) DO NOTHING
    `;

    await queryNone(sql, [
      entry.id,
      entry.toolCallId,
      entry.tool,
      entry.agentId || null,
      entry.sessionId || null,
      entry.riskScore,
      entry.riskLevel,
      entry.decision,
      entry.approvalStatus,
      entry.riskFindings || null,
      entry.secretFindings || null,
      entry.sanitizedArgsSnapshot || null,
      entry.createdAt,
    ]);

    logger.debug(CTX, `Audit entry written: id=${entry.id} tool="${entry.tool}"`);
  } catch (error) {
    logger.error(CTX, `Failed to write audit entry: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Update approval status in audit log after approval decision
 */
export async function updateAuditApproval(
  toolCallId: string,
  status: ApprovalStatus,
  timestamp: string
): Promise<void> {
  try {
    const sql = `
      UPDATE audit_log 
      SET approval_status = $1, updated_at = $2 
      WHERE tool_call_id = $3
    `;

    await queryNone(sql, [status, timestamp, toolCallId]);
    logger.debug(CTX, `Approval status updated: toolCallId=${toolCallId} status=${status}`);
  } catch (error) {
    logger.error(CTX, `Failed to update approval status: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ─── Read Operations ────────────────────────────────────────────────────────

/**
 * Get audit entries for a specific agent
 */
export async function getAuditEntriesForAgent(
  agentId: string,
  limit = 100
): Promise<any[]> {
  try {
    const sql = `
      SELECT * FROM audit_log 
      WHERE agent_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `;

    const results = await query(sql, [agentId, limit]);
    return (results || []) as any[];
  } catch (error) {
    logger.error(CTX, `Failed to get audit entries: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Query audit log - exported for routes/audit.ts compatibility
 */
export async function queryAuditLog(
  agentId?: string,
  startTime?: string,
  endTime?: string,
  limit = 100
): Promise<any[]> {
  try {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (agentId) {
      sql += ` AND agent_id = $${paramIndex++}`;
      params.push(agentId);
    }

    if (startTime) {
      sql += ` AND created_at >= $${paramIndex++}`;
      params.push(startTime);
    }

    if (endTime) {
      sql += ` AND created_at <= $${paramIndex++}`;
      params.push(endTime);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const results = await query(sql, params);
    return (results || []) as any[];
  } catch (error) {
    logger.error(CTX, `Failed to query audit log: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get audit entries within a time range
 */
export async function getAuditEntriesInRange(
  startTime: string,
  endTime: string,
  limit = 1000
): Promise<any[]> {
  try {
    const sql = `
      SELECT * FROM audit_log 
      WHERE created_at >= $1 AND created_at <= $2 
      ORDER BY created_at DESC 
      LIMIT $3
    `;

    const results = await query(sql, [startTime, endTime, limit]);
    return (results || []) as any[];
  } catch (error) {
    logger.error(CTX, `Failed to get audit entries in range: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get statistics for a time period - exported for routes/audit.ts compatibility
 */
export async function getAuditStats(startTime: string, endTime: string) {
  try {
    const sql = `
      SELECT 
        COUNT(*) as total_decisions,
        SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as allowed,
        SUM(CASE WHEN decision = 'require_approval' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) as blocked,
        AVG(risk_score) as avg_risk_score,
        MAX(risk_score) as max_risk_score,
        COUNT(DISTINCT agent_id) as unique_agents,
        COUNT(DISTINCT tool) as unique_tools
      FROM audit_log 
      WHERE created_at >= $1 AND created_at <= $2
    `;

    return await queryOne(sql, [startTime, endTime]);
  } catch (error) {
    logger.error(CTX, `Failed to get audit statistics: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get entries by decision type
 */
export async function getAuditByDecision(
  decision: string,
  limit = 100
): Promise<any[]> {
  try {
    const sql = `
      SELECT * FROM audit_log 
      WHERE decision = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `;

    const results = await query(sql, [decision, limit]);
    return (results || []) as any[];
  } catch (error) {
    logger.error(CTX, `Failed to get audit entries by decision: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get high-risk entries
 */
export async function getHighRiskEntries(
  threshold = 70,
  limit = 100
): Promise<any[]> {
  try {
    const sql = `
      SELECT * FROM audit_log 
      WHERE risk_score >= $1 
      ORDER BY risk_score DESC, created_at DESC 
      LIMIT $2
    `;

    const results = await query(sql, [threshold, limit]);
    return (results || []) as any[];
  } catch (error) {
    logger.error(CTX, `Failed to get high-risk entries: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ─── Retention & Cleanup ────────────────────────────────────────────────────

/**
 * Delete audit entries older than retention period - exported for routes/audit.ts compatibility
 */
export async function pruneOldEntries(retentionDays: number): Promise<number> {
  try {
    const sql = `
      DELETE FROM audit_log 
      WHERE created_at < NOW() - INTERVAL '${retentionDays} days'
      RETURNING id
    `;

    const deleted = await query(sql);
    const count = (deleted || []).length;
    logger.info(CTX, `Purged ${count} audit entries older than ${retentionDays} days`);
    return count;
  } catch (error) {
    logger.error(CTX, `Failed to purge old entries: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Export audit entries to file (for compliance/backup)
 */
export async function exportAuditEntries(
  startTime: string,
  endTime: string
): Promise<any[]> {
  try {
    const sql = `
      SELECT * FROM audit_log 
      WHERE created_at >= $1 AND created_at <= $2 
      ORDER BY created_at ASC
    `;

    const entries = await query(sql, [startTime, endTime]);
    logger.info(CTX, `Exported ${(entries || []).length} audit entries for period ${startTime} to ${endTime}`);
    return (entries || []) as any[];
  } catch (error) {
    logger.error(CTX, `Failed to export audit entries: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ─── Batch Operations ────────────────────────────────────────────────────────

/**
 * Write multiple audit entries in a single transaction for performance
 */
export async function writeAuditEntriesBatch(entries: AuditEntry[]): Promise<void> {
  try {
    await transaction(async (t) => {
      for (const entry of entries) {
        const sql = `
          INSERT INTO audit_log (
            id, tool_call_id, tool, agent_id, session_id, 
            risk_score, risk_level, decision, approval_status,
            risk_findings, secret_findings, sanitized_args_snapshot, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
          )
          ON CONFLICT (tool_call_id) DO NOTHING
        `;

        await t.none(sql, [
          entry.id,
          entry.toolCallId,
          entry.tool,
          entry.agentId || null,
          entry.sessionId || null,
          entry.riskScore,
          entry.riskLevel,
          entry.decision,
          entry.approvalStatus,
          entry.riskFindings || null,
          entry.secretFindings || null,
          entry.sanitizedArgsSnapshot || null,
          entry.createdAt,
        ]);
      }
    });

    logger.debug(CTX, `Batch write: ${entries.length} audit entries`);
  } catch (error) {
    logger.error(CTX, `Failed to batch write audit entries: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// ─── Health Check ────────────────────────────────────────────────────────────

/**
 * Verify audit log table exists and is accessible
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await queryOne('SELECT COUNT(*) FROM audit_log LIMIT 1');
    return true;
  } catch {
    return false;
  }
}
