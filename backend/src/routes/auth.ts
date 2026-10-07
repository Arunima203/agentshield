import { Router, Request, Response } from "express";
import { logger } from "../logger";

const router = Router();
const CTX = "Auth";

// In-memory user store (persists until backend restarts)
const REGISTERED_USERS: Record<string, { password: string; role: string; name: string }> = {
  admin:    { password: "AgentShield29241", role: "admin",    name: "Admin User" },
  operator: { password: "security-ops",     role: "operator", name: "Security Operator" },
};

// Simple token — just base64 encoded username:role (no real JWT needed for demo)
function makeToken(username: string, role: string): string {
  const payload = Buffer.from(JSON.stringify({
    sub: username, role, iat: Date.now(), exp: Date.now() + 30 * 24 * 60 * 60 * 1000  // 30 days
  })).toString("base64");
  return `demo.${payload}.signature`;
}

/**
 * POST /auth/register
 */
router.post("/register", (req: Request, res: Response) => {
  const { username, password, role = "operator" } = req.body as {
    username?: string; password?: string; role?: string;
  };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const key = username.toLowerCase().trim();

  if (REGISTERED_USERS[key]) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const allowedRoles = ["admin", "operator", "auditor", "agent"];
  const userRole = allowedRoles.includes(role) ? role : "operator";

  REGISTERED_USERS[key] = {
    password,
    role: userRole,
    name: username,
  };

  logger.info(CTX, `New user registered: ${key} (${userRole})`);

  const token = makeToken(key, userRole);
  res.status(201).json({
    message: "Account created successfully",
    access_token: token,
    accessToken: token,
    token_type: "Bearer",
    user: { id: key, username: key, email: `${key}@agentshield.local`, role: userRole, name: username },
  });
});

/**
 * POST /auth/login
 */
router.post("/login", (req: Request, res: Response) => {
  const { username, email, password } = req.body as {
    username?: string; email?: string; password?: string;
  };

  const user = username ?? email ?? "";
  const key = user.toLowerCase().split("@")[0]; // handle email format too

  const found = REGISTERED_USERS[key];

  if (!found || found.password !== password) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = makeToken(key, found.role);
  res.json({
    access_token: token,
    accessToken: token,
    refresh_token: token,
    refreshToken: token,
    token_type: "Bearer",
    user: { id: key, username: key, email: `${key}@agentshield.local`, role: found.role, name: found.name },
  });
});

/**
 * POST /auth/refresh
 */
router.post("/refresh", (req: Request, res: Response) => {
  const { refresh_token, refreshToken } = req.body as { refresh_token?: string; refreshToken?: string };
  const token = refresh_token ?? refreshToken;
  if (!token) {
    res.status(401).json({ error: "No refresh token" });
    return;
  }
  res.json({ access_token: token, accessToken: token, token_type: "Bearer" });
});

/**
 * GET /auth/verify
 */
router.get("/verify", (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token" });
    return;
  }
  const token = auth.slice(7);
  try {
    const parts = token.split(".");
    if (parts.length < 2) throw new Error("bad token");
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    res.json({ valid: true, user: { id: payload.sub, username: payload.sub, role: payload.role } });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

/**
 * POST /auth/logout
 */
router.post("/logout", (_req: Request, res: Response) => {
  res.json({ message: "Logged out successfully" });
});

export default router;
