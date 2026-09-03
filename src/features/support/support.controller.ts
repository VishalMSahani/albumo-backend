import type { Request, Response } from "express";
import {
  KnowledgeBaseCategory,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from "../../generated/prisma/client.js";
import { logAdminAction } from "../../services/admin-action-log.service.js";
import { AuthError, ValidationError } from "../../utils/types.js";
import {
  addAdminReply,
  addCustomerReply,
  createKnowledgeArticle,
  createSupportTicket,
  deleteKnowledgeArticle,
  getAdminSupportTicket,
  getAdminSupportTickets,
  getCustomerTicket,
  getMySupportTickets,
  getPublishedArticle,
  listAdminArticles,
  listPublishedArticles,
  listSupportAgents,
  updateAdminSupportTicket,
  updateKnowledgeArticle,
} from "./support.service.js";
import {
  adminReplySchema,
  adminTicketUpdateSchema,
  articleSchema,
  articleUpdateSchema,
  createTicketSchema,
  customerReplySchema,
  trackTicketSchema,
} from "./support.validator.js";

function sendError(res: Response, error: unknown) {
  if (error instanceof AuthError) {
    res.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
    return;
  }
  console.error("[Support] Request failed", error);
  res.status(500).json({ success: false, error: "Could not complete the support request" });
}

function parse<T>(result: { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } }, res: Response) {
  if (result.success) return result.data;
  res.status(400).json({ success: false, error: result.error.issues[0]?.message || "Invalid request" });
  return null;
}

function enumQuery<T extends Record<string, string>>(values: T, value: unknown): T[keyof T] | undefined {
  return typeof value === "string" && Object.values(values).includes(value)
    ? value as T[keyof T]
    : undefined;
}

function pathParam(req: Request, name: string) {
  const value = req.params[name];
  if (!value) throw new ValidationError(`Missing ${name}`);
  return value;
}

function customerIdentity(req: Request, email?: string) {
  if (req.user?.userId) return { userId: req.user.userId, email: req.user.email };
  return email ? { email } : {};
}

export async function createTicketHandler(req: Request, res: Response) {
  try {
    const input = parse(createTicketSchema.safeParse(req.body), res);
    if (!input) return;
    const ticket = await createSupportTicket(input, req.user?.userId);
    res.status(201).json({
      success: true,
      message: "Support ticket created",
      data: ticket,
    });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getMyTicketsHandler(req: Request, res: Response) {
  try {
    const tickets = await getMySupportTickets(req.user!.userId, req.user!.email);
    res.json({ success: true, data: tickets });
  } catch (error) {
    sendError(res, error);
  }
}

export async function trackTicketHandler(req: Request, res: Response) {
  try {
    const input = parse(trackTicketSchema.safeParse(req.body), res);
    if (!input) return;
    const ticket = await getCustomerTicket(
      pathParam(req, "ticketNumber"),
      customerIdentity(req, input.email),
    );
    res.json({ success: true, data: ticket });
  } catch (error) {
    sendError(res, error);
  }
}

export async function customerReplyHandler(req: Request, res: Response) {
  try {
    const input = parse(customerReplySchema.safeParse(req.body), res);
    if (!input) return;
    const ticket = await addCustomerReply(
      pathParam(req, "ticketNumber"),
      customerIdentity(req, input.email),
      input.message,
    );
    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    sendError(res, error);
  }
}

export async function listKnowledgeBaseHandler(req: Request, res: Response) {
  try {
    const articles = await listPublishedArticles({
      ...(typeof req.query.search === "string" && req.query.search.trim()
        ? { search: req.query.search.trim().slice(0, 160) }
        : {}),
      ...(enumQuery(KnowledgeBaseCategory, req.query.category)
        ? { category: enumQuery(KnowledgeBaseCategory, req.query.category)! }
        : {}),
    });
    res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
    res.json({ success: true, data: articles });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getKnowledgeArticleHandler(req: Request, res: Response) {
  try {
    const article = await getPublishedArticle(pathParam(req, "slug"));
    res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
    res.json({ success: true, data: article });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getAdminTicketsHandler(req: Request, res: Response) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const sla = req.query.sla === "BREACHED" || req.query.sla === "DUE_SOON" ? req.query.sla : undefined;
    const data = await getAdminSupportTickets({
      page,
      limit,
      ...(typeof req.query.search === "string" && req.query.search.trim()
        ? { search: req.query.search.trim().slice(0, 160) }
        : {}),
      ...(enumQuery(SupportTicketStatus, req.query.status) ? { status: enumQuery(SupportTicketStatus, req.query.status)! } : {}),
      ...(enumQuery(SupportTicketPriority, req.query.priority) ? { priority: enumQuery(SupportTicketPriority, req.query.priority)! } : {}),
      ...(enumQuery(SupportTicketCategory, req.query.category) ? { category: enumQuery(SupportTicketCategory, req.query.category)! } : {}),
      ...(sla ? { sla } : {}),
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getAdminTicketHandler(req: Request, res: Response) {
  try {
    res.json({ success: true, data: await getAdminSupportTicket(pathParam(req, "id")) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function updateAdminTicketHandler(req: Request, res: Response) {
  try {
    const input = parse(adminTicketUpdateSchema.safeParse(req.body), res);
    if (!input) return;
    const ticket = await updateAdminSupportTicket(
      pathParam(req, "id"),
      input,
      req.user!.userId,
      req.user!.email,
    );
    await logAdminAction(req.user!.userId, "UPDATE_SUPPORT_TICKET", "SUPPORT_TICKET", ticket.id, input);
    res.json({ success: true, data: ticket });
  } catch (error) {
    sendError(res, error);
  }
}

export async function addAdminReplyHandler(req: Request, res: Response) {
  try {
    const input = parse(adminReplySchema.safeParse(req.body), res);
    if (!input) return;
    const ticket = await addAdminReply(
      pathParam(req, "id"),
      input.message,
      input.isInternal,
      req.user!.userId,
      req.user!.email,
    );
    await logAdminAction(req.user!.userId, "REPLY_SUPPORT_TICKET", "SUPPORT_TICKET", ticket.id, {
      internal: input.isInternal,
    });
    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getSupportAgentsHandler(_req: Request, res: Response) {
  try {
    res.json({ success: true, data: await listSupportAgents() });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getAdminArticlesHandler(_req: Request, res: Response) {
  try {
    res.json({ success: true, data: await listAdminArticles() });
  } catch (error) {
    sendError(res, error);
  }
}

export async function createAdminArticleHandler(req: Request, res: Response) {
  try {
    const input = parse(articleSchema.safeParse(req.body), res);
    if (!input) return;
    const article = await createKnowledgeArticle(input, req.user!.userId);
    await logAdminAction(req.user!.userId, "CREATE_KNOWLEDGE_ARTICLE", "KNOWLEDGE_ARTICLE", article.id);
    res.status(201).json({ success: true, data: article });
  } catch (error) {
    sendError(res, error);
  }
}

export async function updateAdminArticleHandler(req: Request, res: Response) {
  try {
    const input = parse(articleUpdateSchema.safeParse(req.body), res);
    if (!input) return;
    const article = await updateKnowledgeArticle(pathParam(req, "id"), input, req.user!.userId);
    await logAdminAction(req.user!.userId, "UPDATE_KNOWLEDGE_ARTICLE", "KNOWLEDGE_ARTICLE", article.id);
    res.json({ success: true, data: article });
  } catch (error) {
    sendError(res, error);
  }
}

export async function deleteAdminArticleHandler(req: Request, res: Response) {
  try {
    const id = pathParam(req, "id");
    await deleteKnowledgeArticle(id);
    await logAdminAction(req.user!.userId, "DELETE_KNOWLEDGE_ARTICLE", "KNOWLEDGE_ARTICLE", id);
    res.json({ success: true, message: "Help article deleted" });
  } catch (error) {
    sendError(res, error);
  }
}
