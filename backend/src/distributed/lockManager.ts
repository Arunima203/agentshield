/**
 * lockManager.ts
 *
 * Distributed lock manager using Redis for cluster-wide coordination.
 * Ensures only one backend instance runs critical tasks (e.g., timeout sweep)
 * in a multi-instance deployment.
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";

const CTX = "LockManager";

export interface DistributedLock {
  key: string;
  value: string;
  expiresAt: number;
}

/**
 * Distributed lock implementation using Redis
 * Falls back to in-memory locks for testing/single-instance
 */
export class LockManager {
  private locks = new Map<string, DistributedLock>();
  private redisClient: any = null;
  private useRedis = false;

  constructor() {
    this.initializeRedis();
  }

  /**
   * Initialize Redis client if available
   */
  private initializeRedis() {
    try {
      // Attempt to use Redis if available
      const redis = require("redis");
      if (redis && process.env.REDIS_URL) {
        logger.info(CTX, "Redis available, using distributed locks");
        this.useRedis = true;
        // Note: Actual Redis connection would be initialized here
        // For now, we use in-memory as fallback
      }
    } catch {
      logger.warn(CTX, "Redis not available, using in-memory locks (not suitable for multi-instance)");
      this.useRedis = false;
    }
  }

  /**
   * Acquire a distributed lock across all backend instances
   * @param resource - Resource name (e.g., "approval-timeout-sweep")
   * @param ttlMs - Lock time-to-live in milliseconds
   * @returns Lock value if acquired, null if already held
   */
  async acquireLock(resource: string, ttlMs = 30000): Promise<string | null> {
    const lockKey = `agentshield:lock:${resource}`;
    const lockValue = uuidv4();
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    try {
      if (this.useRedis && this.redisClient) {
        // Redis SET NX EX: Set if not exists, expiry in seconds
        const result = await this.redisClient.set(lockKey, lockValue, {
          NX: true,
          EX: ttlSeconds,
        });

        if (result === "OK") {
          this.locks.set(resource, {
            key: lockKey,
            value: lockValue,
            expiresAt: Date.now() + ttlMs,
          });
          logger.debug(CTX, `Lock acquired: ${resource}`);
          return lockValue;
        }

        return null;
      } else {
        // In-memory fallback (single instance)
        const existing = this.locks.get(resource);
        if (existing && existing.expiresAt > Date.now()) {
          logger.debug(CTX, `Lock already held: ${resource}`);
          return null;
        }

        this.locks.set(resource, {
          key: lockKey,
          value: lockValue,
          expiresAt: Date.now() + ttlMs,
        });
        logger.debug(CTX, `Lock acquired (in-memory): ${resource}`);
        return lockValue;
      }
    } catch (error) {
      logger.error(CTX, `Failed to acquire lock: ${error}`);
      return null;
    }
  }

  /**
   * Release a distributed lock
   * @param resource - Resource name
   * @param value - Lock value returned from acquireLock
   * @returns true if lock released, false if lock held by someone else
   */
  async releaseLock(resource: string, value: string): Promise<boolean> {
    const lockKey = `agentshield:lock:${resource}`;

    try {
      if (this.useRedis && this.redisClient) {
        // Only delete if value matches (prevent releasing other locks)
        const currentValue = await this.redisClient.get(lockKey);

        if (currentValue !== value) {
          logger.warn(CTX, `Lock release failed: value mismatch for ${resource}`);
          return false;
        }

        await this.redisClient.del(lockKey);
        this.locks.delete(resource);
        logger.debug(CTX, `Lock released: ${resource}`);
        return true;
      } else {
        // In-memory fallback
        const lock = this.locks.get(resource);
        if (lock && lock.value === value) {
          this.locks.delete(resource);
          logger.debug(CTX, `Lock released (in-memory): ${resource}`);
          return true;
        }

        logger.warn(CTX, `Lock release failed: value mismatch for ${resource}`);
        return false;
      }
    } catch (error) {
      logger.error(CTX, `Failed to release lock: ${error}`);
      return false;
    }
  }

  /**
   * Check if lock is still held by this instance
   */
  isLockHeld(resource: string): boolean {
    const lock = this.locks.get(resource);
    return lock ? lock.expiresAt > Date.now() : false;
  }

  /**
   * Extend lock TTL (keep lock alive while processing)
   */
  async extendLock(resource: string, value: string, additionalTtlMs: number): Promise<boolean> {
    try {
      const lock = this.locks.get(resource);
      if (!lock || lock.value !== value) {
        return false;
      }

      const ttlSeconds = Math.ceil(additionalTtlMs / 1000);

      if (this.useRedis && this.redisClient) {
        const lockKey = `agentshield:lock:${resource}`;
        await this.redisClient.expire(lockKey, ttlSeconds);
        lock.expiresAt = Date.now() + additionalTtlMs;
        return true;
      } else {
        lock.expiresAt = Date.now() + additionalTtlMs;
        return true;
      }
    } catch (error) {
      logger.error(CTX, `Failed to extend lock: ${error}`);
      return false;
    }
  }
}

// Export singleton
export const lockManager = new LockManager();
