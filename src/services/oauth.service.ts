import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { AuthError } from "../utils/types.js";
import { authSecret, constantTimeEqual, safeRedirect } from "../utils/auth-security.js";
import { cookieOptions } from "../utils/auth-cookies.js";
import { issueSession } from "./session-auth.service.js";
import { recordTermsAndPrivacyAcceptance, type ConsentAuditContext } from "../features/legal/legal.service.js";
import { LEGAL_POLICY_VERSION } from "../features/legal/legal.constants.js";

export type Provider = "google" | "github";
export function oauthRedirectUri(provider: Provider): string {
  const configured = process.env[provider === "google" ? "GOOGLE_REDIRECT_URI" : "GITHUB_REDIRECT_URI"];
  const base = process.env.BACKEND_PUBLIC_URL || "http://localhost:4000";
  return configured || `${base.replace(/\/+$/, "")}/api/auth/${provider}/callback`;
}
export function beginOAuth(req: Request, res: Response, provider: Provider): string {
  const clientId = process.env[provider.toUpperCase() + "_CLIENT_ID"];
  if (!clientId || !process.env[provider.toUpperCase() + "_CLIENT_SECRET"]) throw new AuthError("This sign-in method is not available", 503);
  const state = jwt.sign({ provider, redirect: safeRedirect(req.query.redirect), nonce: randomBytes(32).toString("hex") }, authSecret("JWT_SECRET"),
    { algorithm: "HS256", expiresIn: "10m", audience: "oauth-state", issuer: "roboroot-api" });
  res.cookie(`oauth_${provider}`, state, { ...cookieOptions(), path: `/api/auth/${provider}`, maxAge: 600_000 });
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: oauthRedirectUri(provider), state });
  if (provider === "google") {
    params.set("response_type", "code"); params.set("scope", "openid email profile");
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
  params.set("scope", "read:user user:email");
  return `https://github.com/login/oauth/authorize?${params}`;
}
export function validateOAuthState(req: Request, res: Response, provider: Provider): string {
  const state = req.query.state;
  const cookie = (req.cookies as Record<string, string> | undefined)?.[`oauth_${provider}`];
  res.clearCookie(`oauth_${provider}`, { ...cookieOptions(), path: `/api/auth/${provider}` });
  if (typeof state !== "string" || !cookie || !constantTimeEqual(state, cookie)) throw new AuthError("Sign-in expired. Please try again.", 400);
  try {
    const decoded = jwt.verify(state, authSecret("JWT_SECRET"), { algorithms: ["HS256"], audience: "oauth-state", issuer: "roboroot-api" });
    if (typeof decoded === "string" || decoded.provider !== provider) throw new Error();
    return safeRedirect(decoded.redirect);
  } catch { throw new AuthError("Sign-in expired. Please try again.", 400); }
}
export async function finishOAuth(provider: Provider, code: string, audit: ConsentAuditContext) {
  let identity: { id: string; email: string; name: string | null; avatar: string | null };
  if (provider === "google") {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, oauthRedirectUri(provider));
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token || "", audience: process.env.GOOGLE_CLIENT_ID! });
    const data = ticket.getPayload();
    if (!data?.email || !data.email_verified) throw new AuthError("Google must provide a verified email address", 401);
    identity = { id: data.sub, email: data.email.toLowerCase(), name: data.name ?? null, avatar: data.picture ?? null };
  } else {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: oauthRedirectUri(provider) }),
    });
    const token = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token) throw new AuthError("GitHub sign-in failed", 401);
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" };
    const [userResponse, emailsResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(10_000) }),
      fetch("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(10_000) }),
    ]);
    if (!userResponse.ok || !emailsResponse.ok) throw new AuthError("GitHub sign-in failed", 401);
    const data = await userResponse.json() as { id: number; name?: string; login: string; avatar_url?: string };
    const emails = await emailsResponse.json() as { email: string; verified: boolean; primary: boolean }[];
    const email = emails.find(e => e.primary && e.verified)?.email;
    if (!email) throw new AuthError("GitHub must provide a verified primary email", 401);
    identity = { id: String(data.id), email: email.toLowerCase(), name: data.name || data.login, avatar: data.avatar_url ?? null };
  }
  return prisma.$transaction(async tx => {
    const providerKey = provider === "google" ? "GOOGLE" : "GITHUB";
    const account = await tx.authAccount.findUnique({ where: { provider_providerUserId: { provider: providerKey, providerUserId: identity.id } }, include: { user: true } });
    let user = account?.user ?? await tx.user.findUnique({ where: { email: identity.email } });
    if (user && !user.isActive) throw new AuthError("Account is unavailable", 403);
    if (user && !account && !user.emailVerified) throw new AuthError("Verify your existing account's email before connecting this sign-in method.", 403);
    if (!user) user = await tx.user.create({ data: { email: identity.email, emailVerified: true, name: identity.name, avatarUrl: identity.avatar } });
    if (!account) await tx.authAccount.create({ data: { userId: user.id, provider: providerKey, providerUserId: identity.id } });
    await recordTermsAndPrivacyAcceptance({ userId: user.id, source: "OAUTH", payload: { accepted: true, policyVersion: LEGAL_POLICY_VERSION }, audit, client: tx });
    return issueSession(user, audit, tx);
  });
}
