import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  logger.error("ErrorHandler", `${req.method} ${req.path} → ${err.message}`, err.stack);

  const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;

  res.status(statusCode).json({
    error: err.message ?? "Internal server error",
  });
}
