import jwt from "jsonwebtoken";
import type { JWTPayload } from "./types.js";
import { UnauthorizedError } from "./types.js";
import { ACCESS_SECONDS, authSecret } from "./auth-security.js";

export function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign({ ...payload, purpose: "access" }, authSecret("JWT_SECRET"), {
    algorithm: "HS256", expiresIn: ACCESS_SECONDS, issuer: "roboroot-api", audience: "roboroot-session",
  });
}

export function verifyAccessToken(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, authSecret("JWT_SECRET"), {
      algorithms: ["HS256"], issuer: "roboroot-api", audience: "roboroot-session",
    });
    if (typeof decoded === "string" || decoded.purpose !== "access" ||
        typeof decoded.userId !== "string" || typeof decoded.sessionId !== "string" ||
        typeof decoded.email !== "string" || typeof decoded.role !== "string") throw new Error();
    return { userId: decoded.userId, sessionId: decoded.sessionId, email: decoded.email, role: decoded.role };
  } catch { throw new UnauthorizedError("Session expired. Please sign in again."); }
}
export const getAccessTokenExpiresIn = () => ACCESS_SECONDS;
