import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { StudioProjectError } from "./error.js";
export const printProfileSchema = z
  .object({
    productId: z.string().max(100),
    supplier: z.string().trim().min(1).max(120),
    targetDpi: z.number().int().min(72).max(1200),
    minimumDpi: z.number().int().min(36).max(1200),
    bleedMm: z.number().min(0).max(25),
    safeMm: z.number().min(0).max(30),
    approved: z.boolean(),
  })
  .strict()
  .refine(
    (p) => p.minimumDpi <= p.targetDpi,
    "Minimum DPI cannot exceed target DPI.",
  );
export const operationPolicySchema = z
  .object({
    profiles: z.array(printProfileSchema).max(100),
    retentionEnabled: z.boolean(),
    retentionDays: z.number().int().min(1).max(3650).nullable(),
    alertMinutes: z.number().int().min(5).max(1440),
  })
  .strict()
  .refine(
    (p) => !p.retentionEnabled || p.retentionDays !== null,
    "Choose a retention period before enabling cleanup.",
  )
  .refine(
    (p) =>
      new Set(p.profiles.map((f) => f.productId)).size === p.profiles.length,
    "Use one print profile per product, plus one default profile.",
  );
export type OperationPolicy = z.infer<typeof operationPolicySchema>;
export const defaultPolicy: OperationPolicy = {
  profiles: [],
  retentionEnabled: false,
  retentionDays: null,
  alertMinutes: 30,
};
export const policyInput = z
  .object({
    baseRevision: z.number().int().min(0),
    policy: operationPolicySchema,
    confirmRetention: z.boolean().default(false),
  })
  .strict();
export async function operationSettings(db: Prisma.TransactionClient = prisma) {
  const row = await db.studioOperationSetting.findUnique({ where: { id: 1 } });
  return {
    revision: row?.revision ?? 0,
    policy: row ? operationPolicySchema.parse(row.policy) : defaultPolicy,
    workerHeartbeatAt: row?.workerHeartbeatAt ?? null,
    workerLastSuccessAt: row?.workerLastSuccessAt ?? null,
    workerError: row?.workerError ?? null,
  };
}
export async function saveOperationSettings(
  actorId: string,
  input: z.infer<typeof policyInput>,
) {
  if (input.policy.retentionEnabled && !input.confirmRetention)
    throw new StudioProjectError(
      422,
      "RETENTION_CONFIRMATION",
      "Confirm the unused-photo retention rule before enabling it.",
    );
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "StudioOperationSetting" ("id", "policy", "updatedAt") VALUES (1, ${JSON.stringify(defaultPolicy)}::jsonb, NOW()) ON CONFLICT ("id") DO NOTHING`;
    await tx.$queryRaw`SELECT "id" FROM "StudioOperationSetting" WHERE "id" = 1 FOR UPDATE`;
    const row = await tx.studioOperationSetting.findUniqueOrThrow({
      where: { id: 1 },
    });
    if (row.revision !== input.baseRevision)
      throw new StudioProjectError(
        409,
        "SETTINGS_CHANGED",
        "Settings changed in another tab. Reload before saving.",
      );
    const ids = input.policy.profiles.map((p) => p.productId).filter(Boolean);
    if (
      ids.length &&
      (await tx.component.count({ where: { id: { in: ids } } })) !== ids.length
    )
      throw new StudioProjectError(
        422,
        "PRODUCT_UNAVAILABLE",
        "Choose existing album products for print profiles.",
      );
    await tx.studioOperationSetting.update({
      where: { id: 1 },
      data: {
        policy: input.policy,
        revision: { increment: 1 },
        updatedBy: actorId,
      },
    });
    await tx.studioPolicyAudit.create({
      data: { revision: row.revision + 1, actorId, policy: input.policy },
    });
    return operationSettings(tx);
  });
}
export function profileFor(
  policy: OperationPolicy,
  productId: string | null | undefined,
) {
  return (
    policy.profiles.find((p) => p.productId === productId) ??
    policy.profiles.find((p) => p.productId === "") ??
    null
  );
}
export async function publicStudioSettings(productId?: string) {
  const settings = await operationSettings();
  const profile = profileFor(settings.policy, productId);
  return {
    revision: settings.revision,
    print: profile?.approved ? profile : null,
    retention: {
      enabled: settings.policy.retentionEnabled,
      days: settings.policy.retentionDays,
    },
  };
}
