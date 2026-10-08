import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).default("");
export const bulkItemSchema = z.object({
  name: z.string().trim().min(2).max(200), sku: optionalText(100),
  quantity: z.number().int().min(1).max(100000),
  targetPriceCents: z.number().int().min(0).max(100000000).nullable().default(null),
  notes: optionalText(500),
});
export const bulkItemsSchema = z.array(bulkItemSchema).min(1).max(100);
export const createBulkOrderSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().regex(/^[+\d ()-]{10,30}$/, "Enter a valid phone number"),
  companyName: optionalText(150), notes: optionalText(4000),
  postalCode: z.string().regex(/^[1-9]\d{5}$/, "Enter a six-digit Indian PIN code"),
  deliveryAddress: z.string().trim().min(10).max(1000),
  gstin: z.string().trim().toUpperCase().regex(/^(?:[0-9A-Z]{15})?$/, "Use a 15-character GSTIN or leave blank").default(""),
  timeline: optionalText(100), items: bulkItemsSchema,
  consent: z.literal(true), website: z.string().max(0).default(""),
  requestKey: z.string().uuid(), accessKey: z.string().regex(/^[a-f0-9]{64}$/),
});
export const quoteItemSchema = bulkItemSchema.pick({ name: true, sku: true, quantity: true, notes: true }).extend({
  unitPriceCents: z.number().int().min(0).max(100000000),
  taxBasisPoints: z.number().int().min(0).max(10000),
});
export const quoteSchema = z.object({
  expectedVersion: z.number().int().min(0),
  items: z.array(quoteItemSchema).min(1).max(100),
  shippingCents: z.number().int().min(0).max(100000000),
  validUntil: z.iso.datetime(),
  leadTime: z.string().trim().min(2).max(200),
  terms: z.string().trim().min(10).max(4000),
});
export const accessSchema = z.object({ accessKey: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export const referenceSchema = z.object({ reference: z.string().regex(/^BQ-[A-F0-9]{16}$/) });
export const idSchema = z.object({ id: z.string().min(1).max(100) });
export const messageSchema = accessSchema.extend({ message: z.string().trim().min(2).max(4000) });
export const decisionSchema = accessSchema.extend({ quoteId: z.string().min(1).max(100), decision: z.enum(["ACCEPTED", "DECLINED"]), consent: z.literal(true) });
export const statusSchema = z.object({
  expectedVersion: z.number().int().min(0),
  status: z.enum(["REVIEWING", "IN_FULFILLMENT", "COMPLETED", "CANCELLED"]).optional(),
  adminNotes: z.string().trim().max(5000).optional(),
}).refine(value => value.status !== undefined || value.adminNotes !== undefined, "Choose a change");
export const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  search: z.string().trim().max(100).default(""),
  status: z.enum(["SUBMITTED", "REVIEWING", "QUOTED", "ACCEPTED", "DECLINED", "IN_FULFILLMENT", "COMPLETED", "CANCELLED"]).optional(),
});
export const recoverSchema = z.object({ reference: referenceSchema.shape.reference, email: z.string().trim().toLowerCase().email().max(254) });
export const csvSchema = z.object({ csv: z.string().min(1).max(250000) });
export const emptySchema = z.object({});
export type CreateBulkOrderInput = z.infer<typeof createBulkOrderSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;
export type BulkItem = z.infer<typeof bulkItemSchema>;
