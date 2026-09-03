import { prisma } from "../../../lib/prisma.js";
import type { WishlistItem, Component } from "../../../generated/prisma/client.js";

export type WishlistItemWithComponent = WishlistItem & {
  component: Pick<Component, "id" | "name" | "imageUrl" | "unitPriceCents" | "stockQuantity" | "isActive" | "sku">;
};

export async function getWishlist(userId: string): Promise<WishlistItemWithComponent[]> {
  return prisma.wishlistItem.findMany({
    where: { userId },
    include: {
      component: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          unitPriceCents: true,
          stockQuantity: true,
          isActive: true,
          sku: true,
        },
      },
    },
    orderBy: { addedAt: "desc" },
  });
}

export async function addToWishlist(userId: string, componentId: string): Promise<WishlistItemWithComponent> {
  const component = await prisma.component.findUnique({
    where: { id: componentId },
    select: { id: true, isActive: true },
  });
  if (!component || !component.isActive) {
    throw Object.assign(new Error("Component not found"), { statusCode: 404 });
  }

  return prisma.wishlistItem.upsert({
    where: { userId_componentId: { userId, componentId } },
    create: { userId, componentId },
    update: {},
    include: {
      component: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          unitPriceCents: true,
          stockQuantity: true,
          isActive: true,
          sku: true,
        },
      },
    },
  });
}

export async function removeFromWishlist(userId: string, componentId: string): Promise<void> {
  await prisma.wishlistItem.deleteMany({ where: { userId, componentId } });
}

export async function clearWishlist(userId: string): Promise<void> {
  await prisma.wishlistItem.deleteMany({ where: { userId } });
}

export async function isInWishlist(userId: string, componentId: string): Promise<boolean> {
  const item = await prisma.wishlistItem.findUnique({
    where: { userId_componentId: { userId, componentId } },
    select: { id: true },
  });
  return item !== null;
}
