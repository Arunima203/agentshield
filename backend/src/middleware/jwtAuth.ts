import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../tokenManager";

/**
 * Validate access tokens issued by /auth/login.
 */
export function jwtAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;

  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized — missing token" });
    return;
  }

  const token = auth.slice(7);
  const payload = verifyAccessToken(token);
  if (payload) {
    (req as any).user = {
      id: payload.userId,
      email: payload.email,
      role: payload.role,
    };
    next();
    return;
  }

  const expectedKey = process.env.AGENTSHIELD_API_KEY;
  if (
    expectedKey &&
    expectedKey !== "change-me-to-a-strong-random-key" &&
    token === expectedKey
  ) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized — invalid or expired access token" });
}
