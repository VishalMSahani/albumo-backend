import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { asyncHandler } from "../utils/async-handler.js";
import { emailConfig, plainEmailHtml } from "../services/email-config.js";
import { emailDeliveryConfigured } from "../services/email.service.js";
import {
  getEmailStats,
  queueRawEmail,
  processPendingEmails,
} from "../services/email-notification.service.js";
import {
  queueCampaign,
  cancelCampaign,
  refreshCampaignStatuses,
} from "../services/email-marketing.service.js";
import {
  linkInbound,
  attachmentLink,
} from "../services/email-inbox.service.js";
import { recoverEmailWebhooks } from "../services/email-webhook.service.js";
import { wrapTemplate } from "../utils/emailTemplates/base.js";
import { campaignSchema, renderCampaign } from "../services/campaign-design.js";

export const emailWorkspaceRoutes: Router = Router();
emailWorkspaceRoutes.use(authenticate, authorize("ADMIN", "SUPER_ADMIN"));
emailWorkspaceRoutes.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const query = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  search: z.string().trim().max(100).default(""),
  status: z.string().max(30).default(""),
  channel: z
    .enum(["", "TRANSACTIONAL", "ACCOUNT", "ADMIN", "MARKETING"])
    .default(""),
});
emailWorkspaceRoutes.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const config = emailConfig();
    const [stats, activeSubscribers, inboxPending, webhooks, campaigns] =
      await Promise.all([
        getEmailStats(),
        prisma.newsletterSubscriber.count({ where: { status: "ACTIVE" } }),
        prisma.inboundEmail.count({
          where: { status: { in: ["NEW", "NEEDS_REVIEW"] } },
        }),
        prisma.emailWebhookEvent.findMany({
          where: { processedAt: null },
          select: { id: true, type: true, error: true, createdAt: true },
          take: 10,
          orderBy: { createdAt: "desc" },
        }),
        prisma.emailCampaign.count(),
      ]);
    res.json({
      success: true,
      data: {
        stats,
        activeSubscribers,
        inboxPending,
        campaigns,
        webhooks,
        config: {
          from: config.from,
          accountFrom: config.accountFrom,
          accountReplyTo: config.accountReplyTo,
          marketingFrom: config.marketingFrom,
          marketingReplyTo: config.marketingReplyTo,
          replyTo: config.replyTo,
          admin: config.admin,
          support: config.support,
          inboundDomain: config.inboundDomain,
          inboundEnabled: config.inboundEnabled,
          marketingEnabled: config.marketingEnabled,
          providerConfigured: emailDeliveryConfigured(),
          receivingKeyConfigured: Boolean(process.env.RESEND_RECEIVING_API_KEY),
          webhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET),
          signingConfigured: config.signingSecret.length >= 32,
          webhookUrl: config.apiUrl + "/api/webhooks/resend",
          siteUrl: config.siteUrl,
        },
      },
    });
  }),
);
emailWorkspaceRoutes.get(
  "/messages",
  validate({ query }),
  asyncHandler(async (req, res) => {
    const input = query.parse(req.query);
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.search
        ? {
            OR: [
              {
                email: { contains: input.search, mode: "insensitive" as const },
              },
              {
                subject: {
                  contains: input.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.emailNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * 30,
        take: 30,
        select: {
          id: true,
          email: true,
          subject: true,
          eventType: true,
          channel: true,
          status: true,
          retryCount: true,
          error: true,
          createdAt: true,
          sentAt: true,
          deliveredAt: true,
          openedAt: true,
          clickedAt: true,
          providerMessageId: true,
          ticketId: true,
        },
      }),
      prisma.emailNotification.count({ where }),
    ]);
    res.json({
      success: true,
      data: {
        items: items.map((row) => ({
          ...row,
          subject: ["USER_EMAIL_VERIFICATION", "PASSWORD_RESET"].includes(
            row.eventType,
          )
            ? "Authentication email"
            : row.subject,
        })),
        total,
        pages: Math.max(1, Math.ceil(total / 30)),
      },
    });
  }),
);
emailWorkspaceRoutes.get(
  "/messages/:id",
  asyncHandler(async (req, res) => {
    const row = await prisma.emailNotification.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!row) {
      res.status(404).json({ error: "Email not found" });
      return;
    }
    const auth = ["USER_EMAIL_VERIFICATION", "PASSWORD_RESET"].includes(
      row.eventType,
    );
    res.json({
      success: true,
      data: {
        id: row.id,
        email: row.email,
        subject: auth ? "Authentication email" : row.subject,
        text: auth
          ? "Authentication content is hidden."
          : row.text ||
            "No plain-text preview is available for this legacy email.",
        status: row.status,
        error: row.error,
        from: row.fromAddress,
        replyTo: row.replyTo,
        ticketId: row.ticketId,
      },
    });
  }),
);
emailWorkspaceRoutes.post(
  "/messages/:id/retry",
  asyncHandler(async (req, res) => {
    const row = await prisma.emailNotification.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!row || row.isSent || !["FAILED", "QUEUED"].includes(row.status)) {
      res
        .status(400)
        .json({ error: "Only unsent queued or failed emails can be retried" });
      return;
    }
    if (
      row.firstAttemptAt &&
      Date.now() - row.firstAttemptAt.getTime() > 23 * 3600000
    ) {
      res.status(409).json({
        error:
          "Check the provider delivery record first: the duplicate-protection window has expired.",
      });
      return;
    }
    if (["USER_EMAIL_VERIFICATION", "PASSWORD_RESET"].includes(row.eventType)) {
      res.status(400).json({
        error: "Request a fresh authentication email from the sign-in flow.",
      });
      return;
    }
    await prisma.emailNotification.updateMany({
      where: {
        id: row.id,
        isSent: false,
        status: { in: ["FAILED", "QUEUED"] },
      },
      data: {
        status: "QUEUED",
        retryCount: 0,
        nextAttemptAt: new Date(),
        error: null,
      },
    });
    res.json({ success: true });
  }),
);
emailWorkspaceRoutes.post(
  "/process",
  asyncHandler(async (_req, res) => {
    const webhooks = await recoverEmailWebhooks();
    const delivery = await processPendingEmails(20);
    await refreshCampaignStatuses();
    res.json({ success: true, data: { delivery, webhooks } });
  }),
);
emailWorkspaceRoutes.post(
  "/test",
  asyncHandler(async (req, res) => {
    const config = emailConfig();
    const subject = "Albumo email setup test";
    const text =
      "This test was requested from Albumo admin. Sender: " +
      config.from +
      "\nAdmin notifications: " +
      config.admin;
    const row = await queueRawEmail({
      email: config.admin,
      eventType: "CUSTOM_EMAIL",
      subject,
      html: wrapTemplate(plainEmailHtml(text)),
      text,
      channel: "ADMIN",
    });
    res.json({ success: true, data: row });
  }),
);
emailWorkspaceRoutes.get(
  "/inbox",
  validate({ query }),
  asyncHandler(async (req, res) => {
    const input = query.parse(req.query);
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.search
        ? {
            OR: [
              {
                fromEmail: {
                  contains: input.search,
                  mode: "insensitive" as const,
                },
              },
              {
                subject: {
                  contains: input.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.inboundEmail.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        skip: (input.page - 1) * 30,
        take: 30,
      }),
      prisma.inboundEmail.count({ where }),
    ]);
    res.json({
      success: true,
      data: { items, total, pages: Math.max(1, Math.ceil(total / 30)) },
    });
  }),
);
emailWorkspaceRoutes.post(
  "/inbox/:id/ticket",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await linkInbound(String(req.params.id)) });
  }),
);
emailWorkspaceRoutes.post(
  "/inbox/:id/ignore",
  asyncHandler(async (req, res) => {
    await prisma.inboundEmail.update({
      where: { id: String(req.params.id) },
      data: { status: "IGNORED" },
    });
    res.json({ success: true });
  }),
);
emailWorkspaceRoutes.get(
  "/inbox/:id/attachments/:attachmentId",
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await attachmentLink(
        String(req.params.id),
        String(req.params.attachmentId),
      ),
    });
  }),
);
emailWorkspaceRoutes.get(
  "/campaigns",
  asyncHandler(async (_req, res) => {
    const items = await prisma.emailCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { _count: { select: { emails: true } } },
    });
    const statuses = await prisma.emailNotification.groupBy({
      by: ["campaignId", "status"],
      where: { campaignId: { not: null } },
      _count: true,
    });
    res.json({
      success: true,
      data: items.map((item) => ({
        ...item,
        counts: Object.fromEntries(
          statuses
            .filter((s) => s.campaignId === item.id)
            .map((s) => [s.status, s._count]),
        ),
      })),
    });
  }),
);
emailWorkspaceRoutes.post(
  "/campaigns",
  validate({ body: campaignSchema }),
  asyncHandler(async (req, res) => {
    const row = await prisma.emailCampaign.create({
      data: {
        ...campaignSchema.parse(req.body),
        createdById: req.user?.userId ?? null,
      },
    });
    res.json({ success: true, data: row });
  }),
);
emailWorkspaceRoutes.patch(
  "/campaigns/:id",
  validate({ body: campaignSchema }),
  asyncHandler(async (req, res) => {
    const result = await prisma.emailCampaign.updateMany({
      where: { id: String(req.params.id), status: "DRAFT" },
      data: campaignSchema.parse(req.body),
    });
    if (!result.count) {
      res.status(409).json({ error: "Only drafts can be edited" });
      return;
    }
    res.json({ success: true });
  }),
);
emailWorkspaceRoutes.get(
  "/campaigns/:id/preview",
  asyncHandler(async (req, res) => {
    const row = await prisma.emailCampaign.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!row) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json({
      success: true,
      data: {
        subject: row.subject,
        ...renderCampaign(row.subject, row.body, row.design),
      },
    });
  }),
);
emailWorkspaceRoutes.post(
  "/campaigns/:id/test",
  asyncHandler(async (req, res) => {
    const row = await prisma.emailCampaign.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!row) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const content = renderCampaign(row.subject, row.body, row.design);
    res.json({
      success: true,
      data: await queueRawEmail({
        email: emailConfig().admin,
        eventType: "CUSTOM_EMAIL",
        subject: "[Preview] " + row.subject,
        fromAddress:
          emailConfig().name + " <" + emailConfig().marketingFrom + ">",
        replyTo: emailConfig().marketingReplyTo,
        ...content,
        channel: "ADMIN",
      }),
    });
  }),
);
emailWorkspaceRoutes.post(
  "/campaigns/:id/send",
  validate({ body: z.object({ confirm: z.literal(true) }) }),
  asyncHandler(async (req, res) => {
    try {
      res.json({
        success: true,
        data: await queueCampaign(String(req.params.id)),
      });
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Could not queue campaign",
      });
    }
  }),
);
emailWorkspaceRoutes.post(
  "/campaigns/:id/cancel",
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await cancelCampaign(String(req.params.id)),
    });
  }),
);
