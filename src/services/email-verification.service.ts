import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { queueEmailNotification } from "./email-notification.service.js";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function sendVerificationEmail(userId: string, userEmail: string): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifyToken: rawToken, emailVerifyExpiry: expiry },
  });

  const verifyUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/verify-email?token=${rawToken}`;

  await queueEmailNotification(
    userEmail,
    "USER_EMAIL_VERIFICATION",
    { verifyUrl },
    userId,
  ).catch(() => null);
}

export async function verifyEmailToken(rawToken: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { emailVerifyToken: rawToken },
    select: { id: true, emailVerified: true, emailVerifyExpiry: true },
  });

  if (!user) throw Object.assign(new Error("Invalid or expired verification link"), { statusCode: 400 });
  if (user.emailVerified) return; // already verified — idempotent

  if (user.emailVerifyExpiry && user.emailVerifyExpiry < new Date()) {
    throw Object.assign(new Error("Verification link has expired. Please request a new one."), { statusCode: 410 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpiry: null },
  });
}

export async function resendVerificationEmail(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true },
  });

  if (!user || user.emailVerified) return; // silently succeed — no enumeration

  await sendVerificationEmail(user.id, email);
}
