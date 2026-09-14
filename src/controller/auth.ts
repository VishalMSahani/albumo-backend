import type { Request, Response } from "express";
import { signupWithEmail, loginWithEmail, refreshAccessToken, getUserById, updateUserProfile, setBackupPassword, logout } from "../services/auth.service.js";
import { requestPasswordReset, resetPassword } from "../services/password-reset.service.js";
import { verifyEmailOtp, verifyEmailToken, resendVerificationEmail } from "../services/email-verification.service.js";
import { revokeSession, requireRecentAuthentication } from "../services/session-auth.service.js";
import { requestPhoneCode, verifyPhoneCode, completePhoneSignup, startPhoneAuth } from "../services/phone-auth.service.js";
import { beginOAuth, validateOAuthState, finishOAuth, type Provider } from "../services/oauth.service.js";
import { limitAuth } from "../services/auth-throttle.service.js";
import { getConsentAuditContext } from "../features/legal/legal.controller.js";
import { sendAuthResponse, setAuthCookies, clearAuthCookies } from "../utils/auth-cookies.js";
import { AuthError, UnauthorizedError } from "../utils/types.js";
import { whatsappOtpAvailable } from "../features/whatsapp/whatsapp-otp.service.js";

const refreshCookie = (req: Request): string | undefined => (req.cookies as Record<string, string> | undefined)?.refreshToken;

export async function configController(_req: Request, res: Response) {
  res.json({ success: true, data: { whatsappOtp: whatsappOtpAvailable(), sessionDays: 15,
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) } });
}
export async function signupController(req: Request, res: Response) {
  const data = await signupWithEmail(req.body, getConsentAuditContext(req));
  res.status(202).json({ success: true, data, message: "Account created. Verify your email now or return to it later." });
}
export async function loginController(req: Request, res: Response) {
  sendAuthResponse(res, await loginWithEmail(req.body, getConsentAuditContext(req)));
}
export async function refreshTokenController(req: Request, res: Response) {
  const token = refreshCookie(req);
  if (!token) throw new UnauthorizedError("Please sign in again");
  sendAuthResponse(res, await refreshAccessToken(token));
}
export async function logoutController(req: Request, res: Response) {
  await revokeSession(refreshCookie(req));
  if (req.user?.sessionId) await logout(req.user.userId, req.user.sessionId);
  clearAuthCookies(res);
  res.json({ success: true });
}
export async function getMeController(req: Request, res: Response) {
  res.json({ success: true, data: await getUserById(req.user!.userId) });
}
export async function updateMeController(req: Request, res: Response) {
  res.json({ success: true, data: await updateUserProfile(req.user!.userId, req.body) });
}
export async function passwordController(req: Request, res: Response) {
  await limitAuth("password-change", req.user!.userId, 5, 900);
  await setBackupPassword(req.user!.userId, req.user!.sessionId!, req.body.newPassword, req.body.currentPassword);
  res.json({ success: true, message: "Backup password saved. Other sessions have been signed out." });
}
export async function otpRequestController(req: Request, res: Response) {
  if (req.user) await requireRecentAuthentication(req.user.userId, req.user.sessionId!);
  res.json({ success: true, data: await requestPhoneCode(req.body.phone, getConsentAuditContext(req), req.user?.userId) });
}
export async function phoneStartController(req: Request, res: Response) {
  res.json({ success: true, data: await startPhoneAuth(req.body.phone, getConsentAuditContext(req)) });
}
export async function otpVerifyController(req: Request, res: Response) {
  if (req.user) await requireRecentAuthentication(req.user.userId, req.user.sessionId!);
  const result = await verifyPhoneCode(req.body.challengeId, req.body.code, req.body.legalConsent, getConsentAuditContext(req), req.user?.userId);
  if (result.kind === "authenticated") { sendAuthResponse(res, result.auth); return; }
  res.json({ success: true, data: result });
}
export async function completeSignupController(req: Request, res: Response) {
  sendAuthResponse(res, await completePhoneSignup(req.body, getConsentAuditContext(req)), 201);
}
export async function forgotPasswordController(req: Request, res: Response) {
  await limitAuth("recovery-ip", req.ip || "unknown", 20, 3600);
  await limitAuth("recovery-email", req.body.email, 3, 3600);
  await requestPasswordReset(req.body.email);
  res.json({ success: true, message: "If this email is verified on an account, we will send a reset link." });
}
export async function resetPasswordController(req: Request, res: Response) {
  await limitAuth("reset-ip", req.ip || "unknown", 20, 900);
  await resetPassword(req.body.token, req.body.newPassword);
  clearAuthCookies(res);
  res.json({ success: true, message: "Password updated. Please sign in." });
}
export async function verifyEmailController(req: Request, res: Response) {
  await limitAuth("email-verify-ip", req.ip || "unknown", 30, 900);
  await verifyEmailToken(req.query.token as string);
  res.json({ success: true, message: "Email verified. You can sign in now." });
}
export async function verifyEmailOtpController(req: Request, res: Response) {
  await limitAuth("email-verify-ip", req.ip || "unknown", 30, 900);
  await limitAuth("email-verify-account", req.body.email, 10, 900);
  await verifyEmailOtp(req.body.email, req.body.code);
  res.json({ success: true, message: "Email verified. You can sign in now." });
}
export async function resendVerificationController(req: Request, res: Response) {
  await limitAuth("verify-email-ip", req.ip || "unknown", 20, 3600);
  await limitAuth("verify-email", req.body.email, 3, 3600);
  await resendVerificationEmail(req.body.email);
  res.json({ success: true, message: "If verification is needed, we will send a code shortly." });
}
export const startOAuthController = (provider: Provider) => async (req: Request, res: Response) => {
  res.redirect(beginOAuth(req, res, provider));
};
export const callbackOAuthController = (provider: Provider) => async (req: Request, res: Response) => {
  const frontend = process.env.FRONTEND_URL || "http://localhost:3000";
  try {
    const redirect = validateOAuthState(req, res, provider);
    if (typeof req.query.code !== "string" || req.query.error) throw new AuthError("Sign-in was cancelled. Please try again.", 400);
    const auth = await finishOAuth(provider, req.query.code, getConsentAuditContext(req));
    setAuthCookies(res, auth);
    res.redirect(`${frontend}/callback?provider=${provider}&redirect=${encodeURIComponent(redirect)}`);
  } catch (error) {
    const message = error instanceof AuthError ? error.message : "Sign-in could not be completed. Please try again.";
    res.redirect(`${frontend}/login?error=${encodeURIComponent(message)}`);
  }
};
