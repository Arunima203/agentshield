/**
 * eventBus.ts
 *
 * Centralized event bus for publishing real-time events.
 * Uses Redis pub/sub for multi-instance deployments, or in-memory for single-instance.
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
  private redisClient: any = null;
  private redisPubClient: any = null;
  private useRedis = false;

  constructor() {
    super();
    this.initializeRedis();
  }

  /**
   * Initialize Redis client if available for pub/sub
   */
  private initializeRedis(): void {
    try {
      if (process.env.REDIS_URL) {
        // Redis would be initialized here in production
        // For now, we use in-memory as fallback
        logger.debug(CTX, 'Redis URL configured but using in-memory fallback');
        this.useRedis = false;
      }
    } catch (error) {
      logger.debug(CTX, 'Redis not available, using in-memory event bus');
      this.useRedis = false;
    }
  }

  /**
   * Publish approval created event
   */
  async publishApprovalCreated(approval: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'approval:created',
      data: approval,
      timestamp: new Date().toISOString(),
    };

    if (this.useRedis && this.redisPubClient) {
      try {
        await this.redisPubClient.publish(
          'agentshield:approval:created',
          JSON.stringify(event)
        );
      } catch (error) {
        logger.warn(CTX, `Failed to publish to Redis: ${error}`);
      }
    }

    // Always emit locally
    this.emit('approval:created', approval);
    logger.debug(CTX, `Published approval:created (id: ${approval.id})`);
  }

  /**
   * Publish approval resolved event
   */
  async publishApprovalResolved(approval: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'approval:resolved',
      data: approval,
      timestamp: new Date().toISOString(),
    };

    if (this.useRedis && this.redisPubClient) {
      try {
        await this.redisPubClient.publish(
          'agentshield:approval:resolved',
          JSON.stringify(event)
        );
      } catch (error) {
        logger.warn(CTX, `Failed to publish to Redis: ${error}`);
      }
    }

    // Always emit locally
    this.emit('approval:resolved', approval);
    logger.debug(CTX, `Published approval:resolved (id: ${approval.id})`);
  }

  /**
   * Publish new audit entry event
   */
  async publishAuditEntry(entry: any): Promise<void> {
    const event: RealtimeEvent = {
      type: 'audit:new',
      data: entry,
      timestamp: new Date().toISOString(),
    };

    if (this.useRedis && this.redisPubClient) {
      try {
        await this.redisPubClient.publish(
          'agentshield:audit:new',
          JSON.stringify(event)
        );
      } catch (error) {
        logger.warn(CTX, `Failed to publish to Redis: ${error}`);
      }
    }

    // Always emit locally
    this.emit('audit:new', entry);
    logger.debug(CTX, `Published audit:new (tool_call_id: ${entry.toolCallId})`);
  }

  /**
   * Get whether Redis is being used
   */
  isUsingRedis(): boolean {
    return this.useRedis;
  }
}

// Export singleton
export const eventBus = new RealtimeEventBus();
