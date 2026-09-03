import type { Router as RouterType } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import {
  previewEmailTemplate,
  sendTestEmail,
  processEmailQueue,
  getEmailStatistics,
  cleanupEmails,
  testEmailConfig,
  sendCustomEmail,
} from "../controller/email.js";
import { UserRole } from "../generated/prisma/client.js";

const router: RouterType = Router();

// All email routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/emails/preview/:eventType
 * @desc    Preview an email template
 * @access  Private (Admin only)
 */
router.get(
  "/preview/:eventType",
  authorize(UserRole.ADMIN),
  previewEmailTemplate
);

/**
 * @route   POST /api/emails/test
 * @desc    Send a test email
 * @access  Private (Admin only)
 */
router.post(
  "/test",
  authorize(UserRole.ADMIN),
  sendTestEmail
);

/**
 * @route   POST /api/emails/custom
 * @desc    Send a custom email
 * @access  Private (Admin only)
 */
router.post(
  "/custom",
  authorize(UserRole.ADMIN),
  sendCustomEmail
);

/**
 * @route   POST /api/emails/process
 * @desc    Process pending email queue manually
 * @access  Private (Admin only)
 */
router.post(
  "/process",
  authorize(UserRole.ADMIN),
  processEmailQueue
);

/**
 * @route   GET /api/emails/stats
 * @desc    Get email notification statistics
 * @access  Private (Admin only)
 */
router.get(
  "/stats",
  authorize(UserRole.ADMIN),
  getEmailStatistics
);

/**
 * @route   DELETE /api/emails/cleanup
 * @desc    Cleanup old email notifications
 * @access  Private (Admin only)
 * @query   days - Number of days to keep (default: 30)
 */
router.delete(
  "/cleanup",
  authorize(UserRole.ADMIN),
  cleanupEmails
);

/**
 * @route   GET /api/emails/test-config
 * @desc    Test email configuration
 * @access  Private (Admin only)
 */
router.get(
  "/test-config",
  authorize(UserRole.ADMIN),
  testEmailConfig
);

export default router;
