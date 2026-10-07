/**
 * ErrorFactory.ts
 *
 * Centralized error creation and classification for standardized error responses.
 * All errors are normalized to the AppError type with consistent HTTP status codes.
 */

export enum ErrorCode {
  INVALID_INPUT = 'INVALID_INPUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  TIMEOUT = 'TIMEOUT',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  CONFLICT = 'CONFLICT',
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public statusCode: number,
    message: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ErrorFactory {
  static invalidInput(message: string, context?: any): AppError {
    return new AppError(ErrorCode.INVALID_INPUT, 400, message, context);
  }

  static internal(message: string, context?: any): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, 500, message, context);
  }

  static database(message: string, context?: any): AppError {
    return new AppError(ErrorCode.DATABASE_ERROR, 503, message, context);
  }

  static unauthorized(message: string): AppError {
    return new AppError(ErrorCode.UNAUTHORIZED, 401, message);
  }

  static forbidden(message: string): AppError {
    return new AppError(ErrorCode.FORBIDDEN, 403, message);
  }

  static notFound(resource: string): AppError {
    return new AppError(
      ErrorCode.RESOURCE_NOT_FOUND,
      404,
      `${resource} not found`
    );
  }

  static timeout(operation: string): AppError {
    return new AppError(
      ErrorCode.TIMEOUT,
      504,
      `Operation timed out: ${operation}`
    );
  }

  static serviceUnavailable(service: string): AppError {
    return new AppError(
      ErrorCode.SERVICE_UNAVAILABLE,
      503,
      `Service unavailable: ${service}`
    );
  }

  static conflict(message: string): AppError {
    return new AppError(ErrorCode.CONFLICT, 409, message);
  }

  /**
   * Convert unknown error to AppError
   */
  static fromUnknown(error: unknown, context?: any): AppError {
    if (error instanceof AppError) return error;

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      
      if (msg.includes('timeout')) {
        return this.timeout(error.message);
      }
      if (msg.includes('database') || msg.includes('econnrefused') || msg.includes('sql')) {
        return this.database(error.message, context);
      }
      if (msg.includes('unauthorized') || msg.includes('401')) {
        return this.unauthorized(error.message);
      }
      if (msg.includes('forbidden') || msg.includes('403')) {
        return this.forbidden(error.message);
      }
      if (msg.includes('not found') || msg.includes('404')) {
        return this.notFound('Resource');
      }
      
      return this.internal(error.message, context);
    }

    return this.internal(String(error), context);
  }

  /**
   * Check if error is an AppError
   */
  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }
}
