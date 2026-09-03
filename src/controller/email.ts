import type { Request, Response } from "express";
import {
  queueEmailNotification,
  processPendingEmails,
  getEmailStats,
  cleanupOldEmails,
} from "../services/email-notification.service.js";
import { getEmailTemplate } from "../utils/email-templates.js";
import { sendEmail, testEmailConfiguration } from "../services/email.service.js";
import { EmailEventType } from "../generated/prisma/client.js";
import { ValidationError } from "../utils/types.js";
import type { JWTPayload } from "../utils/types.js";

// Define AuthRequest locally
interface AuthRequest extends Request {
  user?: JWTPayload;
}

/**
 * Preview an email template
 */
export async function previewEmailTemplate(req: AuthRequest, res: Response) {
  const { eventType } = req.params;
  const metadata = req.body;

  // Validate event type
  if (!Object.values(EmailEventType).includes(eventType as EmailEventType)) {
    throw new ValidationError("Invalid email event type");
  }

  // Get template HTML
  const template = getEmailTemplate(eventType as EmailEventType, metadata);

  // Return HTML for preview
  res.setHeader("Content-Type", "text/html");
  res.send(template);
}

/**
 * Send a test email
 */
export async function sendTestEmail(req: AuthRequest, res: Response) {
  const { email, eventType, metadata } = req.body;

  if (!email) {
    throw new ValidationError("Email is required");
  }

  if (!eventType || !Object.values(EmailEventType).includes(eventType)) {
    throw new ValidationError("Invalid email event type");
  }

  // Queue the test email
  const result = await queueEmailNotification(
    email,
    eventType as EmailEventType,
    metadata || {},
    req.user?.userId // Associate with current user if available
  );

  res.json({
    message: "Test email queued successfully",
    notificationId: result.id,
  });
}

/**
 * Process pending emails manually
 */
export async function processEmailQueue(req: AuthRequest, res: Response) {
  const result = await processPendingEmails();

  res.json({
    message: "Email queue processed",
    processed: result.processed,
    successful: result.successful,
    failed: result.failed,
  });
}

/**
 * Get email notification statistics
 */
export async function getEmailStatistics(req: AuthRequest, res: Response) {
  const stats = await getEmailStats();

  res.json(stats);
}

/**
 * Cleanup old email notifications
 */
export async function cleanupEmails(req: AuthRequest, res: Response) {
  const { days = 30 } = req.query;
  const daysNum = parseInt(days as string, 10);

  if (isNaN(daysNum) || daysNum < 1) {
    throw new ValidationError("Days must be a positive number");
  }

  const deletedCount = await cleanupOldEmails(daysNum);

  res.json({
    message: `Cleaned up email notifications older than ${daysNum} days`,
    deletedCount,
  });
}

/**
 * Test email configuration
 */
export async function testEmailConfig(req: AuthRequest, res: Response) {
  const result = await testEmailConfiguration();

  res.json(result);
}

/**
 * Send a custom email (for admin purposes)
 */
export async function sendCustomEmail(req: AuthRequest, res: Response) {
  const { to, subject, htmlBody, textBody } = req.body;

  if (!to || !subject) {
    throw new ValidationError("To and subject are required");
  }

  if (!htmlBody && !textBody) {
    throw new ValidationError("Either htmlBody or textBody is required");
  }

  const result = await sendEmail(
    to,
    subject,
    htmlBody,
    textBody
  );

  const response: {
    message: string;
    messageId?: string;
    previewUrl?: string;
  } = {
    message: "Email sent successfully",
  };

  if (result.messageId) {
    response.messageId = result.messageId;
  }

  if (result.previewUrl) {
    response.previewUrl = result.previewUrl;
  }

  res.json(response);
}
