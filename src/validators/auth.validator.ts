import { z } from "zod";
import { LEGAL_POLICY_VERSION } from "../features/legal/legal.constants.js";

export const legalSchema = z.object({ accepted: z.literal(true), policyVersion: z.literal(LEGAL_POLICY_VERSION) });
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12, "Use at least 12 characters").max(72).refine(value => Buffer.byteLength(value) <= 72, "Password must fit within 72 bytes");
export const phoneSchema = z.string().trim().transform(value => {
  const digits = value.replace(/[\s()+-]/g, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : `+${digits}`;
}).refine(value => /^\+91[6-9]\d{9}$/.test(value), "Enter a valid 10-digit Indian mobile number");
export const signupSchema = z.object({
  name: z.string().trim().max(100).optional(), email: emailSchema, password: passwordSchema,
  phone: phoneSchema.optional(), college: z.string().trim().max(160).optional(), legalConsent: legalSchema,
});
export const loginSchema = z.object({
  email: z.string().trim().min(3).max(254), password: z.string().min(1).max(72), legalConsent: legalSchema.optional(),
});
export const otpRequestSchema = z.object({ phone: phoneSchema, legalConsent: legalSchema });
export const otpVerifySchema = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/, "Enter the six-digit code"), legalConsent: legalSchema });
export const emailOtpVerifySchema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/, "Enter the six-digit code") });
export const completeSignupSchema = z.object({
  registrationToken: z.string().min(32).max(256), email: emailSchema,
  name: z.string().trim().min(1).max(100), password: passwordSchema, legalConsent: legalSchema,
});
export const profileSchema = z.object({
  name: z.string().trim().max(100).nullable().optional(), college: z.string().trim().max(160).nullable().optional(),
  avatarUrl: z.string().url().max(2000).nullable().optional(),
});
export const emptySchema = z.object({}).passthrough();
