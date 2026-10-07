/**
 * timeoutSweep.ts
 *
 * Background task that sweeps and times out expired approval requests.
 * Uses distributed locking to ensure only one backend instance runs the sweep
 * in a multi-instance cluster deployment.
 */

import { lockManager } from "../distributed/lockManager";
import { getDb, updateAuditApproval } from "../auditLogger";
import { logger } from "../logger";
import type { ApprovalRequest } from "../types";

const CTX = "TimeoutSweep";

// Configuration
const TIMEOUT_SWEEP_INTERVAL = process.env.TIMEOUT_SWEEP_INTERVAL
  ? Number(process.env.TIMEOUT_SWEEP_INTERVAL)
  : 60000; // 60 seconds default

const TIMEOUT_SWEEP_LOCK = "approval-timeout-sweep";
const LOCK_TTL = process.env.TIMEOUT_SWEEP_LOCK_TTL
  ? Number(process.env.TIMEOUT_SWEEP_LOCK_TTL)
  : 30000; // 30 seconds default

let sweepIntervalId: NodeJS.Timeout | null = null;

/**
 * Start the background timeout sweep task
 */
export function startTimeoutSweep(): void {
  if (sweepIntervalId) {
    logger.warn(CTX, "Timeout sweep already started");
    return;
  }

  // Run immediately on startup
  performTimeoutSweep().catch((error) => {
    logger.error(CTX, `Failed to run initial timeout sweep: ${error}`);
  });

  // Schedule recurring sweeps
  sweepIntervalId = setInterval(async () => {
    try {
      await performTimeoutSweep();
    } catch (error) {
      logger.error(CTX, `Unhandled error in timeout sweep: ${error}`);
    }
  }, TIMEOUT_SWEEP_INTERVAL);

  logger.info(CTX, `Started timeout sweep task (interval: ${TIMEOUT_SWEEP_INTERVAL}ms)`);
}

/**
 * Stop the background timeout sweep task
 */
export function stopTimeoutSweep(): void {
  if (sweepIntervalId) {
    clearInterval(sweepIntervalId);
    sweepIntervalId = null;
    logger.info(CTX, "Stopped timeout sweep task");
  }
}

/**
 * Perform a single timeout sweep iteration
 */
async function performTimeoutSweep(): Promise<void> {
  // Attempt to acquire distributed lock
  const lockValue = await lockManager.acquireLock(TIMEOUT_SWEEP_LOCK, LOCK_TTL);

  if (!lockValue) {
    logger.debug(CTX, "Lock held by another instance, skipping sweep");
    return;
  }

  try {
    // Find expired approval requests
    const db = await getDb();
    const now = Date.now();

    const stmt = db.prepare(
      `SELECT id, tool_call_id, created_at, timeout_ms
       FROM approval_requests
       WHERE status = 'pending' AND timeout_ms IS NOT NULL
       ORDER BY created_at ASC`
    );

    const toTimeout: Array<{
      id: string;
      tool_call_id: string;
      created_at: string;
      timeout_ms: number;
    }> = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        id: string;
        tool_call_id: string;
        created_at: string;
        timeout_ms: number;
      };

      const createdTime = new Date(row.created_at).getTime();
      if (now - createdTime >= row.timeout_ms) {
        toTimeout.push(row);
      }
    }
    stmt.free();

    if (toTimeout.length === 0) {
      logger.debug(CTX, "No expired approvals found");
      return;
    }

    logger.info(CTX, `Found ${toTimeout.length} expired approvals, processing...`);

    // Process each timeout (with error resilience)
    let processed = 0;
    let failed = 0;

    for (const item of toTimeout) {
      try {
        const ts = new Date().toISOString();

        // Update approval status
        db.run(
          `UPDATE approval_requests
           SET status = 'timeout', resolved_at = ?
           WHERE id = ? AND status = 'pending'`,
          [ts, item.id]
        );

        // Update audit log
        await updateAuditApproval(item.tool_call_id, "timeout", ts);

        processed++;
        logger.info(CTX, `Timed out approval: ${item.id}`);
      } catch (error) {
        failed++;
        logger.error(
          CTX,
          `Failed to timeout approval ${item.id}: ${error instanceof Error ? error.message : String(error)}`
        );
        // Continue with remaining approvals instead of failing entire sweep
      }
    }

    logger.info(
      CTX,
      `Timeout sweep completed: ${processed} processed, ${failed} failed (total: ${toTimeout.length})`
    );
  } catch (error) {
    logger.error(
      CTX,
      `Timeout sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      { error: error instanceof Error ? error.stack : String(error) }
    );
  } finally {
    // Always release lock to allow other instances to run sweep
    const released = await lockManager.releaseLock(TIMEOUT_SWEEP_LOCK, lockValue);
    if (!released) {
      logger.warn(CTX, "Failed to release timeout sweep lock");
    }
  }
}

/**
 * Get the current timeout sweep configuration
 */
export function getTimeoutSweepConfig() {
  return {
    interval: TIMEOUT_SWEEP_INTERVAL,
    lockTtl: LOCK_TTL,
    enabled: sweepIntervalId !== null,
  };
}
