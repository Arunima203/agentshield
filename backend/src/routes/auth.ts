/**
 * auth.ts
 *
 * Authentication routes for login, logout, token verification, and refresh.
 */

import { Router, Request, Response } from 'express';
import { getUserByEmail, updateLastLogin, verifyPassword } from '../userManager';
import { createTokenPair, verifyAccessToken, verifyRefreshToken, refreshAccessToken } from '../tokenManager';
import { logger } from '../logger';

const router = Router();
const CTX = 'AuthRoutes';

/**
 * POST /auth/login
 * Authenticate user with email and password.
 */
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: 'Missing email or password',
    });
  }

  try {
    // Find user
    const user = await getUserByEmail(email);
    if (!user) {
      logger.warn(CTX, `Login attempt for non-existent user: ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.passwordHash);
    if (!passwordValid) {
      logger.warn(CTX, `Failed login attempt for user: ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await updateLastLogin(user.id);

    // Create token pair
    const tokens = createTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    logger.info(CTX, `User logged in: ${email}`);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch (err) {
    logger.error(CTX, `Login error: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /auth/refresh
 * Refresh an access token using a refresh token.
 */
router.post('/refresh', (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Missing refresh token' });
  }

  try {
    const newAccessToken = refreshAccessToken(refreshToken);
    if (!newAccessToken) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    res.json({
      accessToken: newAccessToken,
    });
  } catch (err) {
    logger.error(CTX, `Token refresh error: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * GET /auth/verify
 * Verify that the current access token is valid.
 */
router.get('/verify', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  res.json({
    message: 'Token is valid',
    user: {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    },
    expiresIn: '15m',
  });
});

/**
 * POST /auth/logout
 * Logout (currently just an acknowledgment; real logout would invalidate tokens server-side).
 */
router.post('/logout', (req: Request, res: Response) => {
  // In a production system, you'd add the token to a blacklist or revocation list
  logger.info(CTX, 'User logged out');
  res.json({ message: 'Logout successful' });
});

export default router;
