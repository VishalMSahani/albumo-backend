import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import { generateTokenPair, verifyRefreshToken, getAccessTokenExpiresIn } from "../utils/jwt.js";
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
  type SignupRequest,
  type LoginRequest,
  type AuthResponse,
  type JWTPayload,
} from "../utils/types.js";
import { ConsentSource, UserRole } from "../generated/prisma/client.js";
import { queueEmailNotification } from "./email-notification.service.js";
import { sendVerificationEmail } from "./email-verification.service.js";
import {
  recordTermsAndPrivacyAcceptance,
  validateLegalAcceptance,
  type ConsentAuditContext,
} from "../features/legal/legal.service.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_SECONDS = 15 * 60; // 15 minutes
const LOCKOUT_DURATION_SECONDS = 30 * 60; // 30 minutes

function loginFailKey(email: string) { return `login_fail:${email}`; }
function loginLockKey(email: string) { return `login_lock:${email}`; }

async function checkLoginLock(email: string): Promise<void> {
  if (!redis) return;
  const locked = await redis.get(loginLockKey(email));
  if (locked) throw new UnauthorizedError("Account temporarily locked due to too many failed attempts. Try again in 30 minutes.");
}

async function recordFailedLogin(email: string): Promise<void> {
  if (!redis) return;
  const key = loginFailKey(email);
  const count = await redis.incr(key);
  await redis.expire(key, LOCKOUT_WINDOW_SECONDS);
  if (count >= MAX_FAILED_ATTEMPTS) {
    await redis.set(loginLockKey(email), "1", "EX", LOCKOUT_DURATION_SECONDS);
    await redis.del(key);
  }
}

async function clearLoginFailures(email: string): Promise<void> {
  if (!redis) return;
  await redis.del(loginFailKey(email), loginLockKey(email));
}

/**
 * Register a new user with email and password
 */
export async function signupWithEmail(
  data: SignupRequest,
  audit?: ConsentAuditContext,
): Promise<AuthResponse> {
  validateLegalAcceptance(data.legalConsent);
  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });

  if (existingUser) {
    throw new ConflictError("User with this email already exists");
  }

  // Hash password
  const passwordHash = await hashPassword(data.password);

  // Create user and credential in a transaction
  const user = await prisma.$transaction(async (tx) => {
    // Create user
    const newUser = await tx.user.create({
      data: {
        email: data.email,
        name: data.name ?? null,
        college: data.college ?? null,
        role: UserRole.STUDENT,
        isActive: true,
      },
    });

    // Create email credential
    await tx.emailCredential.create({
      data: {
        userId: newUser.id,
        passwordHash,
      },
    });

    await recordTermsAndPrivacyAcceptance({
      userId: newUser.id,
      source: ConsentSource.REGISTRATION,
      payload: data.legalConsent,
      ...(audit ? { audit } : {}),
      client: tx,
    });

    return newUser;
  });

  // Create session
  const session = await createSession(user.id, audit?.userAgent, audit?.ipAddress);

  // Generate tokens
  const tokens = generateTokenPair({
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId: session.id,
  });

  // Send welcome + verification emails (async - don't wait)
  queueEmailNotification(
    user.email,
    "USER_SIGNUP",
    { user: { name: user.name, email: user.email } },
    user.id,
  ).catch(() => null);

  sendVerificationEmail(user.id, user.email).catch(() => null);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      college: user.college,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: getAccessTokenExpiresIn(),
  };
}

/**
 * Login with email and password
 */
export async function loginWithEmail(
  data: LoginRequest,
  audit?: ConsentAuditContext,
): Promise<AuthResponse> {
  await checkLoginLock(data.email);

  // Find user
  const user = await prisma.user.findUnique({
    where: { email: data.email },
    include: {
      credential: true,
    },
  });

  if (!user || !user.credential) {
    await recordFailedLogin(data.email);
    throw new UnauthorizedError("Invalid email or password");
  }

  // Verify password
  const isValidPassword = await comparePassword(
    data.password,
    user.credential.passwordHash
  );

  if (!isValidPassword) {
    await recordFailedLogin(data.email);
    throw new UnauthorizedError("Invalid email or password");
  }

  // Check if user is active
  if (!user.isActive) {
    throw new UnauthorizedError("Account has been deactivated");
  }

  const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
  if (!isAdmin) {
    validateLegalAcceptance(data.legalConsent);
  }

  await clearLoginFailures(data.email);

  if (!isAdmin) {
    await recordTermsAndPrivacyAcceptance({
      userId: user.id,
      source: ConsentSource.LOGIN,
      payload: data.legalConsent,
      ...(audit ? { audit } : {}),
    });
  }

  // Create session
  const session = await createSession(user.id, audit?.userAgent, audit?.ipAddress);

  // Generate tokens
  const tokens = generateTokenPair({
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId: session.id,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      college: user.college,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: getAccessTokenExpiresIn(),
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<AuthResponse> {
  // Verify refresh token
  const decoded = verifyRefreshToken(refreshToken);

  // Find user
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (!user.isActive) {
    throw new UnauthorizedError("Account has been deactivated");
  }

  // Verify and rotate session
  if (decoded.sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: decoded.sessionId },
    });

    if (!session) {
      throw new UnauthorizedError("Session not found or already rotated");
    }

    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => null);
      throw new UnauthorizedError("Session expired");
    }

    // Rotate: delete old session before issuing new one (prevents token reuse)
    await prisma.session.delete({ where: { id: session.id } }).catch(() => null);
  }

  // Create new session
  const newSession = await createSession(user.id);

  // Generate new tokens
  const tokens = generateTokenPair({
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId: newSession.id,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      college: user.college,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: getAccessTokenExpiresIn(),
  };
}

/**
 * Logout user by invalidating session
 */
export async function logout(userId: string, sessionId?: string): Promise<void> {
  if (sessionId) {
    await prisma.session.delete({
      where: { id: sessionId },
    }).catch(() => {
      // Session might already be deleted, ignore error
    });
  } else {
    // Delete all sessions for user
    await prisma.session.deleteMany({
      where: { userId },
    });
  }
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatarUrl: true,
      college: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  return user;
}

export type UpdateUserProfileInput = {
  name?: string | null;
  college?: string | null;
  avatarUrl?: string | null;
};

export async function updateUserProfile(userId: string, input: UpdateUserProfileInput) {
  const name = input.name?.trim() || null;
  const college = input.college?.trim() || null;
  const avatarUrl = input.avatarUrl?.trim() || null;

  if (avatarUrl && !/^https?:\/\/.+/i.test(avatarUrl)) {
    throw new ValidationError("Avatar URL must start with http:// or https://");
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name,
      college,
      avatarUrl,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      avatarUrl: true,
      college: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return user;
}

/**
 * Create a new session for user
 */
async function createSession(userId: string, userAgent?: string, ipAddress?: string) {
  // Generate random session token
  const token = generateRandomToken();

  // Set expiration to 7 days
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  // Create session
  const session = await prisma.session.create({
    data: {
      userId,
      token,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt,
    },
  });

  // Clean up expired sessions for this user
  await prisma.session.deleteMany({
    where: {
      userId,
      expiresAt: {
        lt: new Date(),
      },
    },
  });

  return session;
}

/**
 * Generate a random token for session
 */
function generateRandomToken(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Date.now().toString(36)
  );
}
