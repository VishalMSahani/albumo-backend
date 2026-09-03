import { z } from "zod";

const ticketPriorities = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const ticketStatuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"] as const;
const ticketCategories = ["ORDER", "SHIPPING", "RETURNS_REFUNDS", "PRODUCT", "TECHNICAL", "OTHER"] as const;
const articleCategories = ["GENERAL", "SHIPPING", "RETURNS", "PRODUCT", "TROUBLESHOOTING"] as const;

export const createTicketSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z.string().trim().email("Enter a valid email address").max(254),
  category: z.enum(ticketCategories),
  priority: z.enum(ticketPriorities).default("MEDIUM"),
  subject: z.string().trim().min(5, "Subject must be at least 5 characters").max(160),
  description: z.string().trim().min(20, "Please provide at least 20 characters").max(5000),
  orderId: z.string().trim().min(1).max(100).optional(),
});

export const trackTicketSchema = z.object({
  email: z.string().trim().email("Enter the email used to create this ticket").max(254).optional(),
});

export const customerReplySchema = trackTicketSchema.extend({
  message: z.string().trim().min(2, "Enter a message").max(5000),
});

export const adminTicketUpdateSchema = z.object({
  status: z.enum(ticketStatuses).optional(),
  priority: z.enum(ticketPriorities).optional(),
  assignedToId: z.string().trim().min(1).nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, "Provide a status, priority, or assignee");

export const adminReplySchema = z.object({
  message: z.string().trim().min(2, "Enter a reply").max(5000),
  isInternal: z.boolean().default(false),
});

export const articleSchema = z.object({
  title: z.string().trim().min(5).max(180),
  slug: z.string().trim().max(180).optional(),
  excerpt: z.string().trim().min(10).max(320),
  content: z.string().trim().min(20).max(20000),
  category: z.enum(articleCategories),
  status: z.enum(["DRAFT", "PUBLISHED"] as const).default("DRAFT"),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10000).default(0),
});

export const articleUpdateSchema = articleSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  "Provide at least one article field",
);

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type AdminTicketUpdateInput = z.infer<typeof adminTicketUpdateSchema>;
export type ArticleInput = z.infer<typeof articleSchema>;
export type ArticleUpdateInput = z.infer<typeof articleUpdateSchema>;
