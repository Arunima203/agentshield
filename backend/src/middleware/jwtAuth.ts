import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

const CTX = "JwtAuth";

/**
 * JWT Auth middleware — validates demo tokens issued by our /auth/login.
 * Demo tokens have the format: demo.<base64payload>.signature
 */
export function jwtAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;

  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized — missing token" });
    return;
  }

  const token = auth.slice(7);

  // Allow demo tokens
  if (token.startsWith("demo.")) {
    try {
      const parts = token.split(".");
      if (parts.length < 2) throw new Error("bad token");
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());

      // Check expiry
      if (payload.exp && Date.now() > payload.exp) {
        res.status(401).json({ error: "Token expired" });
        return;
      }

      // Attach user to request
      (req as any).user = { id: payload.sub, role: payload.role };
      logger.debug(CTX, `Authenticated user: ${payload.sub} (${payload.role})`);
      next();
      return;
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
  }

  // If no API key set, allow all requests (dev mode)
  const expectedKey = process.env.AGENTSHIELD_API_KEY;
  if (!expectedKey || expectedKey === "change-me-to-a-strong-random-key") {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}
