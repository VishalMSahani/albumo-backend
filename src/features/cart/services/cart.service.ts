import { prisma } from "../../../lib/prisma.js";
import type { Cart, CartItem, Component } from "../../../generated/prisma/client.js";

export type CartItemWithComponent = CartItem & {
  component: Pick<Component, "id" | "name" | "imageUrl" | "unitPriceCents" | "stockQuantity" | "isActive" | "sku">;
};

export type CartWithItems = Cart & { items: CartItemWithComponent[] };

async function getOrCreateCart(userId: string): Promise<Cart> {
  const existing = await prisma.cart.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId } });
}

export async function getCart(userId: string): Promise<CartWithItems> {
  const cart = await getOrCreateCart(userId);
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
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
    orderBy: { addedAt: "asc" },
  });
  return { ...cart, items };
}

export async function upsertCartItem(
  userId: string,
  componentId: string,
  quantity: number,
): Promise<CartWithItems> {
  if (quantity < 1) throw Object.assign(new Error("Quantity must be at least 1"), { statusCode: 400 });

  const component = await prisma.component.findUnique({
    where: { id: componentId },
    select: { id: true, stockQuantity: true, isActive: true },
  });
  if (!component || !component.isActive) {
    throw Object.assign(new Error("Component not found"), { statusCode: 404 });
  }
  if (component.stockQuantity < quantity) {
    throw Object.assign(
      new Error(`Only ${component.stockQuantity} unit(s) available`),
      { statusCode: 409 },
    );
  }

  const cart = await getOrCreateCart(userId);

  await prisma.$transaction([
    prisma.cartItem.upsert({
      where: { cartId_componentId: { cartId: cart.id, componentId } },
      create: { cartId: cart.id, componentId, quantity },
      update: { quantity },
    }),
    prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } }),
  ]);

  return getCart(userId);
}

export async function removeCartItem(userId: string, componentId: string): Promise<CartWithItems> {
  const cart = await prisma.cart.findUnique({ where: { userId } });
  if (cart) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, componentId } });
    await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
  }
  return getCart(userId);
}

export async function clearCart(userId: string): Promise<void> {
  const cart = await prisma.cart.findUnique({ where: { userId } });
  if (cart) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
  }
}

export async function syncCart(
  userId: string,
  items: Array<{ componentId: string; quantity: number }>,
): Promise<CartWithItems> {
  const cart = await getOrCreateCart(userId);

  if (items.length === 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    return getCart(userId);
  }

  const componentIds = items.map((i) => i.componentId);
  const components = await prisma.component.findMany({
    where: { id: { in: componentIds }, isActive: true },
    select: { id: true, stockQuantity: true },
  });
  const componentMap = new Map(components.map((c) => [c.id, c]));

  const validItems = items
    .filter((i) => {
      const c = componentMap.get(i.componentId);
      return c && i.quantity >= 1 && c.stockQuantity >= i.quantity;
    })
    .map((i) => {
      const c = componentMap.get(i.componentId)!;
      return { componentId: i.componentId, quantity: Math.min(i.quantity, c.stockQuantity) };
    });

  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { cartId: cart.id } }),
    ...validItems.map((item) =>
      prisma.cartItem.create({ data: { cartId: cart.id, ...item } }),
    ),
    prisma.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } }),
  ]);

  return getCart(userId);
}
