import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import type { Prisma, User, Session } from "../generated/prisma/client.js";
import { generateAccessToken } from "../utils/jwt.js";
import { ACCESS_SECONDS, SESSION_SECONDS, authSecret, constantTimeEqual, hashToken } from "../utils/auth-security.js";
import { AuthError, UnauthorizedError, type AuthResponse } from "../utils/types.js";
import type { ConsentAuditContext } from "../features/legal/legal.service.js";

export const publicUser = (user: User) => ({
  id: user.id, email: user.email, name: user.name, role: user.role,
  avatarUrl: user.avatarUrl, college: user.college, phone: user.phone, pendingPhone: user.pendingPhone,
  phoneVerified: Boolean(user.phoneVerifiedAt), emailVerified: user.emailVerified,
});

function refreshValue(id: string, version: number): string {
  const prefix = `${id}.${version}`;
  return `${prefix}.${createHmac("sha256", authSecret("JWT_REFRESH_SECRET")).update(`refresh:${prefix}`).digest("base64url")}`;
}

function response(user: User, session: Session): AuthResponse {
  return {
    user: publicUser(user),
    accessToken: generateAccessToken({ userId: user.id, email: user.email, role: user.role, sessionId: session.id }),
    refreshToken: refreshValue(session.id, session.refreshVersion),
    expiresIn: ACCESS_SECONDS, sessionExpiresAt: session.expiresAt.toISOString(),
  };
}

export async function issueSession(user: User, audit?: ConsentAuditContext, tx: Prisma.TransactionClient = prisma): Promise<AuthResponse> {
  if (!user.isActive) throw new UnauthorizedError("Account is unavailable");
  const id = randomUUID();
  authSecret("JWT_SECRET");
  const session = await tx.session.create({ data: {
    id, userId: user.id, token: hashToken(refreshValue(id, 0)),
    expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
    userAgent: audit?.userAgent?.slice(0, 600) ?? null, ipAddress: audit?.ipAddress ?? null,
  } });
  return response(user, session);
}

export function parseRefreshToken(token: string): { id: string; version: number } {
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[a-f0-9-]{36}$/.test(parts[0] ?? "") || !/^\d{1,9}$/.test(parts[1] ?? "")) throw new UnauthorizedError("Invalid session");
  const id = parts[0]!, version = Number(parts[1]);
  if (!constantTimeEqual(token, refreshValue(id, version))) throw new UnauthorizedError("Invalid session");
  return { id, version };
}

export async function rotateSession(token: string): Promise<AuthResponse> {
  const { id, version } = parseRefreshToken(token);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))::text`;
    const session = await tx.session.findUnique({ where: { id }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) return null;
    if (version !== session.refreshVersion) {
      // Parallel tabs and a retried response receive the same current refresh cookie.
      if (version === session.refreshVersion - 1 && session.rotatedAt && Date.now() - session.rotatedAt.getTime() < 10_000) return response(session.user, session);
      await tx.session.update({ where: { id }, data: { revokedAt: new Date() } });
      return null;
    }
    if (!constantTimeEqual(session.token, hashToken(token))) return null;
    const rotated = await tx.session.update({ where: { id }, data: {
      refreshVersion: { increment: 1 }, rotatedAt: new Date(), token: hashToken(refreshValue(id, version + 1)),
    } });
    return response(session.user, rotated);
  });
  if (!result) throw new UnauthorizedError("Session expired. Please sign in again.");
  return result;
}

export async function revokeSession(token?: string): Promise<void> {
  if (!token) return;
  let id: string;
  try { id = parseRefreshToken(token).id; } catch { return; }
  await prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function requireRecentAuthentication(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedError();
  if (Date.now() - session.createdAt.getTime() > 600_000) throw new AuthError("Please sign out and sign in again before linking a WhatsApp number.", 403, "REAUTH_REQUIRED");
}
