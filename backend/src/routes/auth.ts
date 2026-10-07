import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { ErrorFactory } from "../errors/ErrorFactory";
import {
  createTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  refreshAccessToken,
} from "../tokenManager";
import { logger } from "../logger";

const router = Router();
const CTX = "Auth";

type AuthUser = {
  password: string;
  role: "admin" | "approver" | "auditor" | "agent";
  name: string;
  email: string;
};

const USERS: Record<string, AuthUser> = {
  admin: { password: "AgentShield29241", role: "admin", name: "Admin User", email: "admin@agentshield.local" },
  operator: { password: "security-ops", role: "approver", name: "Security Operator", email: "operator@agentshield.local" },
};

/**
 * POST /auth/register
 */
router.post("/register", (req: Request, res: Response) => {
  const { username, password, role = "operator" } = req.body as {
    username?: string;
    password?: string;
    role?: string;
  };

  if (!username?.trim() || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const key = username.toLowerCase().trim();

  if (USERS[key]) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const roleMap: Record<string, AuthUser["role"]> = {
    operator: "approver",
    approver: "approver",
    auditor: "auditor",
    agent: "agent",
  };
  const userRole = roleMap[role];
  if (!userRole) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const user: AuthUser = {
    password,
    role: userRole,
    name: username.trim(),
    email: `${key}@agentshield.local`,
  };
  const tokens = createTokenPair({
    userId: key,
    email: user.email,
    role: user.role,
  });
  USERS[key] = user;
  logger.info(CTX, `New user registered: ${key} (${userRole})`);

  res.status(201).json({
    message: "Account created successfully",
    access_token: tokens.accessToken,
    accessToken: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    refreshToken: tokens.refreshToken,
    token_type: "Bearer",
    expires_in: 900,
    user: { id: key, username: key, email: user.email, role: user.role, name: user.name },
  });
});

/**
 * POST /auth/login
 * Authenticate user and return JWT token pair
 */
router.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    const { username, email, password } = req.body as {
      username?: string;
      email?: string;
      password?: string;
    };

    if (!password) {
      throw ErrorFactory.invalidInput("password is required");
    }

    const userKey = (username ?? email ?? "").toLowerCase().split("@")[0]; // handle email format too
    const found = USERS[userKey];

    if (!found || found.password !== password) {
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
    const payload = verifyAccessToken(token) || verifyAccessToken(token);

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
