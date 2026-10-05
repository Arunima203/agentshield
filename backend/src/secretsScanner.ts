import { getConfig } from "./config";
import { logger } from "./logger";
import type { SecretFinding } from "./types";

const CTX = "SecretsScanner";

const REDACTED = "[REDACTED]";

/**
 * Scan a single string value for secret patterns.
 * Returns all pattern names that matched (never the actual secret).
 */
function scanValue(value: string): Array<{ name: string; pattern: string }> {
  const config = getConfig();
  const matches: Array<{ name: string; pattern: string }> = [];

  for (const p of config.secrets.patterns) {
    try {
      const re = new RegExp(p.regex, "i");
      if (re.test(value)) {
        matches.push({ name: p.name, pattern: p.regex });
      }
    } catch {
      logger.warn(CTX, `Invalid regex in secret pattern "${p.name}": ${p.regex}`);
    }
  }

  return matches;
}

/**
 * Recursively redact secrets from an args object.
 * Returns the sanitised copy and the list of findings.
 */
export function scanAndRedact(
  args: Record<string, unknown>
): { sanitized: Record<string, unknown>; findings: SecretFinding[] } {
  const config = getConfig();
  if (!config.secrets.enabled) {
    return { sanitized: args, findings: [] };
  }

  const findings: SecretFinding[] = [];
  const sanitized = redactObject(args, findings, "$root") as Record<string, unknown>;

  if (findings.length > 0) {
    logger.warn(
      CTX,
      `Detected ${findings.length} secret(s) in tool args: ${findings.map((f) => f.name).join(", ")}`
    );
  }

  return { sanitized, findings };
}

function redactObject(
  obj: unknown,
  findings: SecretFinding[],
  keyPath: string
): unknown {
  if (typeof obj === "string") {
    const matches = scanValue(obj);
    if (matches.length > 0) {
      matches.forEach((m) =>
        findings.push({ name: m.name, pattern: m.pattern, argKey: keyPath })
      );
      return REDACTED;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, i) =>
      redactObject(item, findings, `${keyPath}[${i}]`)
    );
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      // Redact entire value if the key name looks like a secret field
      if (isSensitiveKey(k)) {
        const strVal = typeof v === "string" ? v : JSON.stringify(v);
        if (strVal.length > 0) {
          findings.push({
            name: `Sensitive field: ${k}`,
            pattern: "key-name-heuristic",
            argKey: `${keyPath}.${k}`,
          });
          result[k] = REDACTED;
        } else {
          result[k] = v;
        }
      } else {
        result[k] = redactObject(v, findings, `${keyPath}.${k}`);
      }
    }
    return result;
  }

  return obj;
}

const SENSITIVE_KEY_RE =
  /^(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth|authorization|credential|credentials|x-api-key)$/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}
