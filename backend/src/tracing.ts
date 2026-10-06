/**
 * tracing.ts
 *
 * Distributed tracing and structured logging infrastructure.
 * Integrates with OpenTelemetry for observability across services.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Trace context for correlating logs across services
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  startTime: number;
}

/**
 * Span for tracking operation duration and metadata
 */
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'success' | 'error' | 'cancelled';
  attributes: Record<string, any>;
  events: SpanEvent[];
  error?: Error;
}

/**
 * Span event for recording significant moments
 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, any>;
}

class TracingService {
  private activeSpans: Map<string, Span> = new Map();
  private traceContextStack: TraceContext[] = [];

  /**
   * Create a new trace context
   */
  createTraceContext(
    userId?: string,
    agentId?: string,
    sessionId?: string
  ): TraceContext {
    return {
      traceId: uuidv4(),
      spanId: uuidv4(),
      userId,
      agentId,
      sessionId,
      startTime: Date.now(),
    };
  }

  /**
   * Start a new span
   */
  startSpan(
    traceContext: TraceContext,
    spanName: string,
    attributes?: Record<string, any>
  ): Span {
    const span: Span = {
      traceId: traceContext.traceId,
      spanId: uuidv4(),
      parentSpanId: traceContext.spanId,
      name: spanName,
      startTime: Date.now(),
      status: 'success',
      attributes: attributes || {},
      events: [],
    };

    this.activeSpans.set(span.spanId, span);
    return span;
  }

  /**
   * End a span and calculate duration
   */
  endSpan(span: Span, status: 'success' | 'error' = 'success', error?: Error): void {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    span.error = error;

    this.activeSpans.delete(span.spanId);
  }

  /**
   * Add event to span
   */
  addSpanEvent(span: Span, eventName: string, attributes?: Record<string, any>): void {
    span.events.push({
      name: eventName,
      timestamp: Date.now(),
      attributes: attributes || {},
    });
  }

  /**
   * Set span attributes
   */
  setSpanAttributes(span: Span, attributes: Record<string, any>): void {
    span.attributes = { ...span.attributes, ...attributes };
  }

  /**
   * Get current trace context
   */
  getCurrentTraceContext(): TraceContext | undefined {
    return this.traceContextStack[this.traceContextStack.length - 1];
  }

  /**
   * Push trace context (for async operations)
   */
  pushTraceContext(context: TraceContext): void {
    this.traceContextStack.push(context);
  }

  /**
   * Pop trace context
   */
  popTraceContext(): TraceContext | undefined {
    return this.traceContextStack.pop();
  }

  /**
   * Export span as JSON for logging/storage
   */
  exportSpan(span: Span): Record<string, any> {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      startTime: new Date(span.startTime).toISOString(),
      endTime: span.endTime ? new Date(span.endTime).toISOString() : null,
      duration: span.duration,
      status: span.status,
      attributes: span.attributes,
      events: span.events.map((e) => ({
        name: e.name,
        timestamp: new Date(e.timestamp).toISOString(),
        attributes: e.attributes,
      })),
      error: span.error
        ? {
            name: span.error.name,
            message: span.error.message,
            stack: span.error.stack,
          }
        : null,
    };
  }

  /**
   * Get all active spans
   */
  getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values());
  }

  /**
   * Clear all spans (for memory management)
   */
  clearSpans(): void {
    this.activeSpans.clear();
  }
}

export const tracingService = new TracingService();

/**
 * Decorator for automatic span creation and error handling
 */
export function tracedFunction(functionName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const traceContext = tracingService.getCurrentTraceContext();
      if (!traceContext) {
        return originalMethod.apply(this, args);
      }

      const span = tracingService.startSpan(
        traceContext,
        functionName,
        { arguments: JSON.stringify(args) }
      );

      try {
        const result = await originalMethod.apply(this, args);
        tracingService.endSpan(span, 'success');
        return result;
      } catch (error) {
        tracingService.endSpan(span, 'error', error as Error);
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Structured logging with trace context
 */
export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  context: string;
  message: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  attributes?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class StructuredLogger {
  private logBuffer: LogEntry[] = [];
  private readonly MAX_BUFFER_SIZE = 10000;

  /**
   * Log with trace context
   */
  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    context: string,
    message: string,
    attributes?: Record<string, any>,
    error?: Error
  ): void {
    const traceContext = tracingService.getCurrentTraceContext();

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
      traceId: traceContext?.traceId,
      spanId: traceContext?.spanId,
      userId: traceContext?.userId,
      agentId: traceContext?.agentId,
      sessionId: traceContext?.sessionId,
      attributes,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : undefined,
    };

    this.logBuffer.push(logEntry);

    // Keep buffer under control
    if (this.logBuffer.length > this.MAX_BUFFER_SIZE) {
      this.logBuffer.shift();
    }

    // Also log to console in development
    if (process.env.NODE_ENV !== 'production') {
      this.logToConsole(logEntry);
    }
  }

  /**
   * Log to console
   */
  private logToConsole(entry: LogEntry): void {
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.context}]`;
    const traceInfo = entry.traceId ? ` trace=${entry.traceId.substring(0, 8)}` : '';

    const message = `${prefix}${traceInfo} ${entry.message}`;

    switch (entry.level) {
      case 'debug':
        console.debug(message, entry.attributes);
        break;
      case 'info':
        console.info(message, entry.attributes);
        break;
      case 'warn':
        console.warn(message, entry.attributes);
        break;
      case 'error':
        console.error(message, entry.error, entry.attributes);
        break;
    }
  }

  /**
   * Get logs for a trace
   */
  getLogsForTrace(traceId: string): LogEntry[] {
    return this.logBuffer.filter((log) => log.traceId === traceId);
  }

  /**
   * Export logs for shipping
   */
  exportLogs(filter?: (log: LogEntry) => boolean): LogEntry[] {
    if (!filter) {
      return [...this.logBuffer];
    }
    return this.logBuffer.filter(filter);
  }

  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logBuffer = [];
  }
}

export const structuredLogger = new StructuredLogger();

/**
 * Request/Response logging middleware
 */
export function requestLoggingMiddleware(req: any, res: any, next: any): void {
  const traceContext = tracingService.createTraceContext(
    req.user?.id,
    req.body?.agentId,
    req.body?.sessionId
  );

  tracingService.pushTraceContext(traceContext);

  const startTime = Date.now();
  const originalSend = res.send;

  res.send = function (data: any) {
    const duration = Date.now() - startTime;

    structuredLogger.log('info', 'HTTP', `${req.method} ${req.path} ${res.statusCode}`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
    });

    tracingService.popTraceContext();
    return originalSend.call(this, data);
  };

  next();
}
