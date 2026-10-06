/**
 * tokenManager.ts
 *
 * Manages JWT token creation, verification, and refresh.
 */

import jwt from 'jsonwebtoken';
import { logger } from './logger';

const CTX = 'TokenManager';

export interface TokenPayload {
  userId: string;
  email: string;
  role: 'admin' | 'approver' | 'auditor' | 'agent' | 'guest';
  type: 'access' | 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Get JWT secret from env, generate a strong default if not set
function getAccessTokenSecret(): string {
  if (process.env.JWT_ACCESS_SECRET) {
    return process.env.JWT_ACCESS_SECRET
  }
  // In production, this MUST be set via environment variable
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_ACCESS_SECRET must be set in production')
  }
  // Development default
  return 'agentshield-dev-access-secret-change-in-production'
}

function getRefreshTokenSecret(): string {
  if (process.env.JWT_REFRESH_SECRET) {
    return process.env.JWT_REFRESH_SECRET
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_REFRESH_SECRET must be set in production')
  }
  return 'agentshield-dev-refresh-secret-change-in-production'
}

/**
 * Create access and refresh token pair.
 */
export function createTokenPair(payload: Omit<TokenPayload, 'type'>): TokenPair {
  const accessToken = jwt.sign({ ...payload, type: 'access' }, getAccessTokenSecret(), {
    expiresIn: '15m', // Access tokens expire in 15 minutes
    issuer: 'agentshield',
  })

  const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, getRefreshTokenSecret(), {
    expiresIn: '7d', // Refresh tokens expire in 7 days
    issuer: 'agentshield',
  })

  logger.debug(CTX, `Token pair created for user=${payload.userId}`)

  return { accessToken, refreshToken }
}

/**
 * Verify and decode access token.
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, getAccessTokenSecret(), {
      issuer: 'agentshield',
    }) as TokenPayload

    if (decoded.type !== 'access') {
      return null
    }

    return decoded
  } catch (err) {
    return null
  }
}

/**
 * Verify and decode refresh token.
 */
export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, getRefreshTokenSecret(), {
      issuer: 'agentshield',
    }) as TokenPayload

    if (decoded.type !== 'refresh') {
      return null
    }

    return decoded
  } catch (err) {
    return null
  }
}

/**
 * Refresh an access token using a valid refresh token.
 */
export function refreshAccessToken(refreshToken: string): string | null {
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    return null;
  }

  const newAccessToken = jwt.sign(
    {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      type: 'access',
    },
    getAccessTokenSecret(),
    {
      expiresIn: '15m',
      issuer: 'agentshield',
    }
  );

  logger.debug(CTX, `Access token refreshed for user=${payload.userId}`);

  return newAccessToken;
}

/**
 * Decode a token without verification (useful for expired tokens).
 */
export function decodeToken(token: string): TokenPayload | null {
  try {
    return jwt.decode(token) as TokenPayload | null
  } catch {
    return null
  }
}
