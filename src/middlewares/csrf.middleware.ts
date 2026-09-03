import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

/**
 * CSRF Protection — Double-Submit Cookie Pattern
 *
 * How it works:
 * 1. GET  /api/auth/csrf-token  → generates a random token, sets it in a
 *    **non-httpOnly** cookie (`csrf_token`) AND returns it in the JSON body.
 * 2. Frontend stores the token and attaches it as `x-csrf-token` header on
 *    every state-changing request (POST/PUT/PATCH/DELETE).
 * 3. This middleware compares the header value against the cookie value.
 *    If they don't match → 403.
 *
 * Why is this safe?
 * - A cross-site attacker CAN make the browser send the cookie, but they
 *   CANNOT read the cookie value (SameSite + secure flag) so they can't
 *   set the matching header.
 *
 * Configuration via env:
 *   CSRF_ENABLED=true|false   — default true in production, false in dev
 */

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
const TOKEN_BYTES = 32;

/** Safe (read-only) HTTP methods that don't need CSRF checks */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Paths exempted from CSRF (webhooks & OAuth callbacks that don't originate from the browser) */
const EXEMPT_PATHS = [
  "/api/payments/webhook",
  "/api/payments/razorpay/webhook",
  "/api/auth/google/callback",
  "/api/auth/github/callback",
  "/api/webhooks",
];

function isExempt(path: string): boolean {
  return EXEMPT_PATHS.some((p) => path.startsWith(p));
}

/**
 * Generate a fresh CSRF token, store it in a cookie, and return it.
 * Call this on page load or after login.
 */
export function csrfTokenHandler(req: Request, res: Response): void {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const isProd = process.env.NODE_ENV === "production";

  const cookieDomain = process.env.COOKIE_DOMAIN?.trim();

  const cookieOpts: Record<string, unknown> = {
    httpOnly: false,  // Frontend JS must be able to read this
    secure: isProd,
    sameSite: isProd ? "strict" : "lax",
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: "/",
  };

  if (isProd && cookieDomain) {
    cookieOpts.domain = cookieDomain;
  }

  res.cookie(CSRF_COOKIE, token, cookieOpts);

  res.json({
    success: true,
    data: { csrfToken: token },
  });
}

/**
 * Middleware — validates CSRF token on state-changing requests.
 * Must be mounted AFTER cookieParser().
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Check if CSRF is enabled
  const csrfEnabled =
    process.env.CSRF_ENABLED !== undefined
      ? process.env.CSRF_ENABLED === "true"
      : process.env.NODE_ENV === "production";

  if (!csrfEnabled) {
    next();
    return;
  }

  // Skip safe methods
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Skip exempt paths
  if (isExempt(req.path)) {
    next();
    return;
  }

  const cookieToken = (req.cookies as Record<string, string>)?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken) {
    logger.warn("CSRF token missing", {
      path: req.path,
      method: req.method,
      hasCookie: Boolean(cookieToken),
      hasHeader: Boolean(headerToken),
    });
    res.status(403).json({
      success: false,
      error: "CSRF token missing",
      code: "CSRF_TOKEN_MISSING",
    });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  if (
    cookieToken.length !== headerToken.length ||
    !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    logger.warn("CSRF token mismatch", { path: req.path, method: req.method });
    res.status(403).json({
      success: false,
      error: "CSRF token invalid",
      code: "CSRF_TOKEN_INVALID",
    });
    return;
  }

  next();
}
