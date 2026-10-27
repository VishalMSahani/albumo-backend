import { lockCart } from "../../checkout/cart.service.js";
import { prisma } from "../../../lib/prisma.js";
import type {
  Cart,
  CartItem,
  Component,
} from "../../../generated/prisma/client.js";

export type CartItemWithComponent = CartItem & {
  component: Pick<
    Component,
    | "id"
    | "name"
    | "imageUrl"
    | "unitPriceCents"
    | "stockQuantity"
    | "isActive"
    | "sku"
  >;
};

export type CartWithItems = Cart & { items: CartItemWithComponent[] };

async function getOrCreateCart(userId: string): Promise<Cart> {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
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
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
    throw Object.assign(new Error("Quantity must be at least 1"), {
      statusCode: 400,
    });

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

  await prisma.$transaction(async (tx) => {
    await lockCart(tx, cart.id);
    await tx.cartItem.upsert({
      where: { cartId_componentId: { cartId: cart.id, componentId } },
      create: { cartId: cart.id, componentId, quantity },
      update: { quantity },
    });
    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
  });

  return getCart(userId);
}

export async function removeCartItem(
  userId: string,
  componentId: string,
): Promise<CartWithItems> {
  const cart = await getOrCreateCart(userId);
  await prisma.$transaction(async (tx) => {
    await lockCart(tx, cart.id);
    await tx.cartItem.deleteMany({ where: { cartId: cart.id, componentId } });
    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
  });
  return getCart(userId);
}
export async function clearCart(userId: string): Promise<void> {
  const cart = await getOrCreateCart(userId);
  await prisma.$transaction(async (tx) => {
    await lockCart(tx, cart.id);
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.studioCartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
  });
}
export async function syncCart(
  userId: string,
  items: Array<{ componentId: string; quantity: number }>,
): Promise<CartWithItems> {
  if (
    items.length > 100 ||
    items.some(
      (i) =>
        !i ||
        typeof i.componentId !== "string" ||
        !Number.isInteger(i.quantity) ||
        i.quantity < 1 ||
        i.quantity > 100,
    )
  )
    throw Object.assign(new Error("Invalid cart quantities"), {
      statusCode: 400,
    });
  const cart = await getOrCreateCart(userId);
  await prisma.$transaction(async (tx) => {
    await lockCart(tx, cart.id);
    const components = await tx.component.findMany({
      where: { id: { in: items.map((i) => i.componentId) }, isActive: true },
    });
    const unique = [...new Map(items.map((i) => [i.componentId, i])).values()];
    const valid = unique.filter((i) =>
      components.some(
        (c) => c.id === i.componentId && c.stockQuantity >= i.quantity,
      ),
    );
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    if (valid.length)
      await tx.cartItem.createMany({
        data: valid.map((i) => ({ ...i, cartId: cart.id })),
      });
    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
  });
  return getCart(userId);
}
