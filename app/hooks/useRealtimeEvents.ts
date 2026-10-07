'use client';

/**
 * useRealtimeEvents.ts
 *
 * React hook for subscribing to real-time WebSocket events from AgentShield backend.
 * Provides live updates for approvals and audit log entries with automatic reconnection.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../contexts/auth';

export interface RealtimeSubscriptionOptions {
  room: 'approvals' | 'audit';
  filters?: Record<string, any>;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
}

export interface RealtimeEventHookState<T> {
  events: T[];
  connected: boolean;
  connectionError?: string;
  subscribe: () => void;
  unsubscribe: () => void;
}

/**
 * Hook for subscribing to real-time events
 * @param options Configuration for subscription
 * @returns Current events and subscription controls
 */
export function useRealtimeEvents<T = any>(
  options: RealtimeSubscriptionOptions
): RealtimeEventHookState<T> {
  const { username, accessToken } = useAuth();
  const [events, setEvents] = useState<T[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string>();
  const socketRef = useRef<Socket | null>(null);
  const reconnectAttempts = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  // Get backend URL
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';

  const subscribe = useCallback(() => {
    if (!username || !accessToken) {
      setConnectionError('Not authenticated');
      return;
    }

    if (socketRef.current?.connected) {
      socketRef.current.emit(`subscribe:${options.room}`, options.filters);
      return;
    }

    try {
      const socket = io(backendUrl, {
        auth: {
          token: accessToken,
        },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
        transports: ['websocket', 'polling'],
      });

      // Connection established
      socket.on('connect', () => {
        console.log('[RealtimeEvents] Connected to backend');
        setConnected(true);
        setConnectionError(undefined);
        reconnectAttempts.current = 0;

        // Subscribe to the specified room
        socket.emit(`subscribe:${options.room}`, options.filters);
        options.onConnect?.();
      });

      // Receive events
      socket.on('approval:created', (event: T) => {
        setEvents((prev) => [event, ...prev].slice(0, 100)); // Keep last 100
      });

      socket.on('approval:resolved', (event: T) => {
        setEvents((prev) => [event, ...prev].slice(0, 100));
      });

      socket.on('audit:new', (event: T) => {
        setEvents((prev) => [event, ...prev].slice(0, 100));
      });

      socket.on('subscribed', (msg: any) => {
        console.log('[RealtimeEvents] Subscription confirmed:', msg);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log('[RealtimeEvents] Disconnected from backend');
        setConnected(false);
        options.onDisconnect?.();
      });

      // Handle errors
      socket.on('error', (error: string) => {
        console.error('[RealtimeEvents] Socket error:', error);
        setConnectionError(error);
        options.onError?.(error);
      });

      socket.on('connect_error', (error: any) => {
        console.error('[RealtimeEvents] Connection error:', error);
        reconnectAttempts.current++;
        
        if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
          setConnectionError(`Failed to connect after ${MAX_RECONNECT_ATTEMPTS} attempts`);
        }
      });

      socketRef.current = socket;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[RealtimeEvents] Failed to setup WebSocket:', message);
      setConnectionError(message);
      options.onError?.(message);
    }
  }, [
    username,
    accessToken,
    options.room,
    options.filters,
    options.onConnect,
    options.onDisconnect,
    options.onError,
    backendUrl,
  ]);

  const unsubscribe = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit(`unsubscribe:${options.room}`);
    }
  }, [options.room]);

  // Connect on mount
  useEffect(() => {
    if (username && accessToken) {
      subscribe();
    }

    return () => {
      // Cleanup on unmount
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [username, accessToken, subscribe]);

  return {
    events,
    connected,
    connectionError,
    subscribe,
    unsubscribe,
  };
}

/**
 * Hook for approval events specifically
 */
export function useRealtimeApprovals() {
  return useRealtimeEvents({
    room: 'approvals',
  });
}

/**
 * Hook for audit log events specifically
 */
export function useRealtimeAudit(filters?: Record<string, any>) {
  return useRealtimeEvents({
    room: 'audit',
    filters,
  });
}
