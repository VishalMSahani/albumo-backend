import { z } from "zod";

export const adminRoleMutationBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const adminCustomerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export const adminCustomerIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const adminCustomerStatusBodySchema = z.object({
  isActive: z.boolean(),
});

const deliveryFeeRuleSchema = z
  .object({
    minOrderCents: z.number().int().min(0).max(100000000),
    maxOrderCents: z.number().int().positive().max(100000000),
    feeCents: z.number().int().min(0).max(10000000),
  })
  .refine((rule) => rule.maxOrderCents > rule.minOrderCents, {
    message: "Range maximum must be greater than its minimum",
    path: ["maxOrderCents"],
  });

export const adminDeliverySettingsBodySchema = z
  .object({
    deliveryFeeEnabled: z.boolean(),
    deliveryFeeCents: z.number().int().min(0).max(10000000),
    freeDeliveryThresholdCents: z.number().int().positive().max(100000000),
    deliveryFeeRules: z.array(deliveryFeeRuleSchema).max(20),
  })
  .superRefine((settings, context) => {
    const rules = settings.deliveryFeeRules.slice().sort((a, b) => a.minOrderCents - b.minOrderCents);

    rules.forEach((rule, index) => {
      const previousRule = index > 0 ? rules[index - 1] : undefined;

      if (rule.maxOrderCents > settings.freeDeliveryThresholdCents) {
        context.addIssue({
          code: "custom",
          message: "Delivery ranges cannot extend beyond the free-delivery minimum",
          path: ["deliveryFeeRules", index, "maxOrderCents"],
        });
      }

      if (previousRule && rule.minOrderCents < previousRule.maxOrderCents) {
        context.addIssue({
          code: "custom",
          message: "Delivery fee ranges cannot overlap",
          path: ["deliveryFeeRules", index, "minOrderCents"],
        });
      }
    });
  });
