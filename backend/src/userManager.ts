/**
 * userManager.ts
 *
 * Manages user creation, password hashing, and user queries.
 * Uses bcrypt for secure password storage and PostgreSQL database.
 */

import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, queryNone } from './database';
import { logger } from './logger';

const CTX = 'UserManager';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'approver' | 'auditor' | 'agent' | 'guest';
  createdAt: string;
  updatedAt: string;
}

/**
 * Hash a password using bcrypt (cost factor: 10).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Compare a password with a hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Create a new user.
 */
export async function createUser(
  email: string,
  password: string,
  role: 'admin' | 'approver' | 'auditor' | 'agent' | 'guest' = 'guest'
): Promise<User> {
  try {
    const id = uuidv4();
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

    // Check if user already exists
    const existing = await queryOne<any>(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existing) {
      throw new Error(`User '${email}' already exists`);
    }

    // Insert new user
    const sql = `
      INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    await queryNone(sql, [id, email, passwordHash, role, now, now]);
    logger.info(CTX, `User created: email=${email} role=${role}`);

    return {
      id,
      email,
      passwordHash,
      role,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    logger.error(CTX, `Failed to create user: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get user by email.
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  try {
    const sql = 'SELECT * FROM users WHERE email = $1';
    const row = await queryOne<any>(sql, [email]);

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    logger.error(CTX, `Failed to get user by email: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get user by username (alias for email for backward compatibility).
 */
export async function getUserByUsername(username: string): Promise<User | null> {
  return getUserByEmail(username);
}

/**
 * Get user by ID.
 */
export async function getUserById(id: string): Promise<User | null> {
  try {
    const sql = 'SELECT * FROM users WHERE id = $1';
    const row = await queryOne<any>(sql, [id]);

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    logger.error(CTX, `Failed to get user by ID: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Update user's role.
 */
export async function updateUserRole(
  userId: string,
  newRole: 'admin' | 'approver' | 'auditor' | 'agent' | 'guest'
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const sql = 'UPDATE users SET role = $1, updated_at = $2 WHERE id = $3';
    await queryNone(sql, [newRole, now, userId]);
    logger.info(CTX, `User role updated: userId=${userId} newRole=${newRole}`);
  } catch (error) {
    logger.error(CTX, `Failed to update user role: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Update user's last login timestamp.
 */
export async function updateLastLogin(userId: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    const sql = 'UPDATE users SET updated_at = $1 WHERE id = $2';
    await queryNone(sql, [now, userId]);
    logger.debug(CTX, `Updated last login: userId=${userId}`);
  } catch (error) {
    logger.error(CTX, `Failed to update last login: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * List all users.
 */
export async function listUsers(): Promise<User[]> {
  try {
    const sql = 'SELECT * FROM users ORDER BY created_at DESC';
    const rows = await query<any>(sql);

    return (rows || []).map((row) => ({
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    logger.error(CTX, `Failed to list users: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Delete user by ID.
 */
export async function deleteUser(userId: string): Promise<void> {
  try {
    const sql = 'DELETE FROM users WHERE id = $1';
    await queryNone(sql, [userId]);
    logger.info(CTX, `User deleted: userId=${userId}`);
  } catch (error) {
    logger.error(CTX, `Failed to delete user: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
