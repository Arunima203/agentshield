// ─── Core Domain Types ────────────────────────────────────────────────────────

export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";
export type Decision = "allow" | "block" | "require_approval";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "timeout" | "auto_approved" | "auto_blocked";
export type ApprovalMode = "auto" | "strict" | "audit";

// ─── Tool Call ────────────────────────────────────────────────────────────────

export interface ToolCall {
  /** Unique ID for this tool call */
  id: string;
  /** Name of the tool being invoked */
  tool: string;
  /** Raw arguments passed to the tool */
  args: Record<string, unknown>;
  /** Agent/session that initiated the call */
  agentId?: string;
  /** Optional session identifier */
  sessionId?: string;
  /** ISO timestamp when the call was received */
  timestamp: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

// ─── Inspection Result ────────────────────────────────────────────────────────

export interface RiskFinding {
  rule: string;
  reason: string;
  score: number;
}

export interface SecretFinding {
  name: string;
  /** The matched pattern name (never the actual secret value) */
  pattern: string;
  /** Which argument key the secret was found in */
  argKey: string;
}

export interface InspectionResult {
  toolCallId: string;
  tool: string;
  riskScore: number;
  riskLevel: RiskLevel;
  decision: Decision;
  riskFindings: RiskFinding[];
  secretFindings: SecretFinding[];
  blockedPatternMatch?: string;
  sanitizedArgs?: Record<string, unknown>;
  inspectedAt: string;
  llmAnalysis?: {
    score: number | null;
    severity: string;
    decision: string;
    categories: string[];
    reason: string;
    confidence: number;
    model: string;
  };
  scoreSources?: string[];
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  toolCall: ToolCall;
  inspection: InspectionResult;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  rejectionReason?: string;
  /** Number of ms to wait before auto-timing out (0 = wait forever) */
  timeoutMs?: number;
}

export interface ApprovalDecision {
  requestId: string;
  approved: boolean;
  rejectionReason?: string;
  resolvedBy: string;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  toolCallId: string;
  tool: string;
  agentId?: string;
  sessionId?: string;
  riskScore: number;
  riskLevel: RiskLevel;
  decision: Decision;
  approvalStatus: ApprovalStatus;
  riskFindings: string; // JSON
  secretFindings: string; // JSON (redacted)
  sanitizedArgsSnapshot: string; // JSON (redacted)
  createdAt: string;
  resolvedAt?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface ToolRule {
  name: string;
  risk_score: number;
  description?: string;
  require_approval?: boolean;
}

export interface SecretPattern {
  name: string;
  regex: string;
}

export interface BlockedPattern {
  name: string;
  regex: string;
  reason: string;
}

export interface ShieldConfig {
  version: string;
  risk: {
    block_threshold: number;
    review_threshold: number;
  };
  tools: ToolRule[];
  secrets: {
    enabled: boolean;
    patterns: SecretPattern[];
  };
  blocked_patterns: BlockedPattern[];
  allowed_domains: {
    enabled: boolean;
    list: string[];
  };
  audit: {
    enabled: boolean;
    retention_days: number;
  };
}

// ─── API Request / Response shapes ───────────────────────────────────────────

export interface InspectRequest {
  tool: string;
  args: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface InspectResponse {
  toolCallId: string;
  decision: Decision;
  riskScore: number;
  riskLevel: RiskLevel;
  riskFindings: RiskFinding[];
  secretsDetected: boolean;
  approvalRequestId?: string;
  message: string;
  llmAnalysis?: {
    risk_score: number | null;
    severity: string;
    decision: string;
    categories: string[];
    reason: string;
    confidence: number;
    model: string;
    llm_available: boolean;
  };
}
