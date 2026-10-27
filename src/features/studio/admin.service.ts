import { printReport } from './print-quality.js';
import { protectPhotoSelection } from "./photo-selection.js";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { privateDownloadUrl } from "../../services/r2-storage.service.js";
import { lockProject } from "./collection.js";
import { documentSchema } from "./design.js";
import { StudioProjectError } from "./error.js";

export const reviewStatus = z.enum([
  "UNREVIEWED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "REVIEWED",
]);
export const cursorSchema = z.object({ after: z.uuid().optional() }).strict();
export const listSchema = z
  .object({
    search: z.string().trim().max(120).default(""),
    archived: z.enum(["active", "archived", "all"]).default("active"),
    review: reviewStatus.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const fail = (status: number, code: string, message: string): never => {
  throw new StudioProjectError(status, code, message);
};
const summary = {
  id: true,
  title: true,
  occasion: true,
  revision: true,
  archivedAt: true,
  trashedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  productId: true,
  pageCount: true,
  minimumPhotos: true,
  recommendedPhotos: true,
  reviewStatus: true,
  reviewRevision: true,
  reviewNote: true,
  reviewedAt: true,
  owner: { select: { id: true, name: true, email: true } },
  _count: { select: { assets: true, orderLinks: true } },
} satisfies Prisma.StudioProjectSelect;
async function project(id: string) {
  const row = await prisma.studioProject.findUnique({ where: { id } });
  if (!row) return fail(404, "STUDIO_PROJECT_NOT_FOUND", "Album not found.");
  return row;
}
export async function listAlbums(input: z.infer<typeof listSchema>) {
  const where: Prisma.StudioProjectWhereInput = {
    ...(input.archived === "all"
      ? {}
      : {
          trashedAt: null,
          deletedAt: null,
          archivedAt: input.archived === "archived" ? { not: null } : null,
        }),
    ...(input.review ? { reviewStatus: input.review } : {}),
    ...(input.search
      ? {
          OR: [
            { title: { contains: input.search, mode: "insensitive" } },
            {
              owner: { email: { contains: input.search, mode: "insensitive" } },
            },
            {
              owner: { name: { contains: input.search, mode: "insensitive" } },
            },
            ...(z.uuid().safeParse(input.search).success
              ? [{ id: input.search }]
              : []),
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.studioProject.findMany({
      where,
      select: summary,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.studioProject.count({ where }),
  ]);
  return {
    items,
    total,
    page: input.page,
    totalPages: Math.ceil(total / input.limit),
  };
}
export async function albumDetail(id: string) {
  const row = await prisma.studioProject.findUnique({
    where: { id },
    select: {
      ...summary,
      configuration: true,
      orderLinks: {
        select: {
          id: true,
          orderItemId: true,
          revision: true,
          createdAt: true,
          orderItem: {
            select: {
              orderId: true,
              description: true,
              quantity: true,
              order: { select: { status: true } },
            },
          },
        },
      },
    },
  });
  if (!row) return fail(404, "STUDIO_PROJECT_NOT_FOUND", "Album not found.");
  const [counts, activeInvites] = await Promise.all([
    prisma.studioAsset.groupBy({
      by: ["status", "selected"],
      where: { projectId: id },
      _count: true,
    }),
    prisma.studioInvite.count({
      where: { projectId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);
  return {
    ...row,
    counts,
    activeInvites,
    reviewCurrent: row.reviewRevision === row.revision,
  };
}
export async function albumPhotos(id: string, after?: string) {
  await project(id);
  if (
    after &&
    !(await prisma.studioAsset.findFirst({
      where: { id: after, projectId: id },
    }))
  )
    return fail(
      404,
      "PHOTO_NOT_FOUND",
      "Photo cursor not found in this album.",
    );
  const rows = await prisma.studioAsset.findMany({
    where: { projectId: id },
    take: 41,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    select: {
      id: true,
      filename: true,
      status: true,
      selected: true,
      width: true,
      height: true,
      byteSize: true,
      attempts: true,
      errorCode: true,
      createdAt: true,
      previewKey: true,
      guest: { select: { displayName: true } },
    },
  });
  return {
    nextCursor: rows.length > 40 ? rows[39]!.id : null,
    items: await Promise.all(
      rows.slice(0, 40).map(async ({ previewKey, guest, ...row }) => ({
        ...row,
        contributor: guest?.displayName || "Album owner",
        previewUrl:
          row.status === "READY" && previewKey
            ? await privateDownloadUrl(previewKey, "photo.webp")
            : null,
      })),
    ),
  };
}
export async function albumActivity(id: string, after?: string) {
  await project(id);
  if (
    after &&
    !(await prisma.studioActivity.findFirst({
      where: { id: after, projectId: id },
    }))
  )
    return fail(
      404,
      "ACTIVITY_NOT_FOUND",
      "Activity cursor not found in this album.",
    );
  const rows = await prisma.studioActivity.findMany({
    where: { projectId: id },
    take: 41,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  });
  return {
    items: rows.slice(0, 40),
    nextCursor: rows.length > 40 ? rows[39]!.id : null,
  };
}
async function previews(id: string, document: unknown) {
  const parsed = documentSchema.safeParse(document);
  if (!parsed.success) return [];
  const ids = [
    ...new Set([
      ...(parsed.data.cover.photo ? [parsed.data.cover.photo.assetId] : []),
      ...parsed.data.pages.flatMap((p) =>
        p.photos.map((photo) => photo.assetId),
      ),
    ]),
  ];
  const rows = await prisma.studioAsset.findMany({
    where: { projectId: id, id: { in: ids }, status: "READY" },
    select: { id: true, previewKey: true },
  });
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      previewUrl: row.previewKey
        ? await privateDownloadUrl(row.previewKey, "photo.webp")
        : null,
    })),
  );
}
export async function albumDesign(id: string) {
  const row = await project(id);
  return {
    quality: await printReport(prisma, id, row.document, row.configuration),
    document: row.document,
    revision: row.revision,
    photos: await previews(id, row.document),
  };
}
export async function orderSnapshot(id: string, linkId: string) {
  const link = await prisma.studioOrderLink.findFirst({
    where: { id: linkId, projectId: id },
  });
  if (!link) return fail(404, "LINK_NOT_FOUND", "Order attachment not found.");
  const snapshot = link.snapshot as {
    document: Prisma.JsonValue;
    configuration: Prisma.JsonValue;
    title: string;
  };
  const quality = await printReport(prisma, id, snapshot.document, snapshot.configuration);
  const approval = link.printApproval as { reportHash?: string } | null;
  return {
    ...snapshot,
    quality,
    printApproval: link.printApproval,
    printApprovalCurrent: approval?.reportHash === quality.reportHash && !!quality.profile && quality.canApprove,
    revision: link.revision,
    photos: await previews(id, snapshot.document),
  };
}
async function checkDesign(
  tx: Prisma.TransactionClient,
  row: Awaited<ReturnType<typeof project>>,
) {
  const parsed = documentSchema.safeParse(row.document);
  if (
    !parsed.success ||
    !row.configuration ||
    parsed.data.pages.length !== row.pageCount
  )
    return fail(
      409,
      "DESIGN_REQUIRED",
      "A saved design matching the album configuration is required.",
    );
  const doc = parsed.data;
  const assets = await tx.studioAsset.findMany({
    where: { projectId: row.id, status: "READY", selected: true },
    select: { id: true },
  });
  const allowed = new Set(assets.map((a) => a.id));
  if (
    !row.minimumPhotos ||
    assets.length < row.minimumPhotos ||
    !doc.cover.photo ||
    doc.pages.some((p) => p.photos.length !== (p.layout === "duo" ? 2 : 1)) ||
    [doc.cover.photo, ...doc.pages.flatMap((p) => p.photos)].some(
      (p) => !allowed.has(p.assetId),
    )
  )
    return fail(
      409,
      "DESIGN_INCOMPLETE",
      "Fill the cover and every page using ready, selected photos before review or order attachment.",
    );
  return doc;
}
type Action = { baseRevision: number; note: string } & (
  | { action: "archive"; archived: boolean }
  | { action: "close-invites" }
  | { action: "review"; status: z.infer<typeof reviewStatus> }
  | { action: "select-photo"; assetId: string; selected: boolean }
);
export async function albumAction(id: string, actorId: string, input: Action) {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, id);
    const row = await tx.studioProject.findUnique({ where: { id } });
    if (!row) return fail(404, "STUDIO_PROJECT_NOT_FOUND", "Album not found.");
    if (row.revision !== input.baseRevision)
      return fail(
        409,
        "STUDIO_REVISION_CONFLICT",
        "The album changed. Refresh it before applying this action.",
      );
    if (row.trashedAt || row.deletedAt)
      return fail(
        409,
        "ALBUM_TRASHED",
        "This album has been removed by its owner.",
      );
    let changes: Prisma.StudioProjectUpdateInput = {
      revision: { increment: 1 },
    };
    if (input.action === "archive") {
      changes.archivedAt = input.archived ? new Date() : null;
      if (input.archived)
        await tx.studioInvite.updateMany({
          where: { projectId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
    } else if (input.action === "close-invites") {
      await tx.studioInvite.updateMany({
        where: { projectId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else if (input.action === "review") {
      if (row.archivedAt)
        return fail(
          409,
          "ALBUM_ARCHIVED",
          "Restore this album before reviewing it.",
        );
      if (input.status === "REVIEWED") await checkDesign(tx, row);
      changes = {
        ...changes,
        reviewStatus: input.status,
        reviewRevision: row.revision + 1,
        reviewNote: input.note,
        reviewedAt: new Date(),
      };
    } else {
      if (row.archivedAt)
        return fail(
          409,
          "ALBUM_ARCHIVED",
          "Restore this album before changing photo selection.",
        );
      await protectPhotoSelection(tx, row, input.assetId, input.selected);
      const changed = await tx.studioAsset.updateMany({
        where: { id: input.assetId, projectId: id, status: "READY" },
        data: { selected: input.selected },
      });
      if (!changed.count)
        return fail(
          404,
          "PHOTO_NOT_FOUND",
          "Ready photo not found in this album.",
        );
    }
    const updated = await tx.studioProject.update({
      where: { id },
      data: changes,
      select: { revision: true },
    });
    const { note, baseRevision: _revision, ...metadata } = input;
    await tx.studioActivity.create({
      data: {
        projectId: id,
        actorId,
        action: input.action,
        note,
        metadata: { ...metadata, revision: updated.revision },
      },
    });
    return updated;
  });
}
export async function downloadOriginal(
  id: string,
  assetId: string,
  actorId: string,
  note: string,
) {
  const asset = await prisma.studioAsset.findFirst({
    where: { id: assetId, projectId: id, status: "READY" },
    select: { originalKey: true, filename: true },
  });
  if (!asset?.originalKey)
    return fail(404, "PHOTO_NOT_FOUND", "Original photo unavailable.");
  const url = await privateDownloadUrl(asset.originalKey, asset.filename);
  await prisma.studioActivity.create({
    data: {
      projectId: id,
      actorId,
      action: "download-original",
      note,
      metadata: { assetId },
    },
  });
  return { url, expiresInSeconds: 600 };
}
export async function matchingOrders(id: string) {
  const row = await project(id);
  if (!row.productId) return { items: [] };
  const items = await prisma.orderItem.findMany({
    where: {
      componentId: row.productId,
      studioAlbum: null,
      order: {
        userId: row.ownerId,
        status: { in: ["PENDING_PAYMENT", "PAID", "PROCESSING"] },
      },
    },
    take: 50,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      orderId: true,
      description: true,
      quantity: true,
      order: { select: { status: true, createdAt: true } },
    },
  });
  return { items };
}
export async function linkOrder(
  id: string,
  actorId: string,
  input: { baseRevision: number; note: string; orderItemId: string },
) {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, id);
    const row = await tx.studioProject.findUnique({ where: { id } });
    if (!row) return fail(404, "STUDIO_PROJECT_NOT_FOUND", "Album not found.");
    // Lock the commerce order as well so status changes cannot race attachment.
    const first = await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      select: { orderId: true },
    });
    if (!first) return fail(404, "ORDER_NOT_FOUND", "Order item not found.");
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${first.orderId} FOR UPDATE`;
    const item = await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: {
        order: { select: { userId: true, status: true } },
        studioAlbum: true,
      },
    });
    if (
      !item ||
      item.order.userId !== row.ownerId ||
      item.componentId !== row.productId
    )
      return fail(
        422,
        "ORDER_MISMATCH",
        "Choose an order item with the same customer and album product.",
      );
    if (item.studioAlbum) {
      if (
        item.studioAlbum.projectId === id &&
        item.studioAlbum.revision === input.baseRevision
      )
        return { id: item.studioAlbum.id };
      return fail(
        409,
        "ORDER_ALREADY_LINKED",
        "This order item already has an album attachment.",
      );
    }
    if (row.revision !== input.baseRevision)
      return fail(
        409,
        "STUDIO_REVISION_CONFLICT",
        "The album changed. Refresh before attaching it.",
      );
    if (
      row.trashedAt ||
      row.deletedAt ||
      row.archivedAt ||
      row.reviewStatus !== "REVIEWED" ||
      row.reviewRevision !== row.revision
    )
      return fail(
        409,
        "REVIEW_REQUIRED",
        "Review the current album revision before attaching it to an order.",
      );
    if (!["PENDING_PAYMENT", "PAID", "PROCESSING"].includes(item.order.status))
      return fail(
        409,
        "ORDER_CLOSED",
        "This order is already in fulfilment or closed.",
      );
    const doc = await checkDesign(tx, row);
    const config = row.configuration as { quantity?: number };
    if (config.quantity !== item.quantity)
      return fail(
        422,
        "QUANTITY_MISMATCH",
        "Order quantity must match the saved album configuration.",
      );
    const link = await tx.studioOrderLink.create({
      data: {
        projectId: id,
        orderItemId: item.id,
        revision: row.revision,
        actorId,
        snapshot: {
          title: row.title,
          configuration: row.configuration!,
          document: doc,
          purpose: "ADMIN_REFERENCE",
          printApproved: false,
        },
      },
      select: { id: true },
    });
    await tx.studioActivity.create({
      data: {
        projectId: id,
        actorId,
        action: "attach-order",
        note: input.note,
        metadata: {
          orderId: item.orderId,
          orderItemId: item.id,
          revision: row.revision,
          linkId: link.id,
        },
      },
    });
    return link;
  });
}
