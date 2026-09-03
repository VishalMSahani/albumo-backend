import { z } from "zod";
import { LEGAL_POLICY_VERSION } from "../../legal/legal.constants.js";

export const printQualitySchema = z.enum(["DRAFT", "STANDARD", "FINE"]);
export const printFinishSchema = z.enum([
  "RAW",
  "SUPPORT_REMOVAL",
  "SANDED",
  "PRIMED",
  "PAINTED",
]);
export const printOrderStatusSchema = z.enum([
  "PAYMENT_PENDING",
  "PAID",
  "UNDER_REVIEW",
  "APPROVED",
  "PRINTING",
  "POST_PROCESSING",
  "QUALITY_CHECK",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "ON_HOLD",
  "CANCELLED",
  "REFUNDED",
]);

export const printQuoteBodySchema = z.object({
  fileIds: z.array(z.string().trim().min(1)).min(1).max(10),
  materialId: z.string().trim().min(1),
  color: z.string().trim().min(1).max(60),
  quality: printQualitySchema,
  finish: printFinishSchema,
  infillPercent: z.number().int().min(10).max(100),
  quantity: z.number().int().min(1).max(100),
});

export const printPreviewQuoteBodySchema = printQuoteBodySchema.omit({ fileIds: true });

const shippingAddressSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(8).max(20),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  pincode: z.string().trim().min(4).max(12),
  country: z.string().trim().min(2).max(80).optional(),
});

export const createPrintOrderBodySchema = printQuoteBodySchema
  .extend({
    shippingAddressId: z.string().trim().min(1).optional(),
    shippingAddress: shippingAddressSchema.optional(),
    customerNotes: z.string().trim().max(2000).optional(),
    legalConsent: z.object({
      accepted: z.literal(true),
      policyVersion: z.literal(LEGAL_POLICY_VERSION),
    }),
  })
  .refine((body) => Boolean(body.shippingAddressId || body.shippingAddress), {
    message: "A shipping address is required",
    path: ["shippingAddressId"],
  });

export const printIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const adminPrintOrderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: printOrderStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
});

export const adminPrintOrderUpdateSchema = z
  .object({
    status: printOrderStatusSchema.optional(),
    adminNotes: z.string().trim().max(4000).nullable().optional(),
    estimatedDays: z.number().int().min(1).max(90).optional(),
    trackingAwb: z.string().trim().max(120).nullable().optional(),
    trackingUrl: z.string().trim().url().max(500).nullable().optional(),
    statusNote: z.string().trim().max(500).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "At least one update field is required",
  });

const printMaterialSchema = z.object({
  id: z.string().trim().min(1).optional(),
  code: z.string().trim().toUpperCase().min(2).max(20),
  name: z.string().trim().min(2).max(80),
  densityGramsPerCm3: z.number().positive().max(25),
  pricePerGramCents: z.number().int().min(1).max(100000),
  colors: z.array(z.string().trim().min(1).max(40)).min(1).max(30),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(100),
});

export const adminPrintPricingUpdateSchema = z.object({
  isEnabled: z.boolean(),
  baseFeeCents: z.number().int().min(0).max(10000000),
  minimumOrderCents: z.number().int().min(0).max(10000000),
  shellMaterialPercent: z.number().int().min(0).max(100),
  draftMultiplierPercent: z.number().int().min(25).max(500),
  standardMultiplierPercent: z.number().int().min(25).max(500),
  fineMultiplierPercent: z.number().int().min(25).max(500),
  rawFinishFeeCents: z.number().int().min(0).max(10000000),
  supportRemovalFeeCents: z.number().int().min(0).max(10000000),
  sandingFeeCents: z.number().int().min(0).max(10000000),
  primerFeeCents: z.number().int().min(0).max(10000000),
  paintingFeeCents: z.number().int().min(0).max(10000000),
  draftLeadDays: z.number().int().min(1).max(90),
  standardLeadDays: z.number().int().min(1).max(90),
  fineLeadDays: z.number().int().min(1).max(90),
  maxFileSizeMb: z.number().int().min(1).max(100),
  maxFilesPerOrder: z.number().int().min(1).max(10),
  materials: z.array(printMaterialSchema).min(1).max(20),
});
