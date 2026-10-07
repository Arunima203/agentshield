import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";
import { AppError, ErrorFactory } from "../errors/ErrorFactory";
import { v4 as uuidv4 } from "uuid";

const CTX = "ErrorHandler";

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Convert to AppError if needed
  const appError = err instanceof AppError ? err : ErrorFactory.fromUnknown(err, { path: req.path });

  // Generate request ID for correlation
  const requestId = (req as any).id || uuidv4();

  // Log error with full context
  logger.error(CTX, `[${requestId}] ${appError.code}: ${appError.message}`, {
    statusCode: appError.statusCode,
    path: req.path,
    method: req.method,
    context: appError.context,
    stack: appError.stack,
  });

  // Send standardized error response
  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(process.env.NODE_ENV === "development" && appError.context && { details: appError.context }),
    },
    requestId,
  });
}
