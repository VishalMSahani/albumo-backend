import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { UnauthorizedError, ForbiddenError } from "../utils/types.js";
import type { JWTPayload } from "../utils/types.js";

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * Middleware to authenticate requests using JWT
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Accept token from httpOnly cookie (preferred) or Authorization header (admin panel / mobile)
    const cookieToken = (req.cookies as Record<string, string>)?.accessToken;
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (cookieToken) {
      token = cookieToken;
    } else if (authHeader) {
      const parts = authHeader.split(" ");
      if (parts.length !== 2 || parts[0] !== "Bearer") {
        throw new UnauthorizedError("Invalid authorization header format. Use: Bearer <token>");
      }
      token = parts[1];
    }

    if (!token) {
      throw new UnauthorizedError("No authorization token provided");
    }

    // Verify and decode token
    const decoded = verifyAccessToken(token);

    // Attach user info to request
    req.user = decoded;

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: "Authentication failed",
      code: "AUTHENTICATION_FAILED",
    });
  }
}

/**
 * Middleware to check if user has required role
 */
export function authorize(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      // SUPER_ADMIN inherits all ADMIN permissions
      const effectiveRoles = allowedRoles.includes("ADMIN")
        ? [...allowedRoles, "SUPER_ADMIN"]
        : allowedRoles;

      if (!effectiveRoles.includes(req.user.role)) {
        throw new ForbiddenError(
          `Access denied. Required roles: ${allowedRoles.join(", ")}`
        );
      }

      next();
    } catch (error) {
      if (error instanceof ForbiddenError) {
        res.status(error.statusCode).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }

      if (error instanceof UnauthorizedError) {
        res.status(error.statusCode).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: "Authorization failed",
        code: "AUTHORIZATION_FAILED",
      });
    }
  };
}

/**
 * Optional authentication - doesn't fail if no token provided
 * Just attaches user info if valid token exists
 */
export function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Same dual-source logic as authenticate — cookie first, then header
    const cookieToken = (req.cookies as Record<string, string>)?.accessToken;
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (cookieToken) {
      token = cookieToken;
    } else if (authHeader) {
      const parts = authHeader.split(" ");
      if (parts.length === 2 && parts[0] === "Bearer") {
        token = parts[1];
      }
    }

    if (token) {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
    }

    next();
  } catch (error) {
    // Silently fail for optional authentication
    next();
  }
}
