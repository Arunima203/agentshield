/**
 * AgentShield API Client
 * Central utility for all frontend → backend communication.
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

function headers(): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_KEY) h["X-Api-Key"] = API_KEY;
  return h;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers ?? {}) },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type Decision = "allow" | "block" | "require_approval";
export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "timeout"
  | "auto_approved"
  | "auto_blocked";

export interface RiskFinding {
  rule: string;
  reason: string;
  score: number;
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
}

export interface ApprovalRequest {
  id: string;
  toolCall: {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    agentId?: string;
    sessionId?: string;
    timestamp: string;
  };
  inspection: {
    riskScore: number;
    riskLevel: RiskLevel;
    decision: Decision;
    riskFindings: RiskFinding[];
  };
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  rejectionReason?: string;
}

export interface AuditEntry {
  id: string;
  toolCallId: string;
  tool: string;
  agentId?: string;
  riskScore: number;
  riskLevel: RiskLevel;
  decision: Decision;
  approvalStatus: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface AuditStats {
  total: number;
  byDecision: Array<{ decision: string; count: number }>;
  byLevel: Array<{ risk_level: string; count: number }>;
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<{ status: string; service: string }> {
  return request("/health");
}

// ─── Inspect ──────────────────────────────────────────────────────────────────

export async function inspectToolCall(payload: {
  tool: string;
  args: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
}): Promise<InspectResponse> {
  return request("/inspect", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export async function getApprovals(
  status?: ApprovalStatus,
  limit = 50
): Promise<{ count: number; requests: ApprovalRequest[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set("status", status);
  return request(`/approvals?${params}`);
}

export async function approveRequest(
  id: string,
  resolvedBy = "operator"
): Promise<{ message: string; request: ApprovalRequest }> {
  return request(`/approvals/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ resolvedBy }),
  });
}

export async function rejectRequest(
  id: string,
  resolvedBy = "operator",
  rejectionReason?: string
): Promise<{ message: string; request: ApprovalRequest }> {
  return request(`/approvals/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ resolvedBy, rejectionReason }),
  });
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export async function getAuditLog(opts?: {
  tool?: string;
  decision?: string;
  since?: string;
  limit?: number;
  offset?: number;
}): Promise<{ count: number; entries: AuditEntry[] }> {
  const params = new URLSearchParams();
  if (opts?.tool) params.set("tool", opts.tool);
  if (opts?.decision) params.set("decision", opts.decision);
  if (opts?.since) params.set("since", opts.since);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return request(`/audit${qs ? `?${qs}` : ""}`);
}

export async function getAuditStats(): Promise<AuditStats> {
  return request("/audit/stats");
}
