import { Router, Request, Response } from "express";

const router = Router();

// Demo users — matches Deepak's frontend demo credentials
const DEMO_USERS: Record<string, { password: string; role: string; name: string }> = {
  admin: { password: "AgentShield29241", role: "admin", name: "Admin User" },
  operator: { password: "security-ops", role: "operator", name: "Security Operator" },
};

// Simple token — just base64 encoded username:role (no real JWT needed for demo)
function makeToken(username: string, role: string): string {
  const payload = Buffer.from(JSON.stringify({
    sub: username, role, iat: Date.now(), exp: Date.now() + 24 * 60 * 60 * 1000
  })).toString("base64");
  return `demo.${payload}.signature`;
}

/**
 * POST /auth/login
 */
router.post("/login", (req: Request, res: Response) => {
  const { username, email, password } = req.body as {
    username?: string; email?: string; password?: string;
  };

  const user = username ?? email ?? "";
  const key = user.toLowerCase().split("@")[0]; // handle email format too

  const found = DEMO_USERS[key];

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
