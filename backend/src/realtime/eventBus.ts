/**
 * eventBus.ts
 *
 * Centralized event bus for publishing real-time events.
 * Delivers events within one backend process. Redis transport is not configured.
 */

import { EventEmitter } from 'events';
import { logger } from '../logger';

const CTX = 'EventBus';

export interface RealtimeEvent {
  type: string;
  data: any;
  timestamp: string;
}

/**
 * Event bus implementation with Redis pub/sub support
 * Falls back to in-memory events for single-instance deployments
 */
export class RealtimeEventBus extends EventEmitter {
  constructor() {
    super();
    if (process.env.REDIS_URL) {
      logger.warn(CTX, 'REDIS_URL is set, but event delivery is process-local; multi-instance realtime is unavailable');
    }
  }

  /**
   * Publish approval created event
   */
  async publishApprovalCreated(approval: any): Promise<void> {
    this.emit('approval:created', approval);
    logger.debug(CTX, `Published approval:created (id: ${approval.id})`);
  }

  /**
   * Publish approval resolved event
   */
  async publishApprovalResolved(approval: any): Promise<void> {
    this.emit('approval:resolved', approval);
    logger.debug(CTX, `Published approval:resolved (id: ${approval.id})`);
  }

  /**
   * Publish new audit entry event
   */
  async publishAuditEntry(entry: any): Promise<void> {
    this.emit('audit:new', entry);
    logger.debug(CTX, `Published audit:new (tool_call_id: ${entry.toolCallId})`);
  }

  /**
   * Get whether Redis is being used
   */
  isUsingRedis(): boolean {
    return false;
  }
}

// Export singleton
export const eventBus = new RealtimeEventBus();
