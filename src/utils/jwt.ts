import jwt from "jsonwebtoken";
import type { JWTPayload, TokenPair } from "./types.js";
import { UnauthorizedError } from "./types.js";

const JWT_SECRET: jwt.Secret = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_REFRESH_SECRET: jwt.Secret = process.env.JWT_REFRESH_SECRET || "your-refresh-secret-change-in-production";
const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || "1h"; // 1 hour
const JWT_REFRESH_EXPIRES_IN: string = process.env.JWT_REFRESH_EXPIRES_IN || "1d"; // 1 day

/**
 * Generate access and refresh tokens
 */
export function generateTokenPair(payload: JWTPayload): TokenPair {
  // @ts-expect-error - expiresIn type issue with jsonwebtoken
  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  // @ts-expect-error - expiresIn type issue with jsonwebtoken
  const refreshToken = jwt.sign(
    { userId: payload.userId, sessionId: payload.sessionId },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );

  return { accessToken, refreshToken };
}

/**
 * Verify and decode access token
 */
export function verifyAccessToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Access token expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError("Invalid access token");
    }
    throw new UnauthorizedError("Token verification failed");
  }
}

/**
 * Verify and decode refresh token
 */
export function verifyRefreshToken(token: string): { userId: string; sessionId?: string } {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as { userId: string; sessionId?: string };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Refresh token expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError("Invalid refresh token");
    }
    throw new UnauthorizedError("Token verification failed");
  }
}

/**
 * Get token expiration time in seconds
 */
export function getAccessTokenExpiresIn(): number {
  const expiresIn = JWT_EXPIRES_IN;
  
  // Parse time string (e.g., "15m", "1h", "7d")
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) return 900; // Default 15 minutes

  const value = parseInt(match[1] || "0");
  const unit = match[2];

  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    case "d":
      return value * 86400;
    default:
      return 900;
  }
}
