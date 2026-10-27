import { printReport } from "../studio/print-quality.js";
import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { configurationSchema } from "../components/validators/catalogue.js";
import { resolveConfiguration } from "../studio/configuration.js";
import { documentSchema } from "../studio/design.js";
import { lockProject } from "../studio/collection.js";
import { StudioProjectError } from "../studio/error.js";
import { sellingPrice } from "../../utils/product-price.js";
import { privateDownloadUrl } from "../../services/r2-storage.service.js";
import {
  calculateDeliveryFee,
  getDeliverySettings,
} from "../settings/services/store-settings.service.js";
import { LEGAL_POLICY_VERSION } from "../legal/legal.constants.js";

export type Db = Prisma.TransactionClient;
export const fail = (status: number, code: string, message: string): never => {
  throw new StudioProjectError(status, code, message);
};
export function stableHash(value: unknown): string {
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : item;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export type AlbumSnapshot = {
  proof?: Prisma.JsonValue;
  title: string;
  configuration: ReturnType<typeof resolveConfiguration>;
  document: ReturnType<typeof documentSchema.parse>;
};
export async function ensureCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  });
}
export async function lockCart(tx: Db, cartId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "id" = ${cartId} FOR UPDATE`;
}
export async function validateSnapshot(
  tx: Db,
  projectId: string,
  snapshot: AlbumSnapshot,
  selected: boolean,
) {
  const parsed = documentSchema.safeParse(snapshot.document);
  if (
    !parsed.success ||
    parsed.data.pages.length !== snapshot.configuration.pageCount
  )
    return fail(
      409,
      "DESIGN_INCOMPLETE",
      "Save an album with the correct number of pages before adding it to your cart.",
    );
  const doc = parsed.data;
  if (
    !doc.cover.photo ||
    doc.pages.some((p) => p.photos.length !== (p.layout === "duo" ? 2 : 1)) ||
    new Set(doc.pages.map((p) => p.id)).size !== doc.pages.length
  )
    return fail(
      409,
      "DESIGN_INCOMPLETE",
      "Add a photo to the cover and every page before adding this album to your cart.",
    );
  const photos = await tx.studioAsset.findMany({
    where: {
      projectId,
      status: "READY",
      ...(selected ? { selected: true } : {}),
    },
    select: { id: true, originalKey: true },
  });
  const allowed = new Set(photos.filter((p) => p.originalKey).map((p) => p.id));
  if (
    (selected && allowed.size < snapshot.configuration.minimumPhotos) ||
    [doc.cover.photo, ...doc.pages.flatMap((p) => p.photos)].some(
      (p) => !allowed.has(p.assetId),
    )
  )
    return fail(
      409,
      "PHOTOS_UNAVAILABLE",
      "Some album photos are not ready. Return to Studio and check your photo collection.",
    );
  const quality = await printReport(tx, projectId, snapshot.document, snapshot.configuration);
  if (quality.profile) {
    const proof = snapshot.proof as { reportHash?: string } | undefined;
    if (!quality.canApprove || proof?.reportHash !== quality.reportHash) return fail(409, 'PRINT_PROOF_REQUIRED', 'Review and approve the latest print checks in Studio, then add this album again.');
  }

}
export function albumPrice(
  product: {
    id: string;
    name: string;
    configuration: unknown;
    unitPriceCents: number;
    discountedPriceCents: number | null;
  },
  snapshot: AlbumSnapshot,
) {
  const saved = snapshot.configuration;
  const fresh = resolveConfiguration(product, {
    productId: product.id,
    choices: Object.fromEntries(
      saved.options.map((o) => [o.groupId, o.choiceId]),
    ),
    quantity: saved.quantity,
    personalText: saved.personalText,
  });
  // Price changes may be quoted again, but never silently substitute a different physical configuration.
  if (fresh.options.length !== saved.options.length)
    return fail(
      409,
      "CONFIGURATION_CHANGED",
      "Album options have changed. Contact Albumo before ordering this design.",
    );
  for (const option of fresh.options) {
    const old = saved.options.find((o) => o.groupId === option.groupId);
    if (
      !old ||
      stableHash({ ...old, label: "" }) !== stableHash({ ...option, label: "" })
    )
      return fail(
        409,
        "CONFIGURATION_CHANGED",
        "An album option has changed. Contact Albumo before ordering this design.",
      );
  }
  const config = configurationSchema.parse(product.configuration);
  const adjustments = saved.options.reduce(
    (sum, option) =>
      sum +
      (config.groups
        .find((g) => g.id === option.groupId)
        ?.options.find((o) => o.id === option.choiceId)?.priceAdjustmentCents ??
        0),
    0,
  );
  return sellingPrice(product) + adjustments;
}
export async function addAlbumToCart(
  userId: string,
  projectId: string,
  baseRevision: number,
) {
  const cart = await ensureCart(userId);
  return prisma.$transaction(async (tx) => {
    await lockCart(tx, cart.id);
    await lockProject(tx, projectId);
    const project = await tx.studioProject.findFirst({
      where: { id: projectId, ownerId: userId, archivedAt: null, trashedAt: null, deletedAt: null },
    });
    if (!project)
      return fail(404, "ALBUM_UNAVAILABLE", "This album is unavailable.");
    if (project.revision !== baseRevision)
      return fail(
        409,
        "STUDIO_REVISION_CONFLICT",
        "The album changed. Save and review the latest version before adding it to your cart.",
      );
    if (!project.productId || !project.configuration || !project.document)
      return fail(
        409,
        "DESIGN_REQUIRED",
        "Save your configured album design first.",
      );
    const product = await tx.component.findUnique({
      where: { id: project.productId },
    });
    if (!product?.isActive)
      return fail(
        409,
        "PRODUCT_UNAVAILABLE",
        "This album product is currently unavailable.",
      );
    const snapshot: AlbumSnapshot = {
      ...((project.proof as { revision?: number } | null)?.revision === project.revision ? { proof: project.proof! } : {}),
      title: project.title,
      configuration:
        project.configuration as unknown as AlbumSnapshot["configuration"],
      document: documentSchema.parse(project.document),
    };
    await validateSnapshot(tx, projectId, snapshot, true);
    albumPrice(product, snapshot);
    const quantity = snapshot.configuration.quantity;
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100 ||
      product.stockQuantity < quantity
    )
      return fail(
        409,
        "INSUFFICIENT_STOCK",
        "The requested number of albums is not available.",
      );
    const existing = await tx.studioCartItem.findUnique({
      where: { cartId_projectId: { cartId: cart.id, projectId } },
    });
    if (
      !existing &&
      (await tx.studioCartItem.count({ where: { cartId: cart.id } })) >= 50
    )
      return fail(
        409,
        "CART_FULL",
        "Your cart can hold up to 50 album designs.",
      );
    // A double click/replayed response does not duplicate the album or reset cart quantity.
    if (existing?.revision === project.revision && stableHash(existing.snapshot) === stableHash(snapshot))
      return { cartItemId: existing.id, revision: existing.revision };
    const item = await tx.studioCartItem.upsert({
      where: { cartId_projectId: { cartId: cart.id, projectId } },
      create: {
        cartId: cart.id,
        projectId,
        productId: product.id,
        revision: project.revision,
        quantity,
        snapshot,
      },
      update: {
        revision: project.revision,
        quantity,
        snapshot,
        version: { increment: 1 },
      },
      select: { id: true, revision: true },
    });
    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
    return { cartItemId: item.id, revision: item.revision };
  });
}
export async function changeAlbumQuantity(
  userId: string,
  id: string,
  version: number,
  quantity: number | null,
) {
  const cart = await ensureCart(userId);
  return prisma.$transaction(async (tx) => {
    await lockCart(tx, cart.id);
    const item = await tx.studioCartItem.findFirst({
      where: { id, cartId: cart.id, version },
      include: { product: { select: { stockQuantity: true, isActive: true } } },
    });
    if (!item)
      return fail(
        409,
        "CART_CHANGED",
        "Your cart changed. Refresh it before trying again.",
      );
    if (quantity !== null) {
      if (!item.product.isActive || quantity > item.product.stockQuantity)
        return fail(
          409,
          "INSUFFICIENT_STOCK",
          "This quantity is not available.",
        );
      await tx.studioCartItem.update({
        where: { id },
        data: { quantity, version: { increment: 1 } },
      });
    } else await tx.studioCartItem.delete({ where: { id } });
    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
    return { updated: true };
  });
}
export type CheckoutLine = {
  id: string;
  kind: "album" | "product";
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  version: number;
  projectId: string | null;
  revision: number | null;
  albumTitle: string | null;
  options: { label: string; value: string }[];
  coverAssetId: string | null;
  imageUrl: string | null;
  issues: string[];
};
export async function cartQuote(
  tx: Db,
  userId: string,
  cartId: string,
  couponCode: string,
  delivery: Awaited<ReturnType<typeof getDeliverySettings>>,
) {
  const [albums, products] = await Promise.all([
    tx.studioCartItem.findMany({
      where: { cartId },
      include: {
        product: true,
        project: { select: { ownerId: true, archivedAt: true, trashedAt: true, deletedAt: true } },
      },
      orderBy: { addedAt: "asc" },
    }),
    tx.cartItem.findMany({
      where: { cartId },
      include: { component: true },
      orderBy: { addedAt: "asc" },
    }),
  ]);
  const lines: CheckoutLine[] = [];
  for (const item of albums) {
    const snapshot = item.snapshot as unknown as AlbumSnapshot;
    const issues: string[] = [];
    let price = 0;
    if (item.project.ownerId !== userId || item.project.archivedAt || item.project.trashedAt || item.project.deletedAt)
      issues.push("Restore this album in Studio before ordering.");
    if (!item.product.isActive) issues.push("This product is unavailable.");
    try {
      price = albumPrice(item.product, snapshot);
      await validateSnapshot(tx, item.projectId, snapshot, false);
    } catch (error) {
      if (error instanceof StudioProjectError) issues.push(error.message);
      else throw error;
    }
    lines.push({
      id: item.id,
      kind: "album",
      productId: item.productId,
      name: item.product.name,
      quantity: item.quantity,
      unitPriceCents: price,
      totalCents: price * item.quantity,
      version: item.version,
      projectId: item.projectId,
      revision: item.revision,
      albumTitle: snapshot.title,
      options: snapshot.configuration.options.map((o) => ({
        label: o.label,
        value: o.value,
      })),
      coverAssetId: snapshot.document.cover.photo?.assetId ?? null,
      imageUrl: null,
      issues,
    });
  }
  for (const item of products) {
    const price = sellingPrice(item.component);
    lines.push({
      id: item.id,
      kind: "product",
      productId: item.componentId,
      name: item.component.name,
      quantity: item.quantity,
      unitPriceCents: price,
      totalCents: price * item.quantity,
      version: 0,
      projectId: null,
      revision: null,
      albumTitle: null,
      options: [],
      coverAssetId: null,
      imageUrl: item.component.imageUrl,
      issues: item.component.isActive ? [] : ["This product is unavailable."],
    });
  }
  const quantities = new Map<string, number>();
  for (const line of lines)
    quantities.set(
      line.productId,
      (quantities.get(line.productId) ?? 0) + line.quantity,
    );
  for (const line of lines) {
    const product =
      albums.find((a) => a.productId === line.productId)?.product ??
      products.find((p) => p.componentId === line.productId)!.component;
    if (quantities.get(line.productId)! > product.stockQuantity)
      line.issues.push(
        `Only ${product.stockQuantity} copies of this product are available across your cart.`,
      );
  }
  const subtotalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  const shippingCents = lines.length
    ? calculateDeliveryFee(subtotalCents, delivery)
    : 0;
  let discountCents = 0,
    couponId: string | null = null,
    couponLabel: string | null = null;
  if (couponCode) {
    const coupon = await tx.coupon.findUnique({
      where: { code: couponCode.trim().toUpperCase() },
    });
    if (
      !coupon ||
      !coupon.isActive ||
      (coupon.expiresAt && coupon.expiresAt <= new Date()) ||
      (coupon.maxUsageCount !== null &&
        coupon.usageCount >= coupon.maxUsageCount)
    )
      return fail(
        422,
        "COUPON_UNAVAILABLE",
        "This coupon is unavailable or has expired.",
      );
    if (
      coupon.maxUsageCount !== null &&
      (await tx.order.count({
        where: {
          couponId: coupon.id,
          status: { notIn: ["CANCELLED", "REFUNDED"] },
        },
      })) >= coupon.maxUsageCount
    )
      return fail(
        422,
        "COUPON_LIMIT",
        "This coupon has reached its usage limit.",
      );
    if (subtotalCents < coupon.minOrderCents)
      return fail(
        422,
        "COUPON_MINIMUM",
        "The cart does not meet this coupon’s minimum order value.",
      );
    if (coupon.allowedEmail) {
      const owner = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (owner?.email.toLowerCase() !== coupon.allowedEmail.toLowerCase())
        return fail(
          422,
          "COUPON_UNAVAILABLE",
          "This coupon is not available for your account.",
        );
    }
    if (
      coupon.perUserLimit !== null &&
      (await tx.order.count({
        where: {
          userId,
          couponId: coupon.id,
          status: { notIn: ["CANCELLED", "REFUNDED"] },
        },
      })) >= coupon.perUserLimit
    )
      return fail(
        422,
        "COUPON_LIMIT",
        "You have reached this coupon’s usage limit.",
      );
    discountCents =
      coupon.discountType === "FREE_SHIPPING"
        ? shippingCents
        : Math.min(
            subtotalCents,
            coupon.discountType === "PERCENTAGE"
              ? Math.round((subtotalCents * coupon.discountValue) / 100)
              : coupon.discountValue,
          );
    couponId = coupon.id;
    couponLabel = coupon.label;
  }
  const totalCents = subtotalCents + shippingCents - discountCents;
  if (
    !Number.isSafeInteger(totalCents) ||
    totalCents < 0 ||
    totalCents > 100000000
  )
    return fail(
      422,
      "ORDER_LIMIT",
      "Please contact Albumo for an order of this size.",
    );
  const totals = { subtotalCents, shippingCents, discountCents, totalCents };
  const hash = stableHash({
    userId,
    cartId,
    lines,
    totals,
    couponCode: couponCode.toUpperCase(),
    policyVersion: LEGAL_POLICY_VERSION,
  });
  return {
    lines,
    ...totals,
    quoteHash: hash,
    couponId,
    couponLabel,
    policyVersion: LEGAL_POLICY_VERSION,
    albums,
    products,
  };
}
export async function getCheckoutCart(userId: string, couponCode = "") {
  const cart = await ensureCart(userId);
  const delivery = await getDeliverySettings();
  const {
    albums: _albums,
    products: _products,
    couponId: _couponId,
    ...quote
  } = await cartQuote(prisma, userId, cart.id, couponCode, delivery);
  return {
    ...quote,
    lines: await Promise.all(
      quote.lines.map(async (line) => {
        if (!line.projectId || !line.coverAssetId) return line;
        const photo = await prisma.studioAsset.findFirst({
          where: {
            id: line.coverAssetId,
            projectId: line.projectId,
            status: "READY",
          },
          select: { previewKey: true },
        });
        return {
          ...line,
          imageUrl: photo?.previewKey
            ? await privateDownloadUrl(photo.previewKey, "album-cover.webp")
            : null,
        };
      }),
    ),
  };
}
