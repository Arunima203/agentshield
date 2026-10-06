/**
 * authorization.ts
 *
 * Role-based access control (RBAC) and authorization middleware.
 * Protects sensitive endpoints and ensures proper permissions.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../logger';

const CTX = 'Authorization';

export type UserRole = 'admin' | 'approver' | 'auditor' | 'agent' | 'guest';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    permissions: Set<string>;
  };
}

/**
 * Role-based permission definitions
 */
const rolePermissions: Record<UserRole, Set<string>> = {
  admin: new Set([
    'inspect:read',
    'inspect:write',
    'approvals:read',
    'approvals:write',
    'config:read',
    'config:write',
    'audit:read',
    'audit:write',
    'users:read',
    'users:write',
    'monitoring:read',
  ]),
  approver: new Set([
    'inspect:read',
    'approvals:read',
    'approvals:write',
    'audit:read',
  ]),
  auditor: new Set([
    'audit:read',
    'monitoring:read',
  ]),
  agent: new Set([
    'inspect:write',
  ]),
  guest: new Set([
    'health:read',
  ]),
};

/**
 * Verify JWT token and extract user information
 */
export function verifyToken(token: string): AuthenticatedRequest['user'] | null {
  try {
    const secret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, secret) as any;
    const role: UserRole = (decoded.role || 'guest') as UserRole;
    
    return {
      id: decoded.sub || decoded.userId || decoded.id,
      email: decoded.email,
      role,
      permissions: rolePermissions[role] || rolePermissions.guest,
    };
  } catch (error) {
    logger.warn(CTX, `Token verification failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Authentication middleware
 * Extracts and validates JWT from Authorization header
 */
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.debug(CTX, `Missing or invalid authorization header from ${req.ip}`);
      res.status(401).json({ error: 'Missing authorization header' });
      return;
    }

    const token = authHeader.substring(7);
    const user = verifyToken(token);

    if (!user) {
      logger.warn(CTX, `Invalid token from ${req.ip}`);
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.user = user;
    logger.debug(CTX, `Authenticated user: ${user.email} (${user.role})`);
    next();
  } catch (error) {
    logger.error(CTX, `Authentication error: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Authorization middleware
 * Checks if user has required permissions
 */
export function authorize(...requiredPermissions: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      logger.warn(CTX, `Unauthorized access attempt from ${req.ip}`);
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const hasPermission = requiredPermissions.every((perm) => req.user!.permissions.has(perm));

    if (!hasPermission) {
      logger.warn(
        CTX,
        `Authorization failed for ${req.user.email}: required ${requiredPermissions.join(', ')}, has ${Array.from(req.user.permissions).join(', ')}`
      );
      res.status(403).json({ 
        error: 'Insufficient permissions',
        required: requiredPermissions,
        available: Array.from(req.user.permissions),
      });
      return;
    }

    logger.debug(CTX, `Authorization granted for ${req.user.email}`);
    next();
  };
}

/**
 * Role-based middleware
 * Checks if user has specific role
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(CTX, `Role check failed for ${req.user.email}: required ${allowedRoles.join(' or ')}, has ${req.user.role}`);
      res.status(403).json({ 
        error: 'Invalid role',
        required: allowedRoles,
        actual: req.user.role,
      });
      return;
    }

    next();
  };
}

/**
 * Optional authentication
 * Doesn't fail if no token, but authenticates if present
 */
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const user = verifyToken(token);
      
      if (user) {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    logger.debug(CTX, `Optional auth error: ${error instanceof Error ? error.message : String(error)}`);
    next();
  }
}

/**
 * Rate limiting by user/role
 * Different limits for different user types
 */
export function roleBasedRateLimit(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const limits: Record<UserRole, number> = {
    admin: 1000,      // 1000 req/min
    approver: 500,    // 500 req/min
    auditor: 200,     // 200 req/min
    agent: 100,       // 100 req/min
    guest: 10,        // 10 req/min
  };

  const userRole = req.user?.role || 'guest';
  const limit = limits[userRole];
  
  // Implementation would use a rate limiting store (Redis, etc.)
  // This is a placeholder
  logger.debug(CTX, `Rate limit for ${userRole}: ${limit} req/min`);
  next();
}

/**
 * Audit logging middleware
 * Logs all sensitive operations for compliance
 */
export function auditLog(action: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = req.user?.email || 'anonymous';
    const method = req.method;
    const path = req.path;
    const ip = req.ip;
    
    logger.info(CTX, `AUDIT: ${user} ${method} ${path} from ${ip} - ${action}`);
    
    // In production, write to audit database
    next();
  };
}

/**
 * IP whitelist middleware
 */
export function ipWhitelist(allowedIPs: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIP = req.ip || req.connection.remoteAddress || '';
    
    if (!allowedIPs.some((ip) => clientIP.includes(ip))) {
      logger.warn(CTX, `IP whitelist violation: ${clientIP}`);
      res.status(403).json({ error: 'Access denied: IP not whitelisted' });
      return;
    }
    
    next();
  };
}

/**
 * Get user's organization
 */
export function getUserOrganization(req: AuthenticatedRequest): string {
  return req.user?.id?.split('@')[1] || 'default';
}

/**
 * Check if user owns resource
 */
export function canAccessResource(req: AuthenticatedRequest, resourceOwnerId: string): boolean {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true; // Admins can access everything
  return req.user.id === resourceOwnerId;
}
