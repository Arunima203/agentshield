/**
 * socketServer.ts
 *
 * Real-time WebSocket server using Socket.io for live approval updates.
 * Provides live event delivery to connected clients with automatic fallback to polling.
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer, Server as HTTPServer } from 'http';
import express, { Application } from 'express';
import { verifyAccessToken } from '../tokenManager';
import { logger } from '../logger';

const CTX = 'SocketServer';

export interface SocketUser {
  userId: string;
  email: string;
  role: string;
}

/**
 * Setup Socket.io server on an Express app
 */
export function setupSocketIO(app: Application): { httpServer: HTTPServer; io: SocketIOServer } {
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  /**
   * JWT authentication middleware for Socket.io
   */
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication token missing'));
      }

      const payload = verifyAccessToken(token);
      if (!payload) {
        return next(new Error('Invalid or expired token'));
      }

      // Store user info in socket data
      (socket.data as any).user = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
      } as SocketUser;

      next();
    } catch (error) {
      next(new Error(`Authentication error: ${error instanceof Error ? error.message : String(error)}`));
    }
  });

  /**
   * Connection handler
   */
  io.on('connection', (socket: Socket) => {
    const user = (socket.data as any).user as SocketUser;
    logger.info(CTX, `Client connected: ${socket.id} (user: ${user.userId})`);

    /**
     * Subscribe to approval updates
     */
    socket.on('subscribe:approvals', () => {
      socket.join('room:approvals');
      logger.debug(CTX, `${socket.id} subscribed to approvals`);
      socket.emit('subscribed', { room: 'approvals', message: 'Now receiving approval updates' });
    });

    /**
     * Unsubscribe from approval updates
     */
    socket.on('unsubscribe:approvals', () => {
      socket.leave('room:approvals');
      logger.debug(CTX, `${socket.id} unsubscribed from approvals`);
    });

    /**
     * Subscribe to audit log updates
     */
    socket.on('subscribe:audit', (filters?: Record<string, any>) => {
      socket.join('room:audit');
      (socket.data as any).auditFilters = filters || {};
      logger.debug(CTX, `${socket.id} subscribed to audit with filters:`, filters);
      socket.emit('subscribed', { room: 'audit', message: 'Now receiving audit updates' });
    });

    /**
     * Unsubscribe from audit updates
     */
    socket.on('unsubscribe:audit', () => {
      socket.leave('room:audit');
      logger.debug(CTX, `${socket.id} unsubscribed from audit`);
    });

    /**
     * Health check / keep-alive
     */
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    /**
     * Disconnect handler
     */
    socket.on('disconnect', () => {
      logger.info(CTX, `Client disconnected: ${socket.id} (user: ${user.userId})`);
    });

    /**
     * Error handler
     */
    socket.on('error', (error) => {
      logger.error(CTX, `Socket error for ${socket.id}: ${error}`);
    });
  });

  logger.info(CTX, 'Socket.io server initialized');

  return { httpServer, io };
}

// Global Socket.io instance
let globalIO: SocketIOServer | null = null;

export function setGlobalIO(io: SocketIOServer): void {
  globalIO = io;
}

export function getGlobalIO(): SocketIOServer | null {
  return globalIO;
}

/**
 * Emit approval created event to all connected clients
 */
export function emitApprovalCreated(approval: any): void {
  if (!globalIO) return;
  globalIO.to('room:approvals').emit('approval:created', approval);
  logger.debug(CTX, `Emitted approval:created to approvals room (id: ${approval.id})`);
}

/**
 * Emit approval resolved event to all connected clients
 */
export function emitApprovalResolved(approval: any): void {
  if (!globalIO) return;
  globalIO.to('room:approvals').emit('approval:resolved', approval);
  logger.debug(CTX, `Emitted approval:resolved to approvals room (id: ${approval.id})`);
}

/**
 * Emit new audit entry to all connected clients subscribed to audit
 */
export function emitAuditEntry(entry: any): void {
  if (!globalIO) return;
  globalIO.to('room:audit').emit('audit:new', entry);
  logger.debug(CTX, `Emitted audit:new to audit room (tool_call_id: ${entry.toolCallId})`);
}
