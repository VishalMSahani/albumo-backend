import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { hashToken } from "../utils/auth-security.js";
import { hashPassword } from "../utils/password.js";
import { queueAuthEmail } from "./auth-email.service.js";
import { AuthError } from "../utils/types.js";

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !user.emailVerified) return;
  const token = randomBytes(32).toString("hex");
  await prisma.$transaction(async tx => {
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.create({ data: { userId: user.id, token: hashToken(token), expiresAt: new Date(Date.now() + 3_600_000) } });
  });
  const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password?token=${token}`;
  await queueAuthEmail(email, "PASSWORD_RESET", { user: { name: user.name || email, email }, resetUrl }, user.id);
}
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async tx => {
    const token = await tx.passwordResetToken.findUnique({ where: { token: hashToken(rawToken) } });
    if (!token || token.usedAt || token.expiresAt.getTime() <= Date.now()) throw new AuthError("Invalid or expired reset link", 400);
    const user = await tx.user.findUnique({ where: { id: token.userId } });
    if (!user?.isActive || !user.emailVerified) throw new AuthError("Account is unavailable", 400);
    const used = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new AuthError("Reset link already used", 400);
    await tx.emailCredential.upsert({ where: { userId: token.userId }, create: { userId: token.userId, passwordHash }, update: { passwordHash } });
    await tx.session.updateMany({ where: { userId: token.userId }, data: { revokedAt: new Date() } });
  });
}
