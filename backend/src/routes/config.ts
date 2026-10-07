import { Router, Request, Response } from "express";
import { getConfig, reloadConfig, saveConfig } from "../config";
import { asyncHandler } from "../middleware/asyncHandler";
import { ErrorFactory } from "../errors/ErrorFactory";
import { requireRole } from "../middleware/authorization";
import type { ShieldConfig } from "../types";

const router = Router();

/**
 * GET /config
 * Return the currently active configuration.
 */
router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const config = getConfig();
    res.json(config);
  })
);

/**
 * POST /config/reload
 * Force-reload the config file from disk.
 */
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req: Request, res: Response) => {
    const config = req.body as ShieldConfig;
    if (
      !config ||
      typeof config !== "object" ||
      !config.risk ||
      !Number.isFinite(config.risk.block_threshold) ||
      !Number.isFinite(config.risk.review_threshold) ||
      config.risk.review_threshold < 0 ||
      config.risk.block_threshold < 0 ||
      config.risk.block_threshold > 100 ||
      config.risk.review_threshold > config.risk.block_threshold ||
      !Array.isArray(config.tools) ||
      config.tools.some(
        (rule) =>
          !rule ||
          typeof rule.name !== "string" ||
          !rule.name.trim() ||
          !Number.isFinite(rule.risk_score) ||
          rule.risk_score < 0 ||
          rule.risk_score > 100 ||
          (rule.enabled !== undefined && typeof rule.enabled !== "boolean")
      ) ||
      !config.secrets ||
      typeof config.secrets.enabled !== "boolean" ||
      !Array.isArray(config.secrets.patterns) ||
      config.secrets.patterns.some(
        (pattern) =>
          !pattern ||
          typeof pattern.name !== "string" ||
          typeof pattern.regex !== "string"
      ) ||
      !Array.isArray(config.blocked_patterns) ||
      config.blocked_patterns.some(
        (pattern) =>
          !pattern ||
          typeof pattern.name !== "string" ||
          typeof pattern.regex !== "string" ||
          typeof pattern.reason !== "string"
      ) ||
      !config.allowed_domains ||
      typeof config.allowed_domains.enabled !== "boolean" ||
      !Array.isArray(config.allowed_domains.list) ||
      config.allowed_domains.list.some((domain) => typeof domain !== "string") ||
      !config.audit ||
      typeof config.audit.enabled !== "boolean" ||
      !Number.isFinite(config.audit.retention_days) ||
      config.audit.retention_days < 0
    ) {
      throw ErrorFactory.invalidInput("Invalid security configuration");
    }

    for (const pattern of [...config.secrets.patterns, ...config.blocked_patterns]) {
      try {
        new RegExp(pattern.regex, "i");
      } catch {
        throw ErrorFactory.invalidInput(`Invalid regex in pattern "${pattern.name}"`);
      }
    }

    res.json({ message: "Configuration saved", config: saveConfig(config) });
  })
);

router.post(
  "/reload",
  requireRole("admin"),
  asyncHandler(async (_req: Request, res: Response) => {
    const config = reloadConfig();
    res.json({ message: "Config reloaded", config });
  })
);

export default router;
