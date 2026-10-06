-- AgentShield Database Schema
-- SQLite schema for audit logs, approvals, and configuration

-- ============================================================================
-- Core Tables
-- ============================================================================

-- Audit Log: Complete record of all inspections and decisions
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    toolCallId TEXT NOT NULL UNIQUE,
    tool TEXT NOT NULL,
    agentId TEXT,
    sessionId TEXT,
    
    -- Scoring
    riskScore INTEGER NOT NULL CHECK(riskScore >= 0 AND riskScore <= 100),
    deterministicScore INTEGER CHECK(deterministicScore >= 0 AND deterministicScore <= 100),
    llmScore INTEGER CHECK(llmScore >= 0 AND llmScore <= 100),
    riskLevel TEXT NOT NULL CHECK(riskLevel IN ('safe', 'low', 'medium', 'high', 'critical')),
    
    -- Decision
    decision TEXT NOT NULL CHECK(decision IN ('allow', 'block', 'require_approval')),
    approvalStatus TEXT CHECK(approvalStatus IN ('pending', 'approved', 'rejected', 'timeout', 'auto_approved', 'auto_blocked')),
    
    -- Findings (JSON)
    riskFindings TEXT,           -- JSON array of findings
    secretFindings TEXT,         -- JSON array of secrets found (pattern names only, no values)
    blockedPatternMatch TEXT,
    
    -- Arguments (redacted/sanitized)
    sanitizedArgsSnapshot TEXT,  -- JSON of sanitized arguments
    
    -- Metadata
    createdAt TEXT NOT NULL,     -- ISO 8601 timestamp
    resolvedAt TEXT,             -- ISO 8601 timestamp
    resolutionNotes TEXT,
    
    -- Indices
    UNIQUE(toolCallId),
    INDEX idx_tool(tool),
    INDEX idx_agent(agentId),
    INDEX idx_session(sessionId),
    INDEX idx_decision(decision),
    INDEX idx_created(createdAt),
    INDEX idx_risk_score(riskScore)
);

-- Approval Requests: Track human-required approvals
CREATE TABLE IF NOT EXISTS approval_request (
    id TEXT PRIMARY KEY,
    toolCallId TEXT NOT NULL UNIQUE,
    
    -- Request details
    tool TEXT NOT NULL,
    agentId TEXT,
    sessionId TEXT,
    
    -- Tool call snapshot
    toolCall TEXT NOT NULL,      -- JSON: complete tool call details
    inspection TEXT NOT NULL,    -- JSON: inspection result at time of request
    
    -- Status tracking
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'timeout', 'auto_approved', 'auto_blocked')),
    createdAt TEXT NOT NULL,
    resolvedAt TEXT,
    resolvedBy TEXT,             -- User ID who resolved this
    rejectionReason TEXT,
    
    -- Expiry
    expiryTime TEXT,             -- ISO 8601: when approval expires
    timeoutSeconds INTEGER DEFAULT 3600,
    
    -- Indices
    UNIQUE(toolCallId),
    INDEX idx_status(status),
    INDEX idx_agent(agentId),
    INDEX idx_created(createdAt),
    INDEX idx_expiry(expiryTime)
);

-- User Decisions: Track individual approver decisions
CREATE TABLE IF NOT EXISTS user_decision (
    id TEXT PRIMARY KEY,
    approvalRequestId TEXT NOT NULL,
    
    -- Decision maker
    userId TEXT NOT NULL,
    userName TEXT,
    
    -- Decision
    approved BOOLEAN NOT NULL,
    rejectionReason TEXT,
    
    -- Metadata
    decidedAt TEXT NOT NULL,     -- ISO 8601 timestamp
    ipAddress TEXT,
    userAgent TEXT,
    
    -- Foreign key
    FOREIGN KEY(approvalRequestId) REFERENCES approval_request(id),
    INDEX idx_request(approvalRequestId),
    INDEX idx_user(userId),
    INDEX idx_decided(decidedAt)
);

-- ============================================================================
-- Configuration Tables
-- ============================================================================

-- Tool Rules: Risk scores for each tool
CREATE TABLE IF NOT EXISTS tool_rule (
    name TEXT PRIMARY KEY,
    riskScore INTEGER NOT NULL CHECK(riskScore >= 0 AND riskScore <= 100),
    description TEXT,
    requireApproval BOOLEAN DEFAULT FALSE,
    updatedAt TEXT NOT NULL
);

-- Secret Patterns: Regex patterns for secret detection
CREATE TABLE IF NOT EXISTS secret_pattern (
    name TEXT PRIMARY KEY,
    regex TEXT NOT NULL,
    description TEXT,
    severity TEXT CHECK(severity IN ('low', 'medium', 'high', 'critical')),
    enabled BOOLEAN DEFAULT TRUE,
    updatedAt TEXT NOT NULL
);

-- Blocked Patterns: Hard blocks for dangerous commands
CREATE TABLE IF NOT EXISTS blocked_pattern (
    name TEXT PRIMARY KEY,
    regex TEXT NOT NULL,
    reason TEXT,
    severity TEXT CHECK(severity IN ('low', 'medium', 'high', 'critical')),
    enabled BOOLEAN DEFAULT TRUE,
    updatedAt TEXT NOT NULL
);

-- Allowed Domains: Whitelist for web fetch operations
CREATE TABLE IF NOT EXISTS allowed_domain (
    domain TEXT PRIMARY KEY,
    description TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    addedAt TEXT NOT NULL,
    addedBy TEXT
);

-- ============================================================================
-- System Tables
-- ============================================================================

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migration (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    executedAt TEXT NOT NULL,
    executionTime INTEGER  -- milliseconds
);

-- System configuration
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT CHECK(type IN ('string', 'integer', 'boolean', 'json')),
    description TEXT,
    updatedAt TEXT NOT NULL,
    updatedBy TEXT
);

-- ============================================================================
-- Views
-- ============================================================================

-- View: Recent decisions
CREATE VIEW IF NOT EXISTS recent_decisions AS
SELECT 
    id,
    tool,
    decision,
    riskScore,
    riskLevel,
    agentId,
    createdAt
FROM audit_log
ORDER BY createdAt DESC
LIMIT 100;

-- View: Decision statistics
CREATE VIEW IF NOT EXISTS decision_stats AS
SELECT 
    decision,
    COUNT(*) as count,
    ROUND(AVG(riskScore), 2) as avg_risk_score,
    MIN(riskScore) as min_risk_score,
    MAX(riskScore) as max_risk_score
FROM audit_log
WHERE createdAt >= datetime('now', '-24 hours')
GROUP BY decision;

-- View: Risk distribution
CREATE VIEW IF NOT EXISTS risk_distribution AS
SELECT 
    CASE 
        WHEN riskScore < 30 THEN 'LOW'
        WHEN riskScore < 60 THEN 'MEDIUM'
        WHEN riskScore < 85 THEN 'HIGH'
        ELSE 'CRITICAL'
    END as risk_category,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM audit_log WHERE createdAt >= datetime('now', '-24 hours')), 2) as percentage
FROM audit_log
WHERE createdAt >= datetime('now', '-24 hours')
GROUP BY risk_category;

-- View: Pending approvals
CREATE VIEW IF NOT EXISTS pending_approvals AS
SELECT 
    id,
    tool,
    agentId,
    status,
    createdAt,
    expiryTime,
    CAST((julianday(expiryTime) - julianday('now')) * 86400 AS INTEGER) as seconds_remaining
FROM approval_request
WHERE status = 'pending'
ORDER BY expiryTime ASC;

-- View: Most blocked patterns
CREATE VIEW IF NOT EXISTS most_blocked_patterns AS
SELECT 
    blockedPatternMatch,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM audit_log WHERE blockedPatternMatch IS NOT NULL), 2) as percentage
FROM audit_log
WHERE blockedPatternMatch IS NOT NULL
  AND createdAt >= datetime('now', '-7 days')
GROUP BY blockedPatternMatch
ORDER BY count DESC
LIMIT 10;

-- View: Agent activity
CREATE VIEW IF NOT EXISTS agent_activity AS
SELECT 
    agentId,
    COUNT(*) as inspection_count,
    COUNT(CASE WHEN decision = 'block' THEN 1 END) as blocked_count,
    COUNT(CASE WHEN decision = 'require_approval' THEN 1 END) as approval_count,
    ROUND(AVG(riskScore), 2) as avg_risk_score,
    MAX(createdAt) as last_activity
FROM audit_log
WHERE createdAt >= datetime('now', '-24 hours')
GROUP BY agentId
ORDER BY inspection_count DESC;

-- ============================================================================
-- Indices for Performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_log_tool_created 
    ON audit_log(tool, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_risk_decision 
    ON audit_log(riskScore, decision);

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_session 
    ON audit_log(agentId, sessionId);

CREATE INDEX IF NOT EXISTS idx_approval_request_status_created 
    ON approval_request(status, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_user_decision_request_user 
    ON user_decision(approvalRequestId, userId);

-- ============================================================================
-- Triggers for Audit Trail
-- ============================================================================

-- Auto-update timestamp on modification
CREATE TRIGGER IF NOT EXISTS trigger_update_approval_modified
AFTER UPDATE ON approval_request
BEGIN
    UPDATE approval_request SET resolvedAt = datetime('now') WHERE id = NEW.id;
END;

-- Track secret pattern changes
CREATE TRIGGER IF NOT EXISTS trigger_track_secret_pattern_change
AFTER UPDATE ON secret_pattern
BEGIN
    INSERT INTO system_config (key, value, type, description, updatedAt)
    VALUES (
        'pattern_updated_' || datetime('now'),
        OLD.name || ' -> ' || NEW.regex,
        'json',
        'Secret pattern updated',
        datetime('now')
    );
END;

-- ============================================================================
-- Initial Data
-- ============================================================================

-- Default tool rules
INSERT OR IGNORE INTO tool_rule (name, riskScore, description, requireApproval, updatedAt) VALUES
('read_file', 20, 'Read file operation', false, datetime('now')),
('fs_write', 50, 'Write to filesystem', true, datetime('now')),
('execute_pwsh', 70, 'Execute PowerShell command', true, datetime('now')),
('execute_bash', 70, 'Execute bash command', true, datetime('now')),
('web_fetch', 30, 'Fetch from web', true, datetime('now')),
('database_query', 40, 'Execute database query', true, datetime('now')),
('api_call', 50, 'Make API call', true, datetime('now')),
('*', 30, 'Default tool rule', false, datetime('now'));

-- Default blocked patterns
INSERT OR IGNORE INTO blocked_pattern (name, regex, reason, severity, enabled, updatedAt) VALUES
('recursive_delete', 'rm\s+-rf|Remove-Item\s+-Recurse\s+-Force', 'Recursive force delete detected', 'critical', true, datetime('now')),
('shell_pipe_injection', 'curl.*\|\s*bash|wget.*\|\s*bash', 'Remote code execution via shell pipe', 'critical', true, datetime('now')),
('sql_injection', "';\\s*DROP\\s|DROP\\s+TABLE|DELETE\\s+FROM", 'SQL injection pattern detected', 'critical', true, datetime('now'));

-- System configuration
INSERT OR IGNORE INTO system_config (key, value, type, description, updatedAt) VALUES
('approval_timeout_seconds', '3600', 'integer', 'Default approval request timeout', datetime('now')),
('risk_block_threshold', '85', 'integer', 'Risk score threshold for auto-blocking', datetime('now')),
('risk_review_threshold', '60', 'integer', 'Risk score threshold requiring approval', datetime('now'));
