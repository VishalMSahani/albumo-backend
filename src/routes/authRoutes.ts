import { Router } from "express";
import {
  signupController,
  loginController,
  refreshTokenController,
  logoutController,
  getMeController,
  googleAuthController,
  googleCallbackController,
  githubAuthController,
  githubCallbackController,
  updateMeController,
  forgotPasswordController,
  resetPasswordController,
  verifyEmailController,
  resendVerificationController,
} from "../controller/auth.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router: Router = Router();

// Email/Password Authentication
router.post("/signup", signupController);
router.post("/login", loginController);

// Password reset flow
router.post("/forgot-password", forgotPasswordController);
router.post("/reset-password", resetPasswordController);

// Email verification
router.get("/verify-email", verifyEmailController);
router.post("/resend-verification", resendVerificationController);

// Token Management
router.post("/refresh", refreshTokenController);
router.post("/logout", authenticate, logoutController);

// User Profile
router.get("/me", authenticate, getMeController);
router.patch("/me", authenticate, updateMeController);

// Google OAuth
router.get("/google", googleAuthController);
router.get("/google/callback", googleCallbackController);

// GitHub OAuth
router.get("/github", githubAuthController);
router.get("/github/callback", githubCallbackController);

export default router;
