import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { ShieldConfig } from "./types";

const DEFAULT_CONFIG_PATH = path.resolve(
  process.env.CONFIG_PATH ?? "./agentshield.config.yaml"
);

const DEFAULTS: ShieldConfig = {
  version: "1",
  risk: {
    block_threshold: 80,
    review_threshold: 50,
  },
  tools: [
    { name: "*", risk_score: 30, description: "Default fallback rule" },
  ],
  secrets: {
    enabled: true,
    patterns: [],
  },
  blocked_patterns: [],
  allowed_domains: {
    enabled: false,
    list: [],
  },
  audit: {
    enabled: true,
    retention_days: 90,
  },
};

let _config: ShieldConfig | null = null;

/**
 * Load and parse the YAML config file.
 * Falls back to built-in defaults if the file is missing.
 */
export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): ShieldConfig {
  if (!fs.existsSync(configPath)) {
    console.warn(
      `[AgentShield] Config file not found at "${configPath}". Using built-in defaults.`
    );
    _config = DEFAULTS;
    return _config;
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = yaml.load(raw) as Partial<ShieldConfig>;

  // Deep merge with defaults so missing keys never crash
  _config = {
    version: parsed.version ?? DEFAULTS.version,
    risk: { ...DEFAULTS.risk, ...(parsed.risk ?? {}) },
    tools: parsed.tools?.length ? parsed.tools : DEFAULTS.tools,
    secrets: {
      enabled: parsed.secrets?.enabled ?? DEFAULTS.secrets.enabled,
      patterns: parsed.secrets?.patterns ?? DEFAULTS.secrets.patterns,
    },
    blocked_patterns: parsed.blocked_patterns ?? DEFAULTS.blocked_patterns,
    allowed_domains: {
      enabled: parsed.allowed_domains?.enabled ?? DEFAULTS.allowed_domains.enabled,
      list: parsed.allowed_domains?.list ?? DEFAULTS.allowed_domains.list,
    },
    audit: { ...DEFAULTS.audit, ...(parsed.audit ?? {}) },
  };

  return _config;
}

/** Return the cached config (loads on first call). */
export function getConfig(): ShieldConfig {
  if (!_config) return loadConfig();
  return _config;
}

/** Force a reload (useful for hot-reload or tests). */
export function reloadConfig(): ShieldConfig {
  _config = null;
  return loadConfig();
}

export function saveConfig(config: ShieldConfig): ShieldConfig {
  const configPath = DEFAULT_CONFIG_PATH;
  const directory = path.dirname(configPath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${configPath}.tmp`;
  fs.writeFileSync(temporaryPath, yaml.dump(config), "utf-8");
  fs.renameSync(temporaryPath, configPath);
  _config = config;
  return _config;
}
