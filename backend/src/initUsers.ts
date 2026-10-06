/**
 * initUsers.ts
 *
 * Initialize default users on startup.
 * This runs once when the database is first created.
 */

import { getUserByEmail, createUser } from './userManager';
import { logger } from './logger';

const CTX = 'InitUsers';

/**
 * Initialize default users if they don't already exist.
 */
export async function initializeDefaultUsers(): Promise<void> {
  try {
    // Check if admin already exists
    const adminExists = await getUserByEmail('admin@agentshield.local');
    if (adminExists) {
      logger.info(CTX, 'Default users already initialized');
      return;
    }

    // Create admin user
    await createUser('admin@agentshield.local', 'AgentShield2024!', 'admin');
    logger.info(CTX, 'Created default admin user');

    // Create approver user
    await createUser('approver@agentshield.local', 'ApprovalUser2024!', 'approver');
    logger.info(CTX, 'Created default approver user');

    // Create auditor user
    await createUser('auditor@agentshield.local', 'AuditUser2024!', 'auditor');
    logger.info(CTX, 'Created default auditor user');

    logger.info(CTX, 'Default users initialized successfully');
  } catch (err) {
    // Users might already exist
    if (err instanceof Error && err.message.includes('already exists')) {
      logger.info(CTX, 'Default users already initialized');
      return;
    }

    logger.error(CTX, `Failed to initialize default users: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
