import { prisma } from "../../../lib/prisma.js";
import type { DiscountType } from "../../../generated/prisma/client.js";

export type CreateCouponInput = {
  code: string;
  label: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderCents?: number;
  maxUsageCount?: number | null;
  perUserLimit?: number | null;
  allowedEmail?: string | null;  // null = global coupon, string = email-locked coupon
  expiresAt?: Date | null;
};

export type CouponDiscount = {
  couponId: string;
  code: string;
  label: string;
  discountCents: number;
};

export async function createCoupon(input: CreateCouponInput) {
  return prisma.coupon.create({
    data: {
      code: input.code.trim().toUpperCase(),
      label: input.label.trim(),
      discountType: input.discountType,
      discountValue: input.discountValue,
      minOrderCents: input.minOrderCents ?? 0,
      maxUsageCount: input.maxUsageCount ?? null,
      perUserLimit: input.perUserLimit ?? null,
      allowedEmail: input.allowedEmail?.trim().toLowerCase() || null,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export async function listCoupons() {
  return prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { orders: true } } },
  });
}

export async function getCouponById(id: string) {
  return prisma.coupon.findUnique({ where: { id } });
}

export async function updateCoupon(id: string, input: Partial<CreateCouponInput> & { isActive?: boolean }) {
  return prisma.coupon.update({
    where: { id },
    data: {
      ...(input.code !== undefined && { code: input.code.trim().toUpperCase() }),
      ...(input.label !== undefined && { label: input.label.trim() }),
      ...(input.discountType !== undefined && { discountType: input.discountType }),
      ...(input.discountValue !== undefined && { discountValue: input.discountValue }),
      ...(input.minOrderCents !== undefined && { minOrderCents: input.minOrderCents }),
      ...(input.maxUsageCount !== undefined && { maxUsageCount: input.maxUsageCount }),
      ...(input.perUserLimit !== undefined && { perUserLimit: input.perUserLimit }),
      ...(input.allowedEmail !== undefined && { allowedEmail: input.allowedEmail?.trim().toLowerCase() || null }),
      ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

export async function deactivateCoupon(id: string) {
  return prisma.coupon.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function validateAndApplyCoupon(
  code: string,
  orderTotalCents: number,
  userId: string
): Promise<CouponDiscount> {
  const coupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });

  if (!coupon || !coupon.isActive) {
    throw new Error("Invalid coupon code");
  }
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    throw new Error("Coupon has expired");
  }
  if (coupon.maxUsageCount !== null && coupon.usageCount >= coupon.maxUsageCount) {
    throw new Error("Coupon usage limit has been reached");
  }
  if (orderTotalCents < coupon.minOrderCents) {
    throw new Error(
      `Minimum order amount of ₹${coupon.minOrderCents / 100} required for this coupon`
    );
  }
  // Email-restricted coupon check
  if (coupon.allowedEmail) {
    // Fetch the user's email to compare
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user || user.email.toLowerCase() !== coupon.allowedEmail) {
      throw new Error("This coupon is not valid for your account");
    }
  }
  if (coupon.perUserLimit !== null) {
    const userUsage = await prisma.order.count({
      where: { couponId: coupon.id, userId },
    });
    if (userUsage >= coupon.perUserLimit) {
      throw new Error("You have already used this coupon the maximum number of times");
    }
  }

  let discountCents = 0;
  if (coupon.discountType === "PERCENTAGE") {
    discountCents = Math.round((orderTotalCents * coupon.discountValue) / 100);
  } else if (coupon.discountType === "FLAT") {
    discountCents = coupon.discountValue;
  } else if (coupon.discountType === "FREE_SHIPPING") {
    discountCents = coupon.discountValue; // shipping amount
  }

  discountCents = Math.min(discountCents, orderTotalCents);

  return {
    couponId: coupon.id,
    code: coupon.code,
    label: coupon.label,
    discountCents,
  };
}
