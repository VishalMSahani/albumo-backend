import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { getDeliverySettings } from "../settings/services/store-settings.service.js";
import {
  recordCheckoutAcceptance,
  validateLegalAcceptance,
  type ConsentAuditContext,
} from "../legal/legal.service.js";
import {
  cartQuote,
  ensureCart,
  lockCart,
  stableHash,
  fail,
  type AlbumSnapshot,
} from "./cart.service.js";
import { addressSchema, type CheckoutInput } from "./checkout.schema.js";
import { privateDownloadUrl } from "../../services/r2-storage.service.js";

export async function createCheckoutOrder(
  userId: string,
  input: CheckoutInput,
  audit: ConsentAuditContext,
) {
  validateLegalAcceptance(input.legalConsent);
  const requestHash = stableHash(input);
  const cart = await ensureCart(userId);
  const delivery = await getDeliverySettings();
  return prisma.$transaction(
    async (tx) => {
      await lockCart(tx, cart.id);
      const previous = await tx.checkoutAttempt.findUnique({
        where: { userId_requestId: { userId, requestId: input.requestId } },
      });
      if (previous) {
        if (previous.requestHash !== requestHash)
          return fail(
            409,
            "CHECKOUT_REQUEST_REUSED",
            "This checkout request was already used. Open your existing order before starting again.",
          );
        return { orderId: previous.orderId };
      }
      if (input.couponCode)
        await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "code" = ${input.couponCode.toUpperCase()} FOR UPDATE`;
      const quote = await cartQuote(
        tx,
        userId,
        cart.id,
        input.couponCode,
        delivery,
      );
      if (!quote.lines.length)
        return fail(409, "CART_EMPTY", "Your cart is empty.");
      if (quote.lines.length > 100)
        return fail(
          422,
          "CART_LIMIT",
          "Please checkout no more than 100 items at a time.",
        );
      if (quote.lines.some((l) => l.issues.length))
        return fail(
          409,
          "CART_UNAVAILABLE",
          "Some items need attention. Return to your cart before checking out.",
        );
      if (quote.quoteHash !== input.quoteHash)
        return fail(
          409,
          "QUOTE_CHANGED",
          "Your cart or its prices changed. Review the updated total before placing your order.",
        );
      const quantities = new Map<string, number>();
      for (const line of quote.lines)
        quantities.set(
          line.productId,
          (quantities.get(line.productId) ?? 0) + line.quantity,
        );
      // Deterministic lock order and compare-and-set stock prevent concurrent overselling.
      for (const [productId, quantity] of [...quantities].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const product =
          quote.albums.find((a) => a.productId === productId)?.product ??
          quote.products.find((p) => p.componentId === productId)!.component;
        const reserved = await tx.component.updateMany({
          where: {
            id: productId,
            isActive: true,
            stockQuantity: { gte: quantity },
            updatedAt: product.updatedAt,
          },
          data: { stockQuantity: { decrement: quantity } },
        });
        if (!reserved.count)
          return fail(
            409,
            "STOCK_CHANGED",
            "Availability changed. Refresh your cart and try again.",
          );
      }
      let shipping = input.shippingAddress;
      if (input.shippingAddressId) {
        const address = await tx.address.findFirst({
          where: { id: input.shippingAddressId, userId },
        });
        if (!address)
          return fail(
            404,
            "ADDRESS_UNAVAILABLE",
            "Choose an address from your account.",
          );
        const valid = addressSchema.safeParse({
          name: address.name,
          phone: address.phone.replace(/[\s-]/g, ""),
          line1: address.line1,
          line2: address.line2 ?? "",
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          country: address.country,
        });
        if (!valid.success)
          return fail(
            422,
            "ADDRESS_INVALID",
            "Update this address with a valid Indian mobile number and delivery address.",
          );
        shipping = valid.data;
      }
      if (!shipping)
        return fail(422, "ADDRESS_REQUIRED", "Choose a delivery address.");
      // A separate address record prevents later address-book edits from changing this order.
      const address = await tx.address.create({
        data: { ...shipping, userId, isDefault: false },
      });
      const order = await tx.order.create({
        data: {
          userId,
          addressId: address.id,
          orderType: "COMPONENTS_ONLY",
          status: quote.totalCents === 0 ? "PAID" : "PENDING_PAYMENT",
          totalAmountCents: quote.totalCents,
          couponId: quote.couponId,
          notes: "Albumo storefront checkout",
          payments: {
            create: {
              gateway: "ZOHO",
              status: quote.totalCents === 0 ? "SUCCESS" : "CREATED",
              amountCents: quote.totalCents,
              rawPayload: {
                subtotalCents: quote.subtotalCents,
                shippingCents: quote.shippingCents,
                discountCents: quote.discountCents,
                mode: quote.totalCents === 0 ? "zero_total" : "gateway_pending",
              },
            },
          },
        },
        select: { id: true },
      });
      for (const line of quote.lines) {
        const item = await tx.orderItem.create({
          data: {
            orderId: order.id,
            itemType: "COMPONENT",
            componentId: line.productId,
            description: line.albumTitle
              ? `${line.name} - ${line.albumTitle}`
              : line.name,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            subtotalCents: line.totalCents,
          },
          select: { id: true },
        });
        if (line.kind === "album") {
          const saved = quote.albums.find((a) => a.id === line.id)!;
          const snapshot = saved.snapshot as unknown as AlbumSnapshot;
          await tx.studioOrderLink.create({
            data: {
              projectId: saved.projectId,
              orderItemId: item.id,
              revision: saved.revision,
              actorId: userId,
              snapshot: {
                ...snapshot,
                configuration: {
                  ...snapshot.configuration,
                  quantity: line.quantity,
                },
                purpose: "CUSTOMER_CHECKOUT",
                printApproved: false,
                customerDesignAcceptedAt: new Date().toISOString(),
                sourceCartVersion: saved.version,
              },
            },
          });
        }
      }
      await recordCheckoutAcceptance({
        userId,
        orderId: order.id,
        source: "CHECKOUT",
        payload: input.legalConsent,
        audit,
        client: tx,
      });
      await tx.checkoutAttempt.create({
        data: {
          userId,
          requestId: input.requestId,
          requestHash,
          orderId: order.id,
          summary: {
            subtotalCents: quote.subtotalCents,
            shippingCents: quote.shippingCents,
            discountCents: quote.discountCents,
            totalCents: quote.totalCents,
            couponCode: input.couponCode.toUpperCase(),
            designAccepted: true,
          },
        },
      });
      await tx.studioCartItem.deleteMany({
        where: { cartId: cart.id, id: { in: quote.albums.map((a) => a.id) } },
      });
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id, id: { in: quote.products.map((p) => p.id) } },
      });
      await tx.cart.update({
        where: { id: cart.id },
        data: { updatedAt: new Date() },
      });
      return { orderId: order.id };
    },
    { timeout: 20000 },
  );
}
export async function checkoutAttempt(userId: string, requestId: string) {
  const attempt = await prisma.checkoutAttempt.findUnique({
    where: { userId_requestId: { userId, requestId } },
    select: { orderId: true },
  });
  if (!attempt)
    return fail(
      404,
      "CHECKOUT_NOT_FOUND",
      "No order was created for this checkout request.",
    );
  return attempt;
}
export async function checkoutOrder(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      totalAmountCents: true,
      trackingAwb: true,
      trackingUrl: true,
      address: {
        select: {
          name: true,
          phone: true,
          line1: true,
          line2: true,
          city: true,
          state: true,
          pincode: true,
          country: true,
        },
      },
      payments: {
        select: { id: true, gateway: true, status: true, amountCents: true },
        orderBy: { createdAt: "desc" },
      },
      checkoutAttempt: { select: { summary: true } },
      items: {
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPriceCents: true,
          subtotalCents: true,
          studioAlbum: {
            select: { projectId: true, revision: true, snapshot: true },
          },
        },
      },
    },
  });
  if (!order)
    return fail(404, "ORDER_NOT_FOUND", "Order not found in your account.");
  return {
    ...order,
    items: order.items.map(({ studioAlbum, ...item }) => ({
      ...item,
      album: studioAlbum
        ? {
            projectId: studioAlbum.projectId,
            revision: studioAlbum.revision,
            title: (studioAlbum.snapshot as unknown as AlbumSnapshot).title,
            options: (
              studioAlbum.snapshot as unknown as AlbumSnapshot
            ).configuration.options.map((o) => ({
              label: o.label,
              value: o.value,
            })),
          }
        : null,
    })),
  };
}
export async function savedCartDesign(userId: string, id: string) {
  const item = await prisma.studioCartItem.findFirst({
    where: { id, cart: { userId } },
    select: { snapshot: true, revision: true, projectId: true },
  });
  if (!item)
    return fail(404, "CART_ITEM_NOT_FOUND", "Album not found in your cart.");
  return snapshotPreview(item.snapshot, item.projectId, item.revision);
}
export async function savedOrderDesign(
  userId: string,
  orderId: string,
  itemId: string,
) {
  const link = await prisma.studioOrderLink.findFirst({
    where: { orderItemId: itemId, orderItem: { orderId, order: { userId } } },
  });
  if (!link)
    return fail(404, "ORDER_NOT_FOUND", "Album not found in your order.");
  return snapshotPreview(link.snapshot, link.projectId, link.revision);
}
async function snapshotPreview(
  value: Prisma.JsonValue,
  projectId: string,
  revision: number,
) {
  const snapshot = value as unknown as AlbumSnapshot;
  const ids = [
    ...new Set(
      [
        snapshot.document.cover.photo,
        ...snapshot.document.pages.flatMap((p) => p.photos),
      ].flatMap((p) => (p ? [p.assetId] : [])),
    ),
  ];
  const photos = await prisma.studioAsset.findMany({
    where: { projectId, id: { in: ids }, status: "READY" },
    select: { id: true, previewKey: true },
  });
  return {
    ...snapshot,
    revision,
    photos: await Promise.all(
      photos.map(async (p) => ({
        id: p.id,
        previewUrl: p.previewKey
          ? await privateDownloadUrl(p.previewKey, "photo.webp")
          : null,
      })),
    ),
  };
}
