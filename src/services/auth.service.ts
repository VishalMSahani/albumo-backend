import { prisma } from "../lib/prisma.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { AuthError, ConflictError, UnauthorizedError, NotFoundError, EmailVerificationRequiredError, type SignupRequest, type LoginRequest, type AuthResponse } from "../utils/types.js";
import { issueSession, publicUser, rotateSession } from "./session-auth.service.js";
import { limitAuth } from "./auth-throttle.service.js";
import { recordTermsAndPrivacyAcceptance, type ConsentAuditContext } from "../features/legal/legal.service.js";
import { phoneSchema } from "../validators/auth.validator.js";

export async function signupWithEmail(data: SignupRequest, audit: ConsentAuditContext = {}) {
  await limitAuth("signup-ip", audit.ipAddress || "unknown", 10, 3600);
  await limitAuth("signup-email", data.email, 3, 3600);
  const passwordHash = await hashPassword(data.password);
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new ConflictError("An account already exists with this email. Sign in or reset your password.");
  if (data.phone) {
    const mobileOwner = await prisma.user.findFirst({ where: { OR: [{ phone: data.phone }, { pendingPhone: data.phone }] }, select: { id: true } });
    if (mobileOwner) throw new ConflictError("This mobile number is already registered. Return to login.");
  }
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({ data: { email: data.email, name: data.name ?? null,
      pendingPhone: data.phone ?? null, college: data.college ?? null, credential: { create: { passwordHash } } } });
    await recordTermsAndPrivacyAcceptance({ userId: created.id, source: "REGISTRATION", payload: data.legalConsent, audit, client: tx });
    return created;
  });
  return { verificationRequired: true as const, email: data.email };
}

export async function loginWithEmail(data: LoginRequest, audit: ConsentAuditContext = {}): Promise<AuthResponse> {
  const identifier = data.email.trim().toLowerCase();
  const parsedPhone = phoneSchema.safeParse(identifier);
  await limitAuth("password-ip", audit.ipAddress || "unknown", 40, 900);
  await limitAuth("password-account", parsedPhone.success ? parsedPhone.data : identifier, 10, 900);
  const user = parsedPhone.success
    ? await prisma.user.findFirst({ where: { OR: [{ phone: parsedPhone.data }, { pendingPhone: parsedPhone.data }] }, include: { credential: true } })
    : await prisma.user.findUnique({ where: { email: identifier }, include: { credential: true } });
  // Equal-cost hash comparison when an account/password does not exist.
  const dummyHash = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.5UWmyyJJWI62dHWP7P4Qda97EEbgD9q";
  const valid = await comparePassword(data.password, user?.credential?.passwordHash ?? dummyHash);
  if (!user || !user.credential || !valid || !user.isActive) throw new UnauthorizedError("Incorrect email, phone number or password");
  const admin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
  if (!admin && !user.emailVerified && !user.phoneVerifiedAt) throw new EmailVerificationRequiredError(user.email);
  if (data.legalConsent) await recordTermsAndPrivacyAcceptance({ userId: user.id, source: "LOGIN", payload: data.legalConsent, audit });
  return issueSession(user, audit);
}

export const refreshAccessToken = rotateSession;

export async function logout(userId: string, sessionId?: string): Promise<void> {
  await prisma.session.updateMany({ where: { userId, ...(sessionId ? { id: sessionId } : {}), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function getUserById(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { credential: { select: { userId: true } } } });
  if (!user || !user.isActive) throw new NotFoundError("Account is unavailable");
  return { ...publicUser(user), hasPassword: Boolean(user.credential), createdAt: user.createdAt };
}

export type UpdateUserProfileInput = { name?: string | null; college?: string | null; avatarUrl?: string | null };
export async function updateUserProfile(userId: string, input: UpdateUserProfileInput) {
  const user = await prisma.user.update({ where: { id: userId }, data: input });
  return publicUser(user);
}

export async function setBackupPassword(userId: string, sessionId: string, newPassword: string, currentPassword?: string) {
  const [credential, session] = await Promise.all([
    prisma.emailCredential.findUnique({ where: { userId } }),
    prisma.session.findUnique({ where: { id: sessionId } }),
  ]);
  if (!session || session.userId !== userId || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedError();
  if (credential) {
    if (!currentPassword || !await comparePassword(currentPassword, credential.passwordHash)) throw new UnauthorizedError("Current password is incorrect");
  } else if (Date.now() - session.createdAt.getTime() > 600_000) {
    throw new AuthError("Sign in again with WhatsApp before adding a backup password.", 403, "REAUTH_REQUIRED");
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.emailCredential.upsert({ where: { userId }, create: { userId, passwordHash }, update: { passwordHash } }),
    prisma.session.updateMany({ where: { userId, id: { not: sessionId } }, data: { revokedAt: new Date() } }),
  ]);
}
