import { Router } from "express";
import { z } from "zod";
import * as auth from "../controller/auth.js";
import { authenticate, optionalAuthenticate } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { asyncHandler } from "../utils/async-handler.js";
import { signupSchema, loginSchema, emailSchema, passwordSchema, otpRequestSchema, otpVerifySchema, emailOtpVerifySchema, completeSignupSchema, profileSchema, emptySchema } from "../validators/auth.validator.js";
import { LEGAL_POLICY_VERSION } from "../features/legal/legal.constants.js";

const router: Router = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Pragma", "no-cache"); next(); });
router.get("/config", validate({ query: emptySchema }), asyncHandler(auth.configController));
router.post("/signup", validate({ body: signupSchema }), asyncHandler(auth.signupController));
router.post("/login", validate({ body: loginSchema }), asyncHandler(auth.loginController));
router.post("/phone/start", validate({ body: otpRequestSchema }), asyncHandler(auth.phoneStartController));
router.post("/otp/request", validate({ body: otpRequestSchema }), asyncHandler(auth.otpRequestController));
router.post("/otp/verify", validate({ body: otpVerifySchema }), asyncHandler(auth.otpVerifyController));
router.post("/otp/complete-signup", validate({ body: completeSignupSchema }), asyncHandler(auth.completeSignupController));
router.post("/phone/request", authenticate, validate({ body: otpRequestSchema }), asyncHandler(auth.otpRequestController));
router.post("/phone/verify", authenticate, validate({ body: otpVerifySchema }), asyncHandler(auth.otpVerifyController));
router.post("/password", authenticate, validate({ body: z.object({ newPassword: passwordSchema, currentPassword: z.string().max(72).optional() }) }), asyncHandler(auth.passwordController));
router.post("/forgot-password", validate({ body: z.object({ email: emailSchema }) }), asyncHandler(auth.forgotPasswordController));
router.post("/reset-password", validate({ body: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), newPassword: passwordSchema }) }), asyncHandler(auth.resetPasswordController));
router.get("/verify-email", validate({ query: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }) }), asyncHandler(auth.verifyEmailController));
router.post("/verify-email", validate({ body: emailOtpVerifySchema }), asyncHandler(auth.verifyEmailOtpController));
router.post("/resend-verification", validate({ body: z.object({ email: emailSchema }) }), asyncHandler(auth.resendVerificationController));
router.post("/refresh", validate({ body: emptySchema.optional() }), asyncHandler(auth.refreshTokenController));
router.post("/logout", optionalAuthenticate, validate({ body: emptySchema.optional() }), asyncHandler(auth.logoutController));
router.get("/me", authenticate, validate({ query: emptySchema }), asyncHandler(auth.getMeController));
router.patch("/me", authenticate, validate({ body: profileSchema }), asyncHandler(auth.updateMeController));
for (const provider of ["google", "github"] as const) {
  router.get(`/${provider}`, validate({ query: z.object({ consentVersion: z.literal(LEGAL_POLICY_VERSION), redirect: z.string().max(2000).optional() }) }), asyncHandler(auth.startOAuthController(provider)));
  router.get(`/${provider}/callback`, validate({ query: z.object({ code: z.string().max(4096).optional(), state: z.string().max(4096), error: z.string().max(300).optional() }).passthrough() }), asyncHandler(auth.callbackOAuthController(provider)));
}
export default router;
