import { prisma } from "../lib/prisma.js";
import { hashToken } from "../utils/auth-security.js";
import { AuthError } from "../utils/types.js";

export async function limitAuth(bucket: string, subject: string, max: number, seconds: number): Promise<void> {
  const key = `${bucket}:${hashToken(subject)}`;
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "AuthThrottle" ("key", "count", "expiresAt")
    VALUES (${key}, 1, NOW() + ${seconds} * INTERVAL '1 second')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthThrottle"."expiresAt" <= NOW() THEN 1 ELSE "AuthThrottle"."count" + 1 END,
      "expiresAt" = CASE WHEN "AuthThrottle"."expiresAt" <= NOW() THEN NOW() + ${seconds} * INTERVAL '1 second' ELSE "AuthThrottle"."expiresAt" END
    RETURNING "count"`;
  if (!rows[0] || rows[0].count > max) throw new AuthError("Too many attempts. Please wait and try again.", 429, "AUTH_RATE_LIMITED");
}
