import { z } from 'zod';

export const productPricingSchema = z.object({
  unitPriceCents: z.number().int().min(0).max(100000000),
  discountedPriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
  stockQuantity: z.number().int().min(0).max(2147483647).optional(),
}).superRefine((value, context) => {
  if (value.discountedPriceCents != null && value.discountedPriceCents >= value.unitPriceCents) {
    context.addIssue({ code: 'custom', path: ['discountedPriceCents'], message: 'Sale price must be lower than the original unit price' });
  }
});
