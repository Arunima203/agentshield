import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import { asyncHandler } from "../middleware/asyncHandler";
import { ErrorFactory } from "../errors/ErrorFactory";
import { createAuthUser, getAuthUser } from "../auditLogger";
import {
  createTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  refreshAccessToken,
} from "../tokenManager";

const router = Router();

export async function seedDemoUsers(): Promise<void> {
  const demoUsers = process.env.NODE_ENV === "production"
    ? (() => {
        const username = process.env.INITIAL_ADMIN_USERNAME?.trim().toLowerCase();
        const password = process.env.INITIAL_ADMIN_PASSWORD;
        if (!username || !/^[a-z0-9._-]{3,32}$/.test(username) ||
            !password || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
          throw new Error("Set a valid INITIAL_ADMIN_USERNAME and a 12-72 byte INITIAL_ADMIN_PASSWORD in production");
        }
        return [{ username, password, role: "admin" as const, name: "Administrator" }];
      })()
    : [
        { username: "admin", password: "AgentShield29241", role: "admin" as const, name: "Admin User" },
        { username: "operator", password: "security-ops", role: "approver" as const, name: "Security Operator" },
      ];

  for (const demoUser of demoUsers) {
    if (await getAuthUser(demoUser.username)) continue;
    await createAuthUser({
      username: demoUser.username,
      email: `${demoUser.username}@agentshield.local`,
      passwordHash: await bcrypt.hash(demoUser.password, 12),
      role: demoUser.role,
      name: demoUser.name,
    });
  }
}

/**
 * POST /auth/register
 */
router.post("/register", asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { username?: unknown; password?: unknown; role?: unknown } | null;
  const username = body?.username;
  const password = body?.password;
  const role = body?.role ?? "operator";

  if (typeof username !== "string" || !username.trim() ||
      typeof password !== "string" || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    res.status(400).json({ error: "Password must be no more than 72 bytes" });
    return;
  }

  const key = username.toLowerCase().trim();
  if (!/^[a-z0-9._-]{3,32}$/.test(key)) {
    res.status(400).json({ error: "Username must be 3-32 characters (letters, numbers, . _ -)" });
    return;
  }
  if (await getAuthUser(key)) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const roleMap: Record<string, "approver" | "auditor" | "agent"> = {
    operator: "approver",
    approver: "approver",
    auditor: "auditor",
    agent: "agent",
  };
  const userRole = typeof role === "string" ? roleMap[role] : undefined;
  if (!userRole) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const email = `${key}@agentshield.local`;
  const user = {
    username: key,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: userRole,
    name: username.trim(),
  };
  try {
    await createAuthUser(user);
  } catch (error) {
    if (await getAuthUser(key)) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    throw error;
  }

  const tokens = createTokenPair({
    userId: key,
    email,
    role: user.role,
  });

  res.status(201).json({
    message: "Account created successfully",
    access_token: tokens.accessToken,
    accessToken: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    refreshToken: tokens.refreshToken,
    token_type: "Bearer",
    expires_in: 900,
    user: { id: key, username: key, email, role: user.role, name: user.name },
  });
}));

/**
 * POST /auth/login
 * Authenticate user and return JWT token pair
 */
router.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as {
      username?: unknown;
      email?: unknown;
      password?: unknown;
    } | null;
    const username = typeof body?.username === "string" ? body.username : undefined;
    const email = typeof body?.email === "string" ? body.email : undefined;
    const password = body?.password;

    if (typeof password !== "string" || !password) {
      throw ErrorFactory.invalidInput("password is required");
    }

    const suppliedUsername = (username ?? email ?? "").toLowerCase().trim();
    const userKey = suppliedUsername.includes("@")
      ? suppliedUsername.slice(0, suppliedUsername.indexOf("@"))
      : suppliedUsername;
    const found = await getAuthUser(userKey);

    if (!found || !(await bcrypt.compare(password, found.passwordHash))) {
      throw ErrorFactory.unauthorized("Invalid credentials");
    }

    // Create JWT token pair
    const tokens = createTokenPair({
      userId: userKey,
      email: found.email,
      role: found.role,
    });

    res.json({
      access_token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      refreshToken: tokens.refreshToken,
      token_type: "Bearer",
      expires_in: 900, // 15 minutes in seconds
      user: {
        id: userKey,
        username: userKey,
        email: found.email,
        role: found.role,
        name: found.name,
      },
    });
  })
);

/**
 * POST /auth/refresh
 * Refresh an expired access token using a valid refresh token
 */
router.post(
  "/refresh",
  asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token, refreshToken } = req.body as {
      refresh_token?: string;
      refreshToken?: string;
    };

    const token = refresh_token ?? refreshToken;
    if (!token) {
      throw ErrorFactory.invalidInput("refresh_token is required");
    }

    // Verify refresh token is valid
    const payload = verifyRefreshToken(token);
    if (!payload) {
      throw ErrorFactory.unauthorized("Invalid or expired refresh token");
    }

    // Issue new access token
    const newAccessToken = refreshAccessToken(token);
    if (!newAccessToken) {
      throw ErrorFactory.internal("Failed to refresh token");
    }

    res.json({
      access_token: newAccessToken,
      accessToken: newAccessToken,
      token_type: "Bearer",
      expires_in: 900, // 15 minutes in seconds
    });
  })
);

/**
 * GET /auth/verify
 * Verify current access token validity
 */
router.get(
  "/verify",
  asyncHandler(async (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      throw ErrorFactory.unauthorized("No token provided");
    }

    const token = auth.slice(7);
    const payload = verifyAccessToken(token);

    if (!payload) {
      throw ErrorFactory.unauthorized("Invalid or expired token");
    }

    res.json({
      valid: true,
      user: {
        id: payload.userId,
        username: payload.userId,
        email: payload.email,
        role: payload.role,
      },
    });
  })
);

/**
 * POST /auth/logout
 * Logout user (in stateless JWT, this is mainly for client-side cleanup)
 */
router.post(
  "/logout",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ message: "Logged out successfully" });
  })
);

export default router;
