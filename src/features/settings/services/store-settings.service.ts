import { prisma } from "../../../lib/prisma.js";

export const DEFAULT_DELIVERY_FEE_CENTS = 5000;
export const DEFAULT_FREE_DELIVERY_THRESHOLD_CENTS = 50000;

export type DeliveryFeeRule = {
  id: string;
  minOrderCents: number;
  maxOrderCents: number;
  feeCents: number;
  sortOrder: number;
};

export type DeliverySettings = {
  deliveryFeeEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number;
  deliveryFeeRules: DeliveryFeeRule[];
  updatedAt: Date | null;
};

const DEFAULT_DELIVERY_FEE_RULES: DeliveryFeeRule[] = [
  {
    id: "default-delivery-rule",
    minOrderCents: 0,
    maxOrderCents: DEFAULT_FREE_DELIVERY_THRESHOLD_CENTS,
    feeCents: DEFAULT_DELIVERY_FEE_CENTS,
    sortOrder: 0,
  },
];

function serializeDeliveryFeeRules(
  rules: Array<DeliveryFeeRule & { storeSettingId?: number }>,
): DeliveryFeeRule[] {
  return rules.map(({ id, minOrderCents, maxOrderCents, feeCents, sortOrder }) => ({
    id,
    minOrderCents,
    maxOrderCents,
    feeCents,
    sortOrder,
  }));
}

export async function getDeliverySettings(): Promise<DeliverySettings> {
  try {
    const settings = await prisma.storeSetting.findUnique({
      where: { id: 1 },
      include: {
        deliveryFeeRules: {
          orderBy: [{ minOrderCents: "asc" }, { sortOrder: "asc" }],
        },
      },
    });

    return {
      deliveryFeeEnabled: settings?.deliveryFeeEnabled ?? true,
      deliveryFeeCents: settings?.deliveryFeeCents ?? DEFAULT_DELIVERY_FEE_CENTS,
      freeDeliveryThresholdCents:
        settings?.freeDeliveryThresholdCents ?? DEFAULT_FREE_DELIVERY_THRESHOLD_CENTS,
      deliveryFeeRules: settings
        ? serializeDeliveryFeeRules(settings.deliveryFeeRules)
        : DEFAULT_DELIVERY_FEE_RULES,
      updatedAt: settings?.updatedAt ?? null,
    };
  } catch (error) {
    console.warn("[store-settings] Using default delivery settings", error);
    return {
      deliveryFeeEnabled: true,
      deliveryFeeCents: DEFAULT_DELIVERY_FEE_CENTS,
      freeDeliveryThresholdCents: DEFAULT_FREE_DELIVERY_THRESHOLD_CENTS,
      deliveryFeeRules: DEFAULT_DELIVERY_FEE_RULES,
      updatedAt: null,
    };
  }
}

export async function updateDeliverySettings(input: {
  deliveryFeeEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryThresholdCents: number;
  deliveryFeeRules: Array<Omit<DeliveryFeeRule, "id" | "sortOrder">>;
}): Promise<DeliverySettings> {
  const settings = await prisma.$transaction(async (tx) => {
    await tx.storeSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        deliveryFeeEnabled: input.deliveryFeeEnabled,
        deliveryFeeCents: input.deliveryFeeCents,
        freeDeliveryThresholdCents: input.freeDeliveryThresholdCents,
      },
      update: {
        deliveryFeeEnabled: input.deliveryFeeEnabled,
        deliveryFeeCents: input.deliveryFeeCents,
        freeDeliveryThresholdCents: input.freeDeliveryThresholdCents,
      },
    });

    await tx.deliveryFeeRule.deleteMany({ where: { storeSettingId: 1 } });
    if (input.deliveryFeeRules.length > 0) {
      await tx.deliveryFeeRule.createMany({
        data: input.deliveryFeeRules
          .slice()
          .sort((a, b) => a.minOrderCents - b.minOrderCents)
          .map((rule, index) => ({
            storeSettingId: 1,
            minOrderCents: rule.minOrderCents,
            maxOrderCents: rule.maxOrderCents,
            feeCents: rule.feeCents,
            sortOrder: index,
          })),
      });
    }

    return tx.storeSetting.findUniqueOrThrow({
      where: { id: 1 },
      include: {
        deliveryFeeRules: {
          orderBy: [{ minOrderCents: "asc" }, { sortOrder: "asc" }],
        },
      },
    });
  });

  return {
    deliveryFeeEnabled: settings.deliveryFeeEnabled,
    deliveryFeeCents: settings.deliveryFeeCents,
    freeDeliveryThresholdCents: settings.freeDeliveryThresholdCents,
    deliveryFeeRules: serializeDeliveryFeeRules(settings.deliveryFeeRules),
    updatedAt: settings.updatedAt,
  };
}

export function calculateDeliveryFee(subtotalCents: number, settings: DeliverySettings): number {
  if (
    !settings.deliveryFeeEnabled ||
    subtotalCents === 0 ||
    subtotalCents >= settings.freeDeliveryThresholdCents
  ) {
    return 0;
  }

  const matchingRule = settings.deliveryFeeRules.find(
    (rule) => subtotalCents >= rule.minOrderCents && subtotalCents < rule.maxOrderCents,
  );

  return matchingRule?.feeCents ?? settings.deliveryFeeCents;
}
