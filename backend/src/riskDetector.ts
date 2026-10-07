import { minimatch } from "minimatch";
import { getConfig } from "./config";
import { logger } from "./logger";
import type { RiskFinding, RiskLevel, ToolCall } from "./types";

const CTX = "RiskDetector";

/**
 * Map a numeric risk score (0–100) to a human-readable level.
 */
export function scoreToLevel(score: number): RiskLevel {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 20) return "low";
  return "safe";
}

/**
 * Check whether any blocked patterns match the serialised tool-call args.
 * Returns the first matching block reason or null.
 */
export function checkBlockedPatterns(
  toolCall: ToolCall
): { name: string; reason: string } | null {
  const config = getConfig();
  const serialised = JSON.stringify(toolCall.args);

  for (const bp of config.blocked_patterns) {
    try {
      const re = new RegExp(bp.regex, "i");
      if (re.test(serialised)) {
        logger.warn(CTX, `Blocked pattern "${bp.name}" matched on tool "${toolCall.tool}"`);
        return { name: bp.name, reason: bp.reason };
      }
    } catch {
      logger.warn(CTX, `Invalid regex in blocked_pattern "${bp.name}": ${bp.regex}`);
    }
  }

  return null;
}

/**
 * Check domain allowlist for web-fetching tools.
 * Returns a finding if a domain is NOT in the allowlist (when enforcement is on).
 */
function checkDomainAllowlist(toolCall: ToolCall): RiskFinding | null {
  const config = getConfig();
  if (!config.allowed_domains.enabled) return null;

  const urlArg = (toolCall.args.url as string) ?? (toolCall.args.uri as string);
  if (!urlArg) return null;

  try {
    const { hostname } = new URL(urlArg);
    const allowed = config.allowed_domains.list.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
    if (!allowed) {
      return {
        rule: "domain-allowlist",
        reason: `Domain "${hostname}" is not in the allowed domains list`,
        score: 60,
      };
    }
  } catch {
    return {
      rule: "domain-allowlist",
      reason: `Could not parse URL from args: ${urlArg}`,
      score: 40,
    };
  }

  return null;
}

/**
 * Resolve the base risk score for a tool by matching config rules.
 * Supports exact names and glob patterns (e.g. "exec_*").
 */
function resolveToolRuleScore(toolName: string): { score: number; requireApproval: boolean } {
  const config = getConfig();
  let score = 30; // default
  let requireApproval = false;

  for (const rule of config.tools) {
    if (rule.enabled === false) continue;
    const matches =
      rule.name === toolName ||
      rule.name === "*" ||
      minimatch(toolName, rule.name);

    if (matches) {
      // First non-wildcard match wins; wildcard is only fallback
      if (rule.name !== "*") {
        score = rule.risk_score;
        requireApproval = rule.require_approval ?? false;
        break;
      } else {
        score = rule.risk_score;
        requireApproval = rule.require_approval ?? false;
      }
    }
  }

  return { score, requireApproval };
}

// ─── Heuristic arg-level checks ──────────────────────────────────────────────

function checkDestructiveShellArgs(toolCall: ToolCall): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const cmd =
    (toolCall.args.command as string) ??
    (toolCall.args.cmd as string) ??
    "";

  if (!cmd) return findings;

  if (/rm\s+-rf|Remove-Item\s+-Recurse\s+-Force/i.test(cmd)) {
    findings.push({
      rule: "destructive-shell",
      reason: "Command contains recursive force-delete pattern",
      score: 30,
    });
  }

  if (/>\s*\/dev\/null|2>&1/.test(cmd)) {
    findings.push({
      rule: "output-suppression",
      reason: "Command suppresses output, which can hide malicious activity",
      score: 10,
    });
  }

  if (/curl|wget|Invoke-WebRequest/i.test(cmd) && /\|\s*(bash|sh|zsh|powershell)/i.test(cmd)) {
    findings.push({
      rule: "remote-code-execution",
      reason: "Downloading and piping to a shell is a remote code execution risk",
      score: 50,
    });
  }

  return findings;
}

function checkFileWriteArgs(toolCall: ToolCall): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const filePath =
    (toolCall.args.path as string) ??
    (toolCall.args.targetFile as string) ??
    "";

  if (!filePath) return findings;

  // Writing to system directories
  if (/^(\/etc|\/bin|\/sbin|\/usr\/bin|C:\\Windows|C:\\System32)/i.test(filePath)) {
    findings.push({
      rule: "system-path-write",
      reason: `Writing to system path "${filePath}" is very risky`,
      score: 40,
    });
  }

  // Writing hidden files
  if (/[/\\]\.[^/\\]+$/.test(filePath)) {
    findings.push({
      rule: "hidden-file-write",
      reason: `Writing to hidden file "${filePath}"`,
      score: 10,
    });
  }

  return findings;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface RiskAssessment {
  riskScore: number;
  riskLevel: RiskLevel;
  findings: RiskFinding[];
  requireApproval: boolean;
  blockedPattern: { name: string; reason: string } | null;
}

/**
 * Run all risk checks on a ToolCall and return a full RiskAssessment.
 */
export function assessRisk(toolCall: ToolCall): RiskAssessment {
  const findings: RiskFinding[] = [];

  // 1. Check hard-blocked patterns first (immediate block, no score needed)
  const blockedPattern = checkBlockedPatterns(toolCall);

  // 2. Base score from tool config rules
  const { score: baseScore, requireApproval } = resolveToolRuleScore(toolCall.tool);

  // 3. Heuristic arg checks
  const shellFindings = checkDestructiveShellArgs(toolCall);
  const fileFindings = checkFileWriteArgs(toolCall);
  const domainFinding = checkDomainAllowlist(toolCall);

  findings.push(...shellFindings, ...fileFindings);
  if (domainFinding) findings.push(domainFinding);

  // 4. Accumulate score
  const additionalScore = findings.reduce((sum, f) => sum + f.score, 0);
  const totalScore = Math.min(100, baseScore + additionalScore);

  const level = scoreToLevel(totalScore);

  logger.debug(
    CTX,
    `Tool "${toolCall.tool}" scored ${totalScore} (${level})`,
    findings
  );

  return {
    riskScore: totalScore,
    riskLevel: level,
    findings,
    requireApproval: requireApproval || blockedPattern !== null,
    blockedPattern,
  };
}
