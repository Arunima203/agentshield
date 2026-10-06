/**
 * monitoring.ts
 *
 * Prometheus metrics collection and monitoring infrastructure.
 * Tracks decision quality, latency, errors, and system health.
 */

import prometheus from 'prom-client';
import { logger } from './logger';

const CTX = 'Monitoring';

// ─── Counter Metrics ─────────────────────────────────────────────────────

export const inspectionCounter = new prometheus.Counter({
  name: 'agentshield_inspections_total',
  help: 'Total number of inspections performed',
  labelNames: ['decision', 'tool'],
});

export const decisionCounter = new prometheus.Counter({
  name: 'agentshield_decisions_total',
  help: 'Total decisions by type',
  labelNames: ['decision'],
});

export const secretsDetectedCounter = new prometheus.Counter({
  name: 'agentshield_secrets_detected_total',
  help: 'Total secrets detected',
  labelNames: ['secret_type'],
});

export const blockedPatternsCounter = new prometheus.Counter({
  name: 'agentshield_blocked_patterns_total',
  help: 'Total blocked pattern matches',
  labelNames: ['pattern_name'],
});

export const approvalsCounter = new prometheus.Counter({
  name: 'agentshield_approvals_total',
  help: 'Total approval requests by status',
  labelNames: ['status'],
});

export const llmErrorsCounter = new prometheus.Counter({
  name: 'agentshield_llm_errors_total',
  help: 'Total LLM analysis errors',
  labelNames: ['error_type'],
});

// ─── Gauge Metrics ──────────────────────────────────────────────────────

export const activePendingApprovalsGauge = new prometheus.Gauge({
  name: 'agentshield_pending_approvals',
  help: 'Number of pending approvals waiting for human decision',
});

export const llmAvailabilityGauge = new prometheus.Gauge({
  name: 'agentshield_llm_available',
  help: 'LLM service availability (1 = available, 0 = unavailable)',
});

export const systemHealthGauge = new prometheus.Gauge({
  name: 'agentshield_system_health',
  help: 'Overall system health score (0-100)',
});

// ─── Histogram Metrics ──────────────────────────────────────────────────

export const riskScoreHistogram = new prometheus.Histogram({
  name: 'agentshield_risk_score',
  help: 'Risk score distribution',
  buckets: [10, 20, 30, 50, 70, 85, 100],
});

export const deterministicScoreHistogram = new prometheus.Histogram({
  name: 'agentshield_deterministic_score',
  help: 'Deterministic scoring distribution',
  buckets: [10, 20, 30, 50, 70, 85, 100],
});

export const llmScoreHistogram = new prometheus.Histogram({
  name: 'agentshield_llm_score',
  help: 'LLM semantic scoring distribution',
  buckets: [10, 20, 30, 50, 70, 85, 100],
});

export const inspectionLatencyHistogram = new prometheus.Histogram({
  name: 'agentshield_inspection_duration_ms',
  help: 'Inspection latency in milliseconds',
  labelNames: ['component'],
  buckets: [10, 50, 100, 250, 500, 1000, 2000, 5000],
});

export const secretScanLatencyHistogram = new prometheus.Histogram({
  name: 'agentshield_secret_scan_duration_ms',
  help: 'Secret scanning latency in milliseconds',
  buckets: [1, 5, 10, 25, 50, 100],
});

export const llmAnalysisLatencyHistogram = new prometheus.Histogram({
  name: 'agentshield_llm_analysis_duration_ms',
  help: 'LLM analysis latency in milliseconds',
  buckets: [100, 250, 500, 1000, 2000, 5000, 10000],
});

export const approvalResolutionTimeHistogram = new prometheus.Histogram({
  name: 'agentshield_approval_resolution_time_seconds',
  help: 'Time to resolve approval request in seconds',
  buckets: [60, 300, 900, 3600, 7200],
});

// ─── Summary Metrics ────────────────────────────────────────────────────

export const findingsPerInspectionSummary = new prometheus.Summary({
  name: 'agentshield_findings_per_inspection',
  help: 'Number of security findings per inspection',
  percentiles: [0.5, 0.9, 0.95, 0.99],
});

export const llmConfidenceSummary = new prometheus.Summary({
  name: 'agentshield_llm_confidence',
  help: 'LLM confidence scores (0-1)',
  percentiles: [0.5, 0.9, 0.95, 0.99],
});

// ─── Metrics Collection Functions ───────────────────────────────────────

/**
 * Record inspection metrics
 */
export function recordInspection(
  decision: string,
  tool: string,
  riskScore: number,
  detScore: number,
  llmScore: number | null,
  findingsCount: number,
  durationMs: number
): void {
  inspectionCounter.inc({ decision, tool });
  decisionCounter.inc({ decision });
  riskScoreHistogram.observe(riskScore);
  deterministicScoreHistogram.observe(detScore);
  if (llmScore !== null) {
    llmScoreHistogram.observe(llmScore);
  }
  inspectionLatencyHistogram.labels('total').observe(durationMs);
  findingsPerInspectionSummary.observe(findingsCount);
}

/**
 * Record secret detection
 */
export function recordSecretDetected(secretType: string): void {
  secretsDetectedCounter.inc({ secret_type: secretType });
}

/**
 * Record blocked pattern match
 */
export function recordBlockedPattern(patternName: string): void {
  blockedPatternsCounter.inc({ pattern_name: patternName });
}

/**
 * Record approval metrics
 */
export function recordApprovalRequest(initialStatus: string): void {
  approvalsCounter.inc({ status: initialStatus });
  activePendingApprovalsGauge.inc();
}

export function recordApprovalResolution(status: string, resolutionTimeSeconds: number): void {
  approvalsCounter.inc({ status });
  approvalResolutionTimeHistogram.observe(resolutionTimeSeconds);
  activePendingApprovalsGauge.dec();
}

/**
 * Record LLM error
 */
export function recordLLMError(errorType: string): void {
  llmErrorsCounter.inc({ error_type: errorType });
}

/**
 * Record component latency
 */
export function recordLatency(component: string, durationMs: number): void {
  inspectionLatencyHistogram.labels(component).observe(durationMs);
}

/**
 * Update LLM availability
 */
export function updateLLMAvailability(available: boolean): void {
  llmAvailabilityGauge.set(available ? 1 : 0);
}

/**
 * Update system health score
 */
export function updateSystemHealth(healthScore: number): void {
  systemHealthGauge.set(Math.min(100, Math.max(0, healthScore)));
}

/**
 * Record LLM confidence
 */
export function recordLLMConfidence(confidence: number): void {
  llmConfidenceSummary.observe(Math.min(1, Math.max(0, confidence)));
}

/**
 * Get all metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return await prometheus.register.metrics();
}

/**
 * Get metrics content type
 */
export function getMetricsContentType(): string {
  return prometheus.register.contentType;
}

logger.info(CTX, 'Monitoring metrics initialized');
