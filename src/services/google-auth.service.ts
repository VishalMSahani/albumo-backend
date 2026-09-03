import { OAuth2Client } from "google-auth-library";
import { prisma } from "../lib/prisma.js";
import { generateTokenPair, getAccessTokenExpiresIn } from "../utils/jwt.js";
import {
  UnauthorizedError,
  ValidationError,
  type AuthResponse,
} from "../utils/types.js";
import { UserRole, AuthProvider } from "../generated/prisma/client.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const defaultBackendUrl =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/_/backend`
    : process.env.NODE_ENV === "production"
      ? "https://roboroot.in/_/backend"
      : "http://localhost:4000";

function isLocalhostUrl(url?: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url || "");
}

const configuredGoogleRedirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
const GOOGLE_REDIRECT_URI =
  configuredGoogleRedirectUri &&
  !(process.env.NODE_ENV === "production" && isLocalhostUrl(configuredGoogleRedirectUri))
    ? configuredGoogleRedirectUri
    : `${defaultBackendUrl}/api/auth/google/callback`;

const googleClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

/**
 * Get Google OAuth URL for authentication
 */
export function getGoogleAuthUrl(state?: string, redirectUri?: string): string {
  if (!GOOGLE_CLIENT_ID) {
    throw new ValidationError("Google OAuth is not configured");
  }

  const scopes = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  const opts: any = {
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
  };

  if (state) {
    opts.state = state;
  }

  if (redirectUri) {
    opts.redirect_uri = redirectUri;
  }

  return googleClient.generateAuthUrl(opts);
}

/**
 * Handle Google OAuth callback
 */
export async function handleGoogleCallback(code: string, redirectUri?: string): Promise<AuthResponse> {
  try {
    if (!GOOGLE_CLIENT_ID) {
      throw new ValidationError("Google OAuth is not configured");
    }

    // Exchange code for tokens
    const { tokens } = redirectUri
      ? await googleClient.getToken({ code, redirect_uri: redirectUri })
      : await googleClient.getToken(code);
    googleClient.setCredentials(tokens);

    // Get user info
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token || "",
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new UnauthorizedError("Failed to get user information from Google");
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: payload.email },
      include: {
        authAccounts: {
          where: {
            provider: AuthProvider.GOOGLE,
          },
        },
      },
    });

    if (user) {
      // Update existing Google account or create new one
      const existingGoogleAccount = user.authAccounts.find(
        (acc) => acc.provider === AuthProvider.GOOGLE
      );

      if (existingGoogleAccount) {
        // Update tokens
        await prisma.authAccount.update({
          where: { id: existingGoogleAccount.id },
          data: {
            accessToken: tokens.access_token ?? null,
            refreshToken: tokens.refresh_token ?? null,
            expiresAt: tokens.expiry_date
              ? new Date(tokens.expiry_date)
              : null,
          },
        });
      } else {
        // Create new Google auth account for existing user
        await prisma.authAccount.create({
          data: {
            userId: user.id,
            provider: AuthProvider.GOOGLE,
            providerUserId: payload.sub,
            accessToken: tokens.access_token ?? null,
            refreshToken: tokens.refresh_token ?? null,
            expiresAt: tokens.expiry_date
              ? new Date(tokens.expiry_date)
              : null,
          },
        });
      }
    } else {
      // Create new user with Google account
      user = await prisma.user.create({
        data: {
          email: payload.email,
          name: payload.name ?? null,
          avatarUrl: payload.picture ?? null,
          role: UserRole.STUDENT,
          isActive: true,
          authAccounts: {
            create: {
              provider: AuthProvider.GOOGLE,
              providerUserId: payload.sub,
              accessToken: tokens.access_token ?? null,
              refreshToken: tokens.refresh_token ?? null,
              expiresAt: tokens.expiry_date
                ? new Date(tokens.expiry_date)
                : null,
            },
          },
        },
        include: {
          authAccounts: true,
        },
      });
    }

    // Create session
    const session = await createSession(user.id);

    // Generate JWT tokens
    const jwtTokens = generateTokenPair({
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
      accessToken: jwtTokens.accessToken,
      refreshToken: jwtTokens.refreshToken,
      expiresIn: getAccessTokenExpiresIn(),
    };
  } catch (error) {
    console.error("Google OAuth error:", error);
    if (error instanceof UnauthorizedError || error instanceof ValidationError) {
      throw error;
    }
    throw new UnauthorizedError("Google authentication failed");
  }
}

/**
 * Create a new session for user
 */
async function createSession(userId: string) {
  const token = generateRandomToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const session = await prisma.session.create({
    data: {
      userId,
      token,
      userAgent: null,
      ipAddress: null,
      expiresAt,
    },
  });

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
 * Generate a random token
 */
function generateRandomToken(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Date.now().toString(36)
  );
}
