import crypto from "crypto";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma.js";
import { sendEmailNotification } from "./email-notification.service.js";
import { EmailEventType } from "../generated/prisma/client.js";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function requestPasswordReset(email: string): Promise<void> {
  // Always return success to prevent email enumeration
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Delete any existing tokens for this user
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token: hashedToken,
      expiresAt,
    },
  });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

  await sendEmailNotification(
    email,
    EmailEventType.PASSWORD_RESET,
    {
      user: { name: user.name || email, email },
      resetUrl,
    },
    user.id
  );
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const hashedToken = hashToken(rawToken);

  const tokenRecord = await prisma.passwordResetToken.findUnique({
    where: { token: hashedToken },
    include: { user: true },
  });

  if (!tokenRecord) {
    throw new Error("Invalid or expired reset token");
  }
  if (tokenRecord.usedAt) {
    throw new Error("This reset link has already been used");
  }
  if (tokenRecord.expiresAt < new Date()) {
    throw new Error("This reset link has expired. Please request a new one.");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.emailCredential.updateMany({
      where: { userId: tokenRecord.userId },
      data: { passwordHash: hashedPassword },
    }),
    prisma.passwordResetToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    }),
    // Invalidate all active sessions so stolen sessions can't be used
    prisma.session.deleteMany({ where: { userId: tokenRecord.userId } }),
  ]);
}
