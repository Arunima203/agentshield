/**
 * jwtAuth.ts
 *
 * JWT authentication middleware.
 * Verifies Bearer token in Authorization header.
 */

import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../tokenManager";
import { logger } from "../logger";

const CTX = "JwtAuth";

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: "admin" | "approver" | "auditor" | "agent" | "guest";
  };
}

/**
 * Middleware to verify JWT token in Authorization header.
 * Extracts user info and attaches to request.
 */
export function jwtAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    logger.warn(CTX, `Unauthorized request: missing Bearer token from ${req.ip} to ${req.path}`);
    res.status(401).json({ error: "Unauthorized — missing or invalid token" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);

  if (!payload) {
    logger.warn(CTX, `Unauthorized request: invalid token from ${req.ip} to ${req.path}`);
    res.status(401).json({ error: "Unauthorized — invalid or expired token" });
    return;
  }

  // Attach user info to request for downstream handlers
  req.user = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  };

  logger.debug(CTX, `Authenticated request from user=${payload.email}`);
  next();
}
