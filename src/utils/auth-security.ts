import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_SECONDS = 15 * 60;
export const SESSION_SECONDS = 15 * 24 * 60 * 60;
export const secureDeployment = () => process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

export function authSecret(name: "JWT_SECRET" | "JWT_REFRESH_SECRET" | "AUTH_OTP_SECRET"): string {
  const value = process.env[name]?.trim();
  if (name === "AUTH_OTP_SECRET" && !value && !secureDeployment()) {
    const refreshSecret = authSecret("JWT_REFRESH_SECRET");
    return createHmac("sha256", refreshSecret)
      .update("roboroot:development:auth-otp")
      .digest("hex");
  }
  if (!value || value.length < 32 || /your-|replace-|change-in-production/i.test(value)) {
    throw new Error(`${name} must be configured with a random secret of at least 32 characters`);
  }
  if (name === "JWT_REFRESH_SECRET" && value === process.env.JWT_SECRET) throw new Error("Access and refresh signing secrets must be different");
  if (name === "AUTH_OTP_SECRET" && [process.env.JWT_SECRET, process.env.JWT_REFRESH_SECRET].includes(value)) throw new Error("OTP and session secrets must be different");
  return value;
}

export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
export const constantTimeEqual = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export const otpDigest = (id: string, code: string) => createHmac("sha256", authSecret("AUTH_OTP_SECRET")).update(`${id}:${code}`).digest("hex");

export function safeRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return "/";
  try {
    const parsed = new URL(value, "https://local.invalid");
    return parsed.origin === "https://local.invalid" ? parsed.pathname + parsed.search + parsed.hash : "/";
  } catch { return "/"; }
}
