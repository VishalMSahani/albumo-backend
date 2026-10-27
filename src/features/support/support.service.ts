import crypto from "crypto";
import {
  EmailEventType,
  KnowledgeBaseStatus,
  Prisma,
  SupportMessageSender,
  SupportTicketPriority,
  SupportTicketStatus,
  UserRole,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { emailConfig } from "../../services/email-config.js";
import {
  queueAdminNotice,
  queueRawEmail,
} from "../../services/email-notification.service.js";
import { supportReplyAddress } from "../../services/email-tokens.js";
import { getEmailTemplate } from "../../utils/email-templates.js";
import { queueEmailNotification } from "../../services/email-notification.service.js";
import { NotFoundError, ValidationError } from "../../utils/types.js";
import type {
  AdminTicketUpdateInput,
  ArticleInput,
  ArticleUpdateInput,
  CreateTicketInput,
} from "./support.validator.js";

type CustomerIdentity = {
  userId?: string;
  email?: string;
};

type TicketListQuery = {
  page: number;
  limit: number;
  search?: string;
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
  category?: Prisma.SupportTicketWhereInput["category"];
  sla?: "BREACHED" | "DUE_SOON";
  source?: string;
};

type ArticleQuery = {
  search?: string;
  category?: Prisma.KnowledgeBaseArticleWhereInput["category"];
};

const slaHours: Record<
  SupportTicketPriority,
  { response: number; resolution: number }
> = {
  URGENT: { response: 2, resolution: 8 },
  HIGH: { response: 8, resolution: 24 },
  MEDIUM: { response: 24, resolution: 72 },
  LOW: { response: 48, resolution: 120 },
};

const customerTicketInclude = {
  order: { select: { id: true, status: true, totalAmountCents: true } },
  assignedTo: { select: { name: true } },
  messages: {
    where: { isInternal: false },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sender: true,
      authorName: true,
      body: true,
      createdAt: true,
    },
  },
} satisfies Prisma.SupportTicketInclude;

const adminTicketInclude = {
  order: { select: { id: true, status: true, totalAmountCents: true } },
  user: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  messages: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.SupportTicketInclude;

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function deadlines(priority: SupportTicketPriority, startedAt = new Date()) {
  return {
    firstResponseDueAt: addHours(startedAt, slaHours[priority].response),
    resolutionDueAt: addHours(startedAt, slaHours[priority].resolution),
  };
}

function createTicketNumber() {
  const now = new Date();
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `AL-${month}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function frontendUrl() {
  return emailConfig().siteUrl;
}

function ticketTrackingUrl(ticketNumber: string) {
  return `${frontendUrl()}/support/tickets/${encodeURIComponent(ticketNumber)}`;
}

function queueTicketEmail(
  email: string,
  eventType: EmailEventType,
  ticket: {
    ticketNumber: string;
    requesterName: string;
    requesterEmail: string;
    subject: string;
    priority: SupportTicketPriority;
    status: SupportTicketStatus;
  },
  options: {
    userId?: string;
    message?: string;
    audience?: "CUSTOMER" | "SUPPORT";
  } = {},
) {
  return queueEmailNotification(
    email,
    eventType,
    {
      ticket: {
        ...ticket,
        trackingUrl: ticketTrackingUrl(ticket.ticketNumber),
        message: options.message,
      },
      audience: options.audience ?? "CUSTOMER",
    },
    options.userId,
  ).catch((error) =>
    console.error("[Support] Could not queue ticket email", error),
  );
}

async function notifyTicketCreated(ticket: {
  ticketNumber: string;
  userId: string | null;
  requesterName: string;
  requesterEmail: string;
  subject: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
}) {
  await queueTicketEmail(
    ticket.requesterEmail,
    EmailEventType.SUPPORT_TICKET_CREATED,
    ticket,
    {
      ...(ticket.userId ? { userId: ticket.userId } : {}),
    },
  );

  const supportEmail = emailConfig().admin;
  if (
    supportEmail &&
    supportEmail.toLowerCase() !== ticket.requesterEmail.toLowerCase()
  ) {
    await queueTicketEmail(
      supportEmail,
      EmailEventType.SUPPORT_TICKET_CREATED,
      ticket,
      { audience: "SUPPORT" },
    );
  }
}

async function requesterFor(
  userId: string | undefined,
  input: CreateTicketInput,
) {
  if (!userId) {
    return { userId: null, name: input.name, email: input.email.toLowerCase() };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new ValidationError("Your account could not be found");
  return {
    userId: user.id,
    name: user.name || input.name,
    email: user.email.toLowerCase(),
  };
}

export async function createSupportTicket(
  input: CreateTicketInput,
  authenticatedUserId?: string,
  context?: { source: string; enquiry: Prisma.InputJsonObject },
) {
  const requester = await requesterFor(authenticatedUserId, input);
  if (input.orderId) {
    if (!requester.userId)
      throw new ValidationError("Sign in to link an order to this ticket");
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, userId: requester.userId },
      select: { id: true },
    });
    if (!order)
      throw new ValidationError(
        "The selected order could not be linked to this ticket",
      );
  }

  const now = new Date();
  const priority = input.priority as SupportTicketPriority;
  const ticket = await prisma.supportTicket.create({
    data: {
      ticketNumber: createTicketNumber(),
      userId: requester.userId,
      orderId: input.orderId ?? null,
      requesterName: requester.name,
      requesterEmail: requester.email,
      category: input.category,
      subject: input.subject,
      description: input.description,
      ...(context ? { source: context.source, enquiry: context.enquiry } : {}),
      priority,
      ...deadlines(priority, now),
      messages: {
        create: [
          {
            authorId: requester.userId,
            authorName: requester.name,
            sender: SupportMessageSender.CUSTOMER,
            body: input.description,
          },
          {
            authorName: "Albumo Support",
            sender: SupportMessageSender.SYSTEM,
            body: "We received your request. A support specialist will review it within the response time shown above.",
          },
        ],
      },
    },
    include: customerTicketInclude,
  });

  await notifyTicketCreated(ticket).catch((error) =>
    console.error("[Support] Could not queue notifications", error),
  );
  return ticket;
}

function customerAccessWhere(
  ticketNumber: string,
  identity: CustomerIdentity,
): Prisma.SupportTicketWhereInput {
  const normalizedEmail = identity.email?.trim().toLowerCase();
  if (identity.userId) {
    return {
      ticketNumber,
      OR: [
        { userId: identity.userId },
        ...(normalizedEmail ? [{ requesterEmail: normalizedEmail }] : []),
      ],
    };
  }
  if (!normalizedEmail)
    throw new ValidationError("Enter the email used to create this ticket");
  return { ticketNumber, requesterEmail: normalizedEmail };
}

export async function getCustomerTicket(
  ticketNumber: string,
  identity: CustomerIdentity,
) {
  const ticket = await prisma.supportTicket.findFirst({
    where: customerAccessWhere(ticketNumber, identity),
    include: customerTicketInclude,
  });
  if (!ticket)
    throw new NotFoundError(
      "Ticket not found. Check the ticket number and email address",
    );
  return ticket;
}

export async function getMySupportTickets(userId: string, email: string) {
  return prisma.supportTicket.findMany({
    where: { OR: [{ userId }, { requesterEmail: email.toLowerCase() }] },
    include: {
      order: { select: { id: true, status: true } },
      _count: { select: { messages: true } },
    },
    orderBy: { lastActivityAt: "desc" },
  });
}

export async function addCustomerReply(
  ticketNumber: string,
  identity: CustomerIdentity,
  message: string,
) {
  const ticket = await getCustomerTicket(ticketNumber, identity);
  if (ticket.status === SupportTicketStatus.CLOSED) {
    throw new ValidationError(
      "This ticket is closed. Create a new ticket if you still need help",
    );
  }

  const now = new Date();
  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status:
        ticket.status === SupportTicketStatus.RESOLVED
          ? SupportTicketStatus.OPEN
          : ticket.status === SupportTicketStatus.WAITING_FOR_CUSTOMER
            ? SupportTicketStatus.IN_PROGRESS
            : ticket.status,
      resolvedAt:
        ticket.status === SupportTicketStatus.RESOLVED
          ? null
          : ticket.resolvedAt,
      lastActivityAt: now,
      messages: {
        create: {
          authorId: identity.userId ?? null,
          authorName: ticket.requesterName,
          sender: SupportMessageSender.CUSTOMER,
          body: message,
        },
      },
    },
    include: customerTicketInclude,
  });
  await queueAdminNotice(
    "Customer replied | " + ticket.ticketNumber,
    ticket.subject +
      "\n\n" +
      message +
      "\n\n" +
      emailConfig().adminUrl +
      "/support",
    "support-reply:" + updated.messages.at(-1)?.id,
  ).catch(() => undefined);
  return updated;
}

function adminTicketWhere(
  input: TicketListQuery,
): Prisma.SupportTicketWhereInput {
  const now = new Date();
  const dueSoon = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return {
    ...(input.status ? { status: input.status } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.search
      ? {
          OR: [
            { id: input.search },
            { ticketNumber: { contains: input.search, mode: "insensitive" } },
            { subject: { contains: input.search, mode: "insensitive" } },
            { requesterName: { contains: input.search, mode: "insensitive" } },
            { requesterEmail: { contains: input.search, mode: "insensitive" } },
            { orderId: { contains: input.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(input.sla === "BREACHED"
      ? {
          OR: [
            { firstRespondedAt: null, firstResponseDueAt: { lt: now } },
            {
              resolvedAt: null,
              status: {
                notIn: [
                  SupportTicketStatus.RESOLVED,
                  SupportTicketStatus.CLOSED,
                ],
              },
              resolutionDueAt: { lt: now },
            },
          ],
        }
      : input.sla === "DUE_SOON"
        ? {
            OR: [
              {
                firstRespondedAt: null,
                firstResponseDueAt: { gte: now, lte: dueSoon },
              },
              {
                resolvedAt: null,
                status: {
                  notIn: [
                    SupportTicketStatus.RESOLVED,
                    SupportTicketStatus.CLOSED,
                  ],
                },
                resolutionDueAt: { gte: now, lte: dueSoon },
              },
            ],
          }
        : {}),
  };
}

export async function getAdminSupportTickets(input: TicketListQuery) {
  const where = adminTicketWhere(input);
  const now = new Date();
  const breachedWhere: Prisma.SupportTicketWhereInput = {
    OR: [
      { firstRespondedAt: null, firstResponseDueAt: { lt: now } },
      {
        resolvedAt: null,
        status: {
          notIn: [SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED],
        },
        resolutionDueAt: { lt: now },
      },
    ],
  };
  const [tickets, total, open, breached, unassigned] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: adminTicketInclude,
      orderBy: [{ priority: "asc" }, { lastActivityAt: "desc" }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.count({
      where: {
        status: {
          notIn: [SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED],
        },
      },
    }),
    prisma.supportTicket.count({ where: breachedWhere }),
    prisma.supportTicket.count({
      where: {
        assignedToId: null,
        status: {
          notIn: [SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED],
        },
      },
    }),
  ]);
  return {
    tickets,
    summary: { total, open, breached, unassigned },
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.limit)),
    },
  };
}

export async function getAdminSupportTicket(id: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: adminTicketInclude,
  });
  if (!ticket) throw new NotFoundError("Support ticket not found");
  return ticket;
}

export async function updateAdminSupportTicket(
  id: string,
  input: AdminTicketUpdateInput,
  adminId: string,
  adminName: string,
) {
  const current = await getAdminSupportTicket(id);
  if (input.assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: {
        id: input.assignedToId,
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        isActive: true,
      },
      select: { id: true },
    });
    if (!assignee)
      throw new ValidationError("Assignee must be an active administrator");
  }

  const now = new Date();
  const statusChanged = Boolean(
    input.status && input.status !== current.status,
  );
  const priorityChanged = Boolean(
    input.priority && input.priority !== current.priority,
  );
  const update: Prisma.SupportTicketUncheckedUpdateInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.priority
      ? {
          priority: input.priority,
          ...deadlines(input.priority, current.createdAt),
        }
      : {}),
    ...(input.assignedToId !== undefined
      ? { assignedToId: input.assignedToId }
      : {}),
    ...(input.status === SupportTicketStatus.RESOLVED ||
    input.status === SupportTicketStatus.CLOSED
      ? { resolvedAt: current.resolvedAt ?? now }
      : input.status
        ? { resolvedAt: null }
        : {}),
    lastActivityAt: now,
  };

  const ticket = await prisma.$transaction(async (tx) => {
    const updated = await tx.supportTicket.update({
      where: { id },
      data: update,
      include: adminTicketInclude,
    });
    if (statusChanged) {
      await tx.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorId: adminId,
          authorName: adminName,
          sender: SupportMessageSender.SYSTEM,
          body: `Ticket status changed from ${current.status.replace(/_/g, " ")} to ${updated.status.replace(/_/g, " ")}.`,
        },
      });
      return tx.supportTicket.findUniqueOrThrow({
        where: { id },
        include: adminTicketInclude,
      });
    }
    return updated;
  });

  if (statusChanged || priorityChanged) {
    await queueTicketEmail(
      ticket.requesterEmail,
      EmailEventType.SUPPORT_TICKET_UPDATED,
      ticket,
      {
        ...(ticket.userId ? { userId: ticket.userId } : {}),
      },
    );
  }
  return ticket;
}

export async function addAdminReply(
  id: string,
  message: string,
  isInternal: boolean,
  adminId: string,
  adminName: string,
) {
  const current = await getAdminSupportTicket(id);
  if (
    !isInternal &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current.requesterEmail) ||
      current.requesterEmail.endsWith(".invalid"))
  ) {
    throw new ValidationError(
      "This ticket does not have a deliverable customer email address. Add an internal note instead.",
    );
  }
  const now = new Date();
  const isAwaitingSupport =
    current.status === SupportTicketStatus.OPEN ||
    current.status === SupportTicketStatus.IN_PROGRESS;
  const nextStatus =
    !isInternal && isAwaitingSupport
      ? SupportTicketStatus.WAITING_FOR_CUSTOMER
      : current.status;

  // A public reply and its email enter the database together, or neither does.
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.update({
      where: { id },
      data: {
        status: nextStatus,
        firstRespondedAt:
          !isInternal && !current.firstRespondedAt
            ? now
            : current.firstRespondedAt,
        lastActivityAt: now,
      },
      include: adminTicketInclude,
    });

    const reply = await tx.supportTicketMessage.create({
      data: {
        ticketId: id,
        authorId: adminId,
        authorName: adminName,
        sender: SupportMessageSender.SUPPORT,
        body: message,
        isInternal,
      },
    });
    if (!isInternal) {
      const template = getEmailTemplate(EmailEventType.SUPPORT_TICKET_REPLY, {
        audience: "CUSTOMER",
        ticket: {
          ...ticket,
          message,
          trackingUrl: ticketTrackingUrl(ticket.ticketNumber),
        },
      });
      await queueRawEmail(
        {
          email: ticket.requesterEmail,
          eventType: EmailEventType.SUPPORT_TICKET_REPLY,
          subject: template.subject,
          html: template.html,
          text: template.text || "",
          ticketId: id,
          ...(ticket.userId ? { userId: ticket.userId } : {}),
          replyTo: supportReplyAddress(id),
          dedupeKey: "support-message:" + reply.id,
        },
        tx,
      );
    }
    return tx.supportTicket.findUniqueOrThrow({
      where: { id },
      include: adminTicketInclude,
    });
  });
}

/** Optional direct email: does not post a ticket reply or change its status/SLA. */
export async function sendSupportEmail(
  id: string,
  subject: string,
  message: string,
  requestId: string,
  adminId: string,
) {
  const ticket = await getAdminSupportTicket(id);
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ticket.requesterEmail) ||
    ticket.requesterEmail.endsWith(".invalid")
  ) {
    throw new ValidationError(
      "This customer does not have a deliverable email address.",
    );
  }
  const template = getEmailTemplate(EmailEventType.CUSTOM_EMAIL, {
    subject,
    message:
      message +
      "\n\nTicket: " +
      ticket.ticketNumber +
      "\nView your request: " +
      ticketTrackingUrl(ticket.ticketNumber),
  });
  return queueRawEmail({
    email: ticket.requesterEmail,
    eventType: EmailEventType.CUSTOM_EMAIL,
    subject: template.subject,
    html: template.html,
    text: template.text || "",
    ticketId: id,
    ...(ticket.userId ? { userId: ticket.userId } : {}),
    replyTo: supportReplyAddress(id),
    metadata: { source: "SUPPORT_MANUAL_EMAIL", adminId },
    dedupeKey: "support-email:" + id + ":" + adminId + ":" + requestId,
  });
}

export async function listSupportAgents() {
  return prisma.user.findMany({
    where: {
      role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
      isActive: true,
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
}

export async function listPublishedArticles(input: ArticleQuery) {
  return prisma.knowledgeBaseArticle.findMany({
    where: {
      status: KnowledgeBaseStatus.PUBLISHED,
      ...(input.category ? { category: input.category } : {}),
      ...(input.search
        ? {
            OR: [
              { title: { contains: input.search, mode: "insensitive" } },
              { excerpt: { contains: input.search, mode: "insensitive" } },
              { content: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      category: true,
      isFeatured: true,
      viewCount: true,
      updatedAt: true,
    },
    orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { title: "asc" }],
  });
}

export async function getPublishedArticle(slug: string) {
  const article = await prisma.knowledgeBaseArticle.findFirst({
    where: { slug, status: KnowledgeBaseStatus.PUBLISHED },
  });
  if (!article) throw new NotFoundError("Help article not found");
  void prisma.knowledgeBaseArticle
    .update({
      where: { id: article.id },
      data: { viewCount: { increment: 1 } },
    })
    .catch(() => undefined);
  return article;
}

export async function listAdminArticles() {
  return prisma.knowledgeBaseArticle.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
  });
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
}

export async function createKnowledgeArticle(
  input: ArticleInput,
  adminId: string,
) {
  const slug = slugify(input.slug || input.title);
  if (!slug)
    throw new ValidationError("Enter a title that can be used as a URL");
  return prisma.knowledgeBaseArticle.create({
    data: {
      ...input,
      slug,
      createdById: adminId,
      updatedById: adminId,
      publishedAt:
        input.status === KnowledgeBaseStatus.PUBLISHED ? new Date() : null,
    },
  });
}

export async function updateKnowledgeArticle(
  id: string,
  input: ArticleUpdateInput,
  adminId: string,
) {
  const current = await prisma.knowledgeBaseArticle.findUnique({
    where: { id },
  });
  if (!current) throw new NotFoundError("Help article not found");
  const slug =
    input.slug !== undefined || input.title !== undefined
      ? slugify(input.slug || input.title || current.title)
      : undefined;
  const data: Prisma.KnowledgeBaseArticleUncheckedUpdateInput = {
    updatedById: adminId,
  };
  if (input.title !== undefined) data.title = input.title;
  if (input.excerpt !== undefined) data.excerpt = input.excerpt;
  if (input.content !== undefined) data.content = input.content;
  if (input.category !== undefined) data.category = input.category;
  if (input.status !== undefined) data.status = input.status;
  if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (slug) data.slug = slug;
  if (input.status === KnowledgeBaseStatus.PUBLISHED && !current.publishedAt)
    data.publishedAt = new Date();
  if (input.status === KnowledgeBaseStatus.DRAFT) data.publishedAt = null;

  return prisma.knowledgeBaseArticle.update({
    where: { id },
    data,
  });
}

export async function deleteKnowledgeArticle(id: string) {
  const article = await prisma.knowledgeBaseArticle.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!article) throw new NotFoundError("Help article not found");
  await prisma.knowledgeBaseArticle.delete({ where: { id } });
}
