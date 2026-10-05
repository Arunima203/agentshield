import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

const CTX = "Auth";

/**
 * Simple API-key authentication middleware.
 *
 * Reads the key from AGENTSHIELD_API_KEY env var.
 * If the env var is not set, auth is DISABLED (development mode).
 *
 * Clients must send:  Authorization: Bearer <api-key>
 *                 or: X-Api-Key: <api-key>
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env.AGENTSHIELD_API_KEY;

  if (!expectedKey || expectedKey === "change-me-to-a-strong-random-key") {
    logger.warn(CTX, "API key auth is DISABLED — set AGENTSHIELD_API_KEY to enable it");
    next();
    return;
  }

  const bearerHeader = req.headers.authorization;
  const xApiKey = req.headers["x-api-key"] as string | undefined;

  let providedKey: string | undefined;

  if (bearerHeader?.startsWith("Bearer ")) {
    providedKey = bearerHeader.slice(7);
  } else if (xApiKey) {
    providedKey = xApiKey;
  }

  if (!providedKey || providedKey !== expectedKey) {
    logger.warn(CTX, `Unauthorized request from ${req.ip} to ${req.path}`);
    res.status(401).json({ error: "Unauthorized — invalid or missing API key" });
    return;
  }

  next();
}
