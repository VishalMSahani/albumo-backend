import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { ValidationError, AuthError } from "../utils/types.js";

/**
 * Global error handler middleware
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error("request failed", {
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
  });

  // Handle known errors
  if (error instanceof AuthError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
    });
    return;
  }

  // Handle Prisma errors
  if (error.name === "PrismaClientKnownRequestError") {
    res.status(400).json({
      success: false,
      error: "Database operation failed",
      code: "DATABASE_ERROR",
    });
    return;
  }

  // Handle validation errors
  if (error instanceof ValidationError) {
    res.status(400).json({
      success: false,
      error: error.message,
      code: "VALIDATION_ERROR",
    });
    return;
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: "Internal server error",
    code: "INTERNAL_SERVER_ERROR",
  });
}

/**
 * 404 handler for unknown routes
 */
export function notFoundHandler(
  req: Request,
  res: Response
): void {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: "NOT_FOUND",
  });
}
