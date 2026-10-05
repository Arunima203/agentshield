/**
 * auditLogger.ts
 *
 * SQLite-backed audit log using sql.js (pure JavaScript, no native build needed).
 * The database is loaded from disk on first access and flushed after every write.
 */

import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import path from "path";
import fs from "fs";
import { logger } from "./logger";
import { getConfig } from "./config";
import type { AuditEntry } from "./types";

const CTX = "AuditLogger";

let _sql: SqlJsStatic | null = null;
let _db: Database | null = null;

function getDbPath(): string {
  // On Railway/cloud, use /tmp (writable). Locally use ./data/
  const defaultPath = process.env.RAILWAY_ENVIRONMENT
    ? "/tmp/agentshield.db"
    : "./data/agentshield.db";
  return path.resolve(process.env.DB_PATH ?? defaultPath);
}

async function initSql(): Promise<SqlJsStatic> {
  if (_sql) return _sql;
  _sql = await initSqlJs();
  return _sql;
}

/**
 * Load or create the SQLite database, run migrations, return the instance.
 */
export async function getDb(): Promise<Database> {
  if (_db) return _db;

  const sql = await initSql();
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    _db = new sql.Database(fileBuffer);
  } else {
    _db = new sql.Database();
  }

  migrate(_db);
  flush(_db);
  logger.info(CTX, `SQLite database ready at ${dbPath}`);
  return _db;
}

/** Persist the in-memory database back to disk. */
function flush(db: Database): void {
  const dbPath = getDbPath();
  const data = db.export();
  const buf = Buffer.from(data);
  fs.writeFileSync(dbPath, buf);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id                    TEXT PRIMARY KEY,
      tool_call_id          TEXT NOT NULL,
      tool                  TEXT NOT NULL,
      agent_id              TEXT,
      session_id            TEXT,
      risk_score            INTEGER NOT NULL,
      risk_level            TEXT NOT NULL,
      decision              TEXT NOT NULL,
      approval_status       TEXT NOT NULL,
      risk_findings         TEXT NOT NULL,
      secret_findings       TEXT NOT NULL,
      sanitized_args        TEXT NOT NULL,
      created_at            TEXT NOT NULL,
      resolved_at           TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_tool       ON audit_log(tool)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_decision   ON audit_log(decision)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_agent_id   ON audit_log(agent_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id                TEXT PRIMARY KEY,
      tool_call_id      TEXT NOT NULL,
      tool_call_json    TEXT NOT NULL,
      inspection_json   TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      created_at        TEXT NOT NULL,
      resolved_at       TEXT,
      resolved_by       TEXT,
      rejection_reason  TEXT,
      timeout_ms        INTEGER
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status)`);
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function writeAuditEntry(entry: AuditEntry): Promise<void> {
  const config = getConfig();
  if (!config.audit.enabled) return;

  const db = await getDb();
  db.run(
    `INSERT INTO audit_log (
       id, tool_call_id, tool, agent_id, session_id,
       risk_score, risk_level, decision, approval_status,
       risk_findings, secret_findings, sanitized_args,
       created_at, resolved_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      entry.id,
      entry.toolCallId,
      entry.tool,
      entry.agentId ?? null,
      entry.sessionId ?? null,
      entry.riskScore,
      entry.riskLevel,
      entry.decision,
      entry.approvalStatus,
      entry.riskFindings,
      entry.secretFindings,
      entry.sanitizedArgsSnapshot,
      entry.createdAt,
      entry.resolvedAt ?? null,
    ]
  );
  flush(db);
  logger.debug(CTX, `Audit entry written for tool_call_id=${entry.toolCallId}`);
}

// ─── Update approval status ───────────────────────────────────────────────────

export async function updateAuditApproval(
  toolCallId: string,
  approvalStatus: string,
  resolvedAt: string
): Promise<void> {
  const db = await getDb();
  db.run(
    `UPDATE audit_log SET approval_status=?, resolved_at=? WHERE tool_call_id=?`,
    [approvalStatus, resolvedAt, toolCallId]
  );
  flush(db);
}

// ─── Query ────────────────────────────────────────────────────────────────────

export async function queryAuditLog(opts: {
  limit?: number;
  offset?: number;
  tool?: string;
  decision?: string;
  agentId?: string;
  since?: string;
}): Promise<AuditEntry[]> {
  const db = await getDb();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (opts.tool) { conditions.push("tool = ?"); params.push(opts.tool); }
  if (opts.decision) { conditions.push("decision = ?"); params.push(opts.decision); }
  if (opts.agentId) { conditions.push("agent_id = ?"); params.push(opts.agentId); }
  if (opts.since) { conditions.push("created_at >= ?"); params.push(opts.since); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  params.push(limit, offset);

  const stmt = db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  );
  stmt.bind(params);

  const rows: AuditEntry[] = [];
  while (stmt.step()) {
    rows.push(rowToEntry(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  return rows;
}

export async function getAuditStats(): Promise<Record<string, unknown>> {
  const db = await getDb();

  const totalStmt = db.prepare("SELECT COUNT(*) as c FROM audit_log");
  totalStmt.step();
  const total = (totalStmt.getAsObject() as { c: number }).c;
  totalStmt.free();

  const byDecision = runQuery(db, "SELECT decision, COUNT(*) as count FROM audit_log GROUP BY decision");
  const byLevel    = runQuery(db, "SELECT risk_level, COUNT(*) as count FROM audit_log GROUP BY risk_level");

  return { total, byDecision, byLevel };
}

export async function pruneOldEntries(): Promise<number> {
  const config = getConfig();
  if (!config.audit.retention_days) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.audit.retention_days);

  const db = await getDb();
  // sql.js doesn't return changes count directly; count first
  const countStmt = db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE created_at < ?");
  countStmt.bind([cutoff.toISOString()]);
  countStmt.step();
  const count = (countStmt.getAsObject() as { c: number }).c;
  countStmt.free();

  db.run("DELETE FROM audit_log WHERE created_at < ?", [cutoff.toISOString()]);
  flush(db);

  if (count > 0) {
    logger.info(CTX, `Pruned ${count} audit entries older than ${config.audit.retention_days} days`);
  }
  return count;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function runQuery(db: Database, sql: string): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return rows;
}

function rowToEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id: row.id as string,
    toolCallId: row.tool_call_id as string,
    tool: row.tool as string,
    agentId: row.agent_id as string | undefined,
    sessionId: row.session_id as string | undefined,
    riskScore: row.risk_score as number,
    riskLevel: row.risk_level as AuditEntry["riskLevel"],
    decision: row.decision as AuditEntry["decision"],
    approvalStatus: row.approval_status as AuditEntry["approvalStatus"],
    riskFindings: row.risk_findings as string,
    secretFindings: row.secret_findings as string,
    sanitizedArgsSnapshot: row.sanitized_args as string,
    createdAt: row.created_at as string,
    resolvedAt: row.resolved_at as string | undefined,
  };
}
