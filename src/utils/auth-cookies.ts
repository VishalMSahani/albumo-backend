import type { CookieOptions, Response } from "express";
import type { AuthResponse } from "./types.js";
import { ACCESS_SECONDS, secureDeployment } from "./auth-security.js";

export function cookieOptions(): CookieOptions {
  return { httpOnly: true, secure: secureDeployment(), sameSite: "lax", path: "/" };
}
export function clearAuthCookies(res: Response): void {
  res.clearCookie("accessToken", cookieOptions());
  res.clearCookie("refreshToken", { ...cookieOptions(), path: "/api/auth" });
  res.clearCookie("refreshToken", { ...cookieOptions(), path: "/api/auth/refresh" });
  // Remove legacy shared cookies if a domain was configured by an earlier deployment.
  const domain = process.env.COOKIE_DOMAIN?.trim();
  if (domain) {
    res.clearCookie("accessToken", { ...cookieOptions(), domain });
    res.clearCookie("refreshToken", { ...cookieOptions(), domain, path: "/api/auth/refresh" });
  }
}
export function setAuthCookies(res: Response, auth: AuthResponse): void {
  clearAuthCookies(res);
  res.cookie("accessToken", auth.accessToken, { ...cookieOptions(), maxAge: ACCESS_SECONDS * 1000 });
  res.cookie("refreshToken", auth.refreshToken, { ...cookieOptions(), path: "/api/auth", maxAge: Math.max(0, Date.parse(auth.sessionExpiresAt) - Date.now()) });
}
export function sendAuthResponse(res: Response, auth: AuthResponse, status = 200): void {
  setAuthCookies(res, auth);
  res.status(status).json({ success: true, data: { user: auth.user, expiresIn: auth.expiresIn, sessionExpiresAt: auth.sessionExpiresAt } });
}
