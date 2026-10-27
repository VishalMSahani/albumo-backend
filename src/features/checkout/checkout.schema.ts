import { z } from "zod";

export const quantity = z.number().int().min(1).max(100);
export const addAlbumSchema = z
  .object({ baseRevision: z.number().int().min(1) })
  .strict();
export const quoteSchema = z
  .object({ couponCode: z.string().trim().max(60).default("") })
  .strict();
export const addressSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z
      .string()
      .trim()
      .regex(/^(?:\+91|91)?[6-9]\d{9}$/, "Enter a valid Indian mobile number"),
    line1: z.string().trim().min(5).max(200),
    line2: z.string().trim().max(200).default(""),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().min(2).max(80),
    pincode: z.string().regex(/^[1-9]\d{5}$/, "Enter a six-digit PIN code"),
    country: z.literal("India").default("India"),
  })
  .strict();
export const checkoutSchema = z
  .object({
    requestId: z.uuid(),
    quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
    couponCode: z.string().trim().max(60).default(""),
    shippingAddressId: z.string().min(1).max(100).optional(),
    shippingAddress: addressSchema.optional(),
    legalConsent: z
      .object({ accepted: z.literal(true), policyVersion: z.string().max(40) })
      .strict(),
    designAccepted: z.literal(true),
  })
  .strict()
  .refine(
    (value) => !!value.shippingAddressId !== !!value.shippingAddress,
    "Choose a saved address or enter a new address",
  );
export type CheckoutInput = z.infer<typeof checkoutSchema>;
