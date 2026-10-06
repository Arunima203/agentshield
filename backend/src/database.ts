/**
 * database.ts
 *
 * PostgreSQL database connection manager with connection pooling,
 * migration support, and proper transaction handling.
 */

import pgPromise, { IDatabase, IInitOptions } from 'pg-promise';
import { logger } from './logger';
import type { AuditEntry } from './types';

const CTX = 'Database';

// Connection configuration from environment
const pgConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'agentshield',
  user: process.env.DB_USER || 'agentshield',
  password: process.env.DB_PASSWORD || 'agentshield_password',
  // Connection pool settings
  max: parseInt(process.env.DB_POOL_SIZE || '20', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000', 10),
};

// Initialize pg-promise
const pgp = pgPromise({
  // Enable query result validation
  query: (e: any) => {
    if (e.query) {
      logger.debug(CTX, `Query: ${e.query}`);
    }
  },
  error: (err: any, e: any) => {
    if (e.cn) {
      logger.error(CTX, `Database error: ${err.message}`);
    }
  },
});

// Create database instance
let db: IDatabase<any>;

/**
 * Initialize database connection
 */
export async function initDatabase(): Promise<void> {
  try {
    db = pgp(pgConfig);
    
    // Test connection
    await db.one('SELECT 1');
    logger.info(CTX, `Connected to PostgreSQL at ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`);
    
    // Run migrations
    await runMigrations();
  } catch (error) {
    logger.error(CTX, `Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get database instance
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// ─── Schema Management ────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

interface SchemaMigration {
  version: number;
  name: string;
  up: string;
  down?: string;
}

const migrations: SchemaMigration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Schema version tracking
      CREATE TABLE IF NOT EXISTS schema_version (
        id SERIAL PRIMARY KEY,
        version INT NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        name VARCHAR(255)
      );

      -- Users table (for admin/approver/auditor roles)
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'approver', 'auditor', 'agent', 'guest')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_users_email ON users(email);
      CREATE INDEX idx_users_role ON users(role);

      -- Audit log - stores all tool inspection decisions
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tool_call_id UUID NOT NULL,
        tool VARCHAR(255) NOT NULL,
        agent_id VARCHAR(255),
        session_id VARCHAR(255),
        risk_score INT NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
        risk_level VARCHAR(50) NOT NULL CHECK (risk_level IN ('safe', 'low', 'medium', 'high', 'critical')),
        decision VARCHAR(50) NOT NULL CHECK (decision IN ('allow', 'require_approval', 'block')),
        approval_status VARCHAR(50) NOT NULL,
        risk_findings JSONB,
        secret_findings JSONB,
        sanitized_args_snapshot JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT audit_log_unique UNIQUE(tool_call_id)
      );

      CREATE INDEX idx_audit_tool ON audit_log(tool);
      CREATE INDEX idx_audit_decision ON audit_log(decision);
      CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
      CREATE INDEX idx_audit_agent ON audit_log(agent_id);

      -- Approval requests - queued for human review
      CREATE TABLE IF NOT EXISTS approval_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tool_call_id UUID NOT NULL REFERENCES audit_log(tool_call_id) ON DELETE CASCADE,
        tool_call_json JSONB NOT NULL,
        inspection_json JSONB NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'auto_approved', 'auto_blocked', 'timeout')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP,
        resolved_by VARCHAR(255),
        rejection_reason TEXT,
        timeout_ms INT,
        CONSTRAINT approval_unique UNIQUE(id)
      );

      CREATE INDEX idx_approval_status ON approval_requests(status);
      CREATE INDEX idx_approval_created ON approval_requests(created_at DESC);
      CREATE INDEX idx_approval_tool_call ON approval_requests(tool_call_id);

      -- Configuration management
      CREATE TABLE IF NOT EXISTS configuration (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) NOT NULL UNIQUE,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by VARCHAR(255)
      );

      CREATE INDEX idx_config_key ON configuration(key);

      -- Sessions for auth/tracking
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_jti VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP
      );

      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);

      -- Views for common queries
      CREATE VIEW audit_summary AS
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        decision,
        COUNT(*) as count,
        AVG(risk_score) as avg_risk_score,
        MAX(risk_score) as max_risk_score
      FROM audit_log
      GROUP BY DATE_TRUNC('hour', created_at), decision;

      CREATE VIEW pending_approvals AS
      SELECT 
        ar.id,
        ar.tool_call_id,
        ar.created_at,
        ar.timeout_ms,
        al.tool,
        al.risk_score,
        al.agent_id
      FROM approval_requests ar
      JOIN audit_log al ON ar.tool_call_id = al.id
      WHERE ar.status = 'pending'
      ORDER BY ar.created_at ASC;
    `,
  },
];

/**
 * Run pending migrations
 */
async function runMigrations(): Promise<void> {
  const database = getDb();

  try {
    // Create schema_version table if it doesn't exist
    await database.none(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id SERIAL PRIMARY KEY,
        version INT NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        name VARCHAR(255)
      );
    `);

    // Get current version
    const result = await database.oneOrNone(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    );
    const currentVersion = result?.version ?? 0;

    logger.info(CTX, `Current schema version: ${currentVersion}, target: ${SCHEMA_VERSION}`);

    // Apply pending migrations
    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        logger.info(CTX, `Applying migration ${migration.version}: ${migration.name}`);
        
        await database.tx(async (t) => {
          await t.none(migration.up);
          await t.none(
            'INSERT INTO schema_version (version, name) VALUES ($1, $2)',
            [migration.version, migration.name]
          );
        });

        logger.info(CTX, `Migration ${migration.version} applied successfully`);
      }
    }

    logger.info(CTX, 'All migrations applied successfully');
  } catch (error) {
    logger.error(CTX, `Migration failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Execute a query with optional transaction
 */
export async function query<T>(sql: string, params?: any[]): Promise<T[]> {
  const database = getDb();
  return database.query(sql, params);
}

/**
 * Execute a query expecting one result
 */
export async function queryOne<T>(sql: string, params?: any[]): Promise<T | null> {
  const database = getDb();
  return database.oneOrNone(sql, params);
}

/**
 * Execute a query with no result
 */
export async function queryNone(sql: string, params?: any[]): Promise<void> {
  const database = getDb();
  await database.none(sql, params);
}

/**
 * Execute multiple queries in a transaction
 */
export async function transaction<T>(
  callback: (t: any) => Promise<T>
): Promise<T> {
  const database = getDb();
  return database.tx(callback);
}

/**
 * Health check
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const database = getDb();
    await database.one('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
