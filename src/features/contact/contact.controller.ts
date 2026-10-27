import type { Request, Response } from "express";
import { limitAuth } from "../../services/auth-throttle.service.js";
import { logAdminAction } from "../../services/admin-action-log.service.js";
import { emailDeliveryConfigured } from "../../services/email.service.js";
import { prisma } from "../../lib/prisma.js";
import * as service from "./contact.service.js";
import { subscriberQuerySchema } from "./contact.validator.js";

export async function publicSettings(_req: Request, res: Response) {
  res.json({ success: true, data: await service.getContactSettings() });
}
export async function createEnquiry(req: Request, res: Response) {
  await limitAuth("contact-ip", req.ip || "unknown", 10, 3600);
  await limitAuth("contact-email", req.body.email, 5, 3600);
  const ticket = await service.createEnquiry(req.body, req.user?.userId);
  res.status(201).json({
    success: true,
    data: { ticketNumber: ticket.ticketNumber, email: ticket.requesterEmail },
  });
}
export async function requestNewsletter(req: Request, res: Response) {
  await limitAuth("newsletter-ip", req.ip || "unknown", 10, 3600);
  await limitAuth("newsletter-email", req.body.email, 5, 3600);
  const result = await service.requestNewsletterEmail(
    req.body.email,
    req.path.endsWith("manage") ? "manage" : "subscribe",
    req.body.source,
  );
  if (!result.available || !result.delivered) {
    res.status(503).json({
      success: false,
      error: "Email signup is temporarily unavailable. Please try again later.",
    });
    return;
  }
  res.json({
    success: true,
    message: req.path.endsWith("manage")
      ? "If action is needed for this address, an email is queued. Check your inbox and spam folder shortly."
      : "You’re subscribed! No email confirmation is needed. You can unsubscribe at any time.",
  });
}
export async function newsletterAction(req: Request, res: Response) {
  await limitAuth("newsletter-action", req.ip || "unknown", 30, 900);
  const ok = req.path.endsWith("confirm")
    ? await service.confirmNewsletter(req.body.token)
    : await service.unsubscribeNewsletter(req.body.token);
  res.status(ok ? 200 : 400).json(
    ok
      ? { success: true }
      : {
          success: false,
          error:
            "This link has expired or has already been used. Request a fresh link on the newsletter page.",
        },
  );
}
export async function adminSettings(_req: Request, res: Response) {
  const setting = await prisma.contactSetting.findUnique({ where: { id: 1 } });
  res.json({
    success: true,
    data: {
      ...(await service.getContactSettings()),
      newsletterEnabled: setting?.newsletterEnabled ?? true,
      emailConfigured: emailDeliveryConfigured(),
    },
  });
}
export async function saveSettings(req: Request, res: Response) {
  await service.updateContactSettings(req.body);
  await logAdminAction(
    req.user!.userId,
    "UPDATE_CONTACT_SETTINGS",
    "CONTACT_SETTINGS",
    "1",
  );
  res.json({ success: true });
}
export async function subscribers(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    data: await service.listSubscribers(subscriberQuerySchema.parse(req.query)),
  });
}
export async function unsubscribeAdmin(req: Request, res: Response) {
  const id = String(req.params.id);
  const ok = await service.adminUnsubscribe(id);
  if (ok)
    await logAdminAction(
      req.user!.userId,
      "UNSUBSCRIBE_NEWSLETTER",
      "NEWSLETTER_SUBSCRIBER",
      id,
    );
  res
    .status(ok ? 200 : 404)
    .json(
      ok
        ? { success: true }
        : { success: false, error: "Subscriber not found" },
    );
}
export async function exportActive(req: Request, res: Response) {
  const csv = await service.exportSubscribers();
  if (csv === null) {
    res.status(422).json({
      success: false,
      error:
        "Export exceeds 10,000 subscribers. Use a dedicated mailing integration for this list.",
    });
    return;
  }
  await logAdminAction(
    req.user!.userId,
    "EXPORT_NEWSLETTER",
    "NEWSLETTER_SUBSCRIBER",
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, data: { csv } });
}
