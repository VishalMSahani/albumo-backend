import { randomInt, randomUUID, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AuthError, ConflictError, UnauthorizedError, type AuthResponse } from "../utils/types.js";
import { hashToken, otpDigest, constantTimeEqual } from "../utils/auth-security.js";
import { sendWhatsAppOtp, whatsappOtpAvailable } from "../features/whatsapp/whatsapp-otp.service.js";
import { limitAuth } from "./auth-throttle.service.js";
import { issueSession, publicUser } from "./session-auth.service.js";
import { hashPassword } from "../utils/password.js";
import { recordTermsAndPrivacyAcceptance, type ConsentAuditContext } from "../features/legal/legal.service.js";
import { sendVerificationEmail } from "./email-verification.service.js";
import type { z } from "zod";
import type { completeSignupSchema } from "../validators/auth.validator.js";

const TTL_SECONDS = 300;
export async function requestPhoneCode(phone: string, audit: ConsentAuditContext, userId?: string) {
  if (!whatsappOtpAvailable()) throw new AuthError("WhatsApp sign-in is not available yet. Please use your password.", 503, "OTP_UNAVAILABLE");
  await limitAuth("otp-ip", audit.ipAddress || "unknown", 20, 3600);
  await limitAuth("otp-phone-hour", phone, 5, 3600);
  await limitAuth("otp-phone-day", phone, 10, 86400);
  await limitAuth("otp-cooldown", phone, 1, 60);
  const id = randomUUID(), code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const purpose = userId ? "link" : "login";
  await prisma.$transaction(async tx => {
    await tx.authChallenge.updateMany({ where: { phone, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.authChallenge.create({ data: {
      id, phone, purpose, userId: userId ?? null, codeHash: otpDigest(id, code), expiresAt: new Date(Date.now() + TTL_SECONDS * 1000),
    } });
  });
  try {
    await sendWhatsAppOtp(phone, code);
    await prisma.authChallenge.update({ where: { id }, data: { deliveredAt: new Date() } });
  } catch (error) {
    await prisma.authChallenge.update({ where: { id }, data: { consumedAt: new Date() } });
    throw error;
  }
  return { challengeId: id, expiresIn: TTL_SECONDS, resendAfter: 60, maskedPhone: `+91 ••••••${phone.slice(-4)}` };
}

export type PhoneAuthStart =
  | ({ kind: "otp" } & Awaited<ReturnType<typeof requestPhoneCode>>)
  | { kind: "password" }
  | { kind: "signup" };

/** Selects the next login step without trusting an unverified phone number. */
export async function startPhoneAuth(phone: string, audit: ConsentAuditContext): Promise<PhoneAuthStart> {
  await limitAuth("phone-start-ip", audit.ipAddress || "unknown", 30, 3600);
  if (whatsappOtpAvailable()) {
    // Once OTP is enabled, delivery failures must not fall through to an
    // account-dependent password/signup response. That would disclose whether
    // a phone number is registered whenever Meta is unavailable.
    return { kind: "otp", ...await requestPhoneCode(phone, audit) };
  }
  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone }, { pendingPhone: phone }] },
    select: { id: true, isActive: true },
  });
  return existing ? { kind: "password" } : { kind: "signup" };
}

export type PhoneVerification = { kind: "authenticated"; auth: AuthResponse } | { kind: "signup"; registrationToken: string } | { kind: "linked"; user: ReturnType<typeof publicUser> };

export async function verifyPhoneCode(id: string, code: string, legalConsent: unknown, audit: ConsentAuditContext, userId?: string): Promise<PhoneVerification> {
  await limitAuth("otp-verify-ip", audit.ipAddress || "unknown", 60, 900);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))::text`;
    const challenge = await tx.authChallenge.findUnique({ where: { id } });
    if (!challenge || challenge.purpose !== (userId ? "link" : "login") || challenge.userId !== (userId ?? null) ||
        !challenge.deliveredAt || challenge.consumedAt || challenge.verifiedAt || challenge.attempts >= 5 || challenge.expiresAt.getTime() <= Date.now()) return null;
    if (!constantTimeEqual(challenge.codeHash, otpDigest(id, code))) {
      await tx.authChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } });
      return null;
    }
    const now = new Date();
    const verifiedOwner = await tx.user.findUnique({ where: { phone: challenge.phone } });
    if (userId) {
      if (verifiedOwner && verifiedOwner.id !== userId) throw new ConflictError("This number is already linked to another account.");
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!current.isActive || (current.phone && current.phone !== challenge.phone)) throw new AuthError("Contact support to change an already verified number.", 403);
      const user = await tx.user.update({ where: { id: userId }, data: { phone: challenge.phone, pendingPhone: null, phoneVerifiedAt: now } });
      await tx.authChallenge.update({ where: { id }, data: { verifiedAt: now, consumedAt: now } });
      return { kind: "linked" as const, user: publicUser(user) };
    }
    const pendingOwner = verifiedOwner ? null : await tx.user.findUnique({ where: { pendingPhone: challenge.phone } });
    const existing = verifiedOwner || pendingOwner;
    if (existing) {
      if (!existing.isActive) throw new UnauthorizedError("Account is unavailable");
      if (existing.role === "ADMIN" || existing.role === "SUPER_ADMIN") throw new AuthError("Use the admin password sign-in for this account.", 403);
      const authenticated = pendingOwner || !existing.phoneVerifiedAt
        ? await tx.user.update({ where: { id: existing.id }, data: {
            phone: challenge.phone, pendingPhone: null, phoneVerifiedAt: now,
          } })
        : existing;
      if (!authenticated.phoneVerifiedAt) throw new UnauthorizedError("Account is unavailable");
      await tx.authChallenge.update({ where: { id }, data: { verifiedAt: now, consumedAt: now } });
      await recordTermsAndPrivacyAcceptance({ userId: authenticated.id, source: "LOGIN", payload: legalConsent, audit, client: tx });
      return { kind: "authenticated" as const, auth: await issueSession(authenticated, audit, tx) };
    }
    const proof = randomBytes(32).toString("base64url");
    await tx.authChallenge.update({ where: { id }, data: { verifiedAt: now, proofHash: hashToken(proof), expiresAt: new Date(Date.now() + 600_000) } });
    return { kind: "signup" as const, registrationToken: proof };
  });
  if (!result) throw new AuthError("That code is incorrect or expired. Request a new code if needed.", 400, "OTP_INVALID");
  return result;
}

export async function completePhoneSignup(input: z.infer<typeof completeSignupSchema>, audit: ConsentAuditContext): Promise<AuthResponse> {
  await limitAuth("signup-ip", audit.ipAddress || "unknown", 10, 3600);
  const passwordHash = await hashPassword(input.password);
  const result = await prisma.$transaction(async tx => {
    const challenge = await tx.authChallenge.findUnique({ where: { proofHash: hashToken(input.registrationToken) } });
    if (!challenge || challenge.purpose !== "login" || !challenge.verifiedAt || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) throw new AuthError("Your verification has expired. Please request a new code.", 400);
    if (await tx.user.findUnique({ where: { email: input.email } })) throw new ConflictError("Use your existing account's password or email recovery, then link your WhatsApp number in Settings.");
    if (await tx.user.findFirst({ where: { OR: [{ phone: challenge.phone }, { pendingPhone: challenge.phone }] }, select: { id: true } })) {
      throw new ConflictError("This mobile number is already registered. Return to login.");
    }
    const consumed = await tx.authChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new AuthError("Verification already used", 400);
    const user = await tx.user.create({ data: {
      email: input.email, name: input.name, phone: challenge.phone, phoneVerifiedAt: new Date(),
      credential: { create: { passwordHash } },
    } });
    await recordTermsAndPrivacyAcceptance({ userId: user.id, source: "REGISTRATION", payload: input.legalConsent, audit, client: tx });
    return issueSession(user, audit, tx);
  });
  // Phone verification grants access; email ownership is verified separately.
  await sendVerificationEmail(result.user.id, result.user.email).catch(() => undefined);
  return result;
}
