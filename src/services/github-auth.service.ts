import { prisma } from "../lib/prisma.js";
import { generateTokenPair, getAccessTokenExpiresIn } from "../utils/jwt.js";
import {
  UnauthorizedError,
  ValidationError,
  type AuthResponse,
} from "../utils/types.js";
import { UserRole, AuthProvider } from "../generated/prisma/client.js";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const defaultBackendUrl =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/_/backend`
    : process.env.NODE_ENV === "production"
      ? "https://roboroot.in/_/backend"
      : "http://localhost:4000";

function isLocalhostUrl(url?: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url || "");
}

const configuredGithubRedirectUri = process.env.GITHUB_REDIRECT_URI?.trim();
const GITHUB_REDIRECT_URI =
  configuredGithubRedirectUri &&
  !(process.env.NODE_ENV === "production" && isLocalhostUrl(configuredGithubRedirectUri))
    ? configuredGithubRedirectUri
    : `${defaultBackendUrl}/api/auth/github/callback`;

interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * Get GitHub OAuth URL for authentication
 */
export function getGitHubAuthUrl(state?: string, redirectUri?: string): string {
  if (!GITHUB_CLIENT_ID) {
    throw new ValidationError("GitHub OAuth is not configured");
  }

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri || GITHUB_REDIRECT_URI,
    scope: "read:user user:email",
  });

  if (state) {
    params.set("state", state);
  }

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Handle GitHub OAuth callback
 */
export async function handleGitHubCallback(code: string, redirectUri?: string): Promise<AuthResponse> {
  try {
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      throw new ValidationError("GitHub OAuth is not configured");
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri || GITHUB_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      throw new UnauthorizedError("Failed to get access token from GitHub");
    }

    // Get user info
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/json",
      },
    });

    const githubUser = await userResponse.json() as GitHubUser;

    // Get user emails if email is not public
    let userEmail = githubUser.email;
    if (!userEmail) {
      const emailResponse = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/json",
        },
      });

      const emails = await emailResponse.json() as GitHubEmail[];
      const primaryEmail = emails.find((e) => e.primary && e.verified);
      userEmail = primaryEmail?.email || emails[0]?.email || null;
    }

    if (!userEmail) {
      throw new UnauthorizedError("Failed to get email from GitHub");
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: userEmail },
      include: {
        authAccounts: {
          where: {
            provider: AuthProvider.GITHUB,
          },
        },
      },
    });

    if (user) {
      // Update existing GitHub account or create new one
      const existingGitHubAccount = user.authAccounts.find(
        (acc) => acc.provider === AuthProvider.GITHUB
      );

      if (existingGitHubAccount) {
        // Update tokens
        await prisma.authAccount.update({
          where: { id: existingGitHubAccount.id },
          data: {
            accessToken: tokenData.access_token,
            refreshToken: null,
            expiresAt: null,
          },
        });
      } else {
        // Create new GitHub auth account for existing user
        await prisma.authAccount.create({
          data: {
            userId: user.id,
            provider: AuthProvider.GITHUB,
            providerUserId: githubUser.id.toString(),
            accessToken: tokenData.access_token,
            refreshToken: null,
            expiresAt: null,
          },
        });
      }
    } else {
      // Create new user with GitHub account
      user = await prisma.user.create({
        data: {
          email: userEmail,
          name: githubUser.name ?? githubUser.login,
          avatarUrl: githubUser.avatar_url ?? null,
          role: UserRole.STUDENT,
          isActive: true,
          authAccounts: {
            create: {
              provider: AuthProvider.GITHUB,
              providerUserId: githubUser.id.toString(),
              accessToken: tokenData.access_token,
              refreshToken: null,
              expiresAt: null,
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
    console.error("GitHub OAuth error:", error);
    if (error instanceof UnauthorizedError || error instanceof ValidationError) {
      throw error;
    }
    throw new UnauthorizedError("GitHub authentication failed");
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
