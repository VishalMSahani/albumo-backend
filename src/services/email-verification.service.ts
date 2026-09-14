import { randomInt } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { constantTimeEqual, hashToken, otpDigest } from "../utils/auth-security.js";
import { queueAuthEmail } from "./auth-email.service.js";
import { emailDeliveryConfigured } from "./email.service.js";
import { AuthError } from "../utils/types.js";
import { logger } from "../lib/logger.js";

const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;
const MAX_EMAIL_OTP_ATTEMPTS = 5;

export async function sendVerificationEmail(userId: string, userEmail: string): Promise<void> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: {
      emailVerifyToken: otpDigest(userId, code),
      emailVerifyExpiry: new Date(Date.now() + EMAIL_OTP_TTL_MS),
      emailVerifyAttempts: 0,
    } }),
    prisma.emailNotification.deleteMany({ where: {
      userId, eventType: "USER_EMAIL_VERIFICATION", isSent: false,
    } }),
  ]);
  await queueAuthEmail(userEmail, "USER_EMAIL_VERIFICATION", {
    user: { name: userEmail, email: userEmail }, verificationCode: code, expiresIn: "10 minutes",
  }, userId);
}

/** Temporary compatibility for links sent before the email-OTP rollout. */
export async function verifyEmailToken(rawToken: string): Promise<void> {
  const verified = await prisma.user.updateMany({
    where: {
      emailVerifyToken: hashToken(rawToken),
      emailVerifyExpiry: { gt: new Date() },
      isActive: true,
    },
    data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpiry: null, emailVerifyAttempts: 0 },
  });
  if (!verified.count) throw new AuthError("This verification link is invalid or expired. Request an email code.", 400, "VERIFICATION_INVALID");
}

export async function verifyEmailOtp(email: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: {
    id: true, isActive: true, emailVerified: true, emailVerifyToken: true,
    emailVerifyExpiry: true, emailVerifyAttempts: true,
  } });
  if (user?.emailVerified && user.isActive) return;

  const digest = otpDigest(user?.id || "unknown-email", code);
  const storedDigest = user?.emailVerifyToken || otpDigest(user?.id || "unknown-email", "000000");
  const usable = Boolean(user?.isActive && user.emailVerifyExpiry && user.emailVerifyExpiry.getTime() > Date.now()
    && user.emailVerifyAttempts < MAX_EMAIL_OTP_ATTEMPTS);
  if (!usable || !constantTimeEqual(storedDigest, digest)) {
    if (user?.isActive && !user.emailVerified && user.emailVerifyAttempts < MAX_EMAIL_OTP_ATTEMPTS) {
      await prisma.user.updateMany({
        where: { id: user.id, emailVerified: false, emailVerifyAttempts: { lt: MAX_EMAIL_OTP_ATTEMPTS } },
        data: { emailVerifyAttempts: { increment: 1 } },
      });
    }
    throw new AuthError("That email code is incorrect or expired. Request a new code if needed.", 400, "EMAIL_OTP_INVALID");
  }

  const verified = await prisma.user.updateMany({
    where: {
      id: user!.id, isActive: true, emailVerified: false, emailVerifyToken: digest,
      emailVerifyExpiry: { gt: new Date() }, emailVerifyAttempts: { lt: MAX_EMAIL_OTP_ATTEMPTS },
    },
    data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpiry: null, emailVerifyAttempts: 0 },
  });
  if (verified.count !== 1) {
    throw new AuthError("That email code is incorrect or expired. Request a new code if needed.", 400, "EMAIL_OTP_INVALID");
  }
}

export async function resendVerificationEmail(email: string): Promise<void> {
  if (!emailDeliveryConfigured()) {
    throw new AuthError("Email verification is temporarily unavailable. Please try again later.", 503, "EMAIL_UNAVAILABLE");
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.isActive && !user.emailVerified) {
    try {
      await sendVerificationEmail(user.id, email);
    } catch (error) {
      // Prisma errors can contain OTP digests and query arguments; keep those out of logs.
      logger.error("Verification email delivery failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        reason: error instanceof Error && /^(AUTH_OTP_SECRET|JWT_REFRESH_SECRET|JWT_SECRET|OTP and session secrets|Access and refresh signing secrets)/.test(error.message)
          ? error.message : "Email preparation or queue delivery failed; check the email outbox and provider configuration",
      });
      throw new AuthError("We could not send the verification code. Please try again.", 503, "EMAIL_DELIVERY_FAILED");
    }
  }
}
