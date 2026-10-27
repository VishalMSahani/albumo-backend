import { documentSchema } from "../design.js";
import { privateDownloadUrl } from "../../../services/r2-storage.service.js";
import { TRASH_RETENTION_MS } from "../trash.js";
import { randomUUID, createHash } from "node:crypto";
import { validateSelection } from "../configuration.js";
import { prisma } from "../../../lib/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import type {
  CreateStudioProject,
  UpdateStudioProject,
  ListStudioProjects,
} from "./project.schema.js";

import { StudioProjectError } from "../error.js";
export { StudioProjectError } from "../error.js";
const missing = () =>
  new StudioProjectError(
    404,
    "STUDIO_PROJECT_NOT_FOUND",
    "This album is unavailable or does not belong to your account.",
  );
const select = {
  id: true,
  title: true,
  occasion: true,
  revision: true,
  archivedAt: true,
  trashedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  document: true,
  assets: {
    where: { status: "READY", selected: true },
    select: { id: true, previewKey: true, originalKey: true },
  },
  cartItems: { select: { id: true, revision: true } },
  orderLinks: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      orderItem: { select: { order: { select: { id: true, status: true } } } },
    },
  },
  productId: true,
  configuration: true,
  pageCount: true,
  minimumPhotos: true,
  recommendedPhotos: true,
} satisfies Prisma.StudioProjectSelect;
type ProjectRow = Prisma.StudioProjectGetPayload<{ select: typeof select }>;
async function dto(row: ProjectRow) {
  const {
    document,
    assets,
    cartItems,
    orderLinks,
    deletedAt: _deleted,
    ...project
  } = row;
  const parsed = documentSchema.safeParse(document);
  const ready = assets.filter((asset) => asset.originalKey);
  const allowed = new Set(ready.map((asset) => asset.id));
  const complete =
    parsed.success &&
    parsed.data.pages.length === row.pageCount &&
    !!parsed.data.cover.photo &&
    ready.length >= (row.minimumPhotos || Infinity) &&
    parsed.data.pages.every(
      (p) => p.photos.length === (p.layout === "duo" ? 2 : 1),
    ) &&
    [
      parsed.data.cover.photo,
      ...parsed.data.pages.flatMap((p) => p.photos),
    ].every((p) => allowed.has(p.assetId));
  const cover = parsed.success
    ? assets.find((a) => a.id === parsed.data.cover.photo?.assetId)
    : undefined;
  return {
    ...project,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    trashedAt: row.trashedAt?.toISOString() ?? null,
    deleteAfter: row.trashedAt
      ? new Date(row.trashedAt.getTime() + TRASH_RETENTION_MS).toISOString()
      : null,
    designState: !row.configuration
      ? "SETUP"
      : ready.length < (row.minimumPhotos || Infinity)
        ? "PHOTOS"
        : complete
          ? "READY"
          : "DESIGN",
    readyPhotos: ready.length,
    inCart: cartItems.length > 0,
    cartNeedsUpdate: cartItems.some((item) => item.revision !== row.revision),
    order: orderLinks[0]?.orderItem.order ?? null,
    coverPreviewUrl: cover?.previewKey
      ? await privateDownloadUrl(cover.previewKey, "cover.webp")
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createStudioProject(
  ownerId: string,
  input: CreateStudioProject,
) {
  const normalizedSelection = input.selection
    ? {
        ...input.selection,
        choices: Object.fromEntries(
          Object.entries(input.selection.choices).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
      }
    : undefined;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        title: input.title,
        occasion: input.occasion,
        selection: normalizedSelection,
      }),
    )
    .digest("hex");
  // The unique owner/request pair makes retries (including concurrent ones) one draft.
  const where = { ownerId_requestId: { ownerId, requestId: input.requestId } };
  const previous = await prisma.studioProject.findUnique({
    where,
    select: { ...select, requestHash: true },
  });
  if (previous) {
    if (previous.deletedAt || previous.trashedAt) throw missing();
    if (previous.requestHash !== requestHash)
      throw new StudioProjectError(
        409,
        "STUDIO_REQUEST_REUSED",
        "This creation request was already used with different details.",
      );
    const { requestHash: _hash, ...project } = previous;
    return dto(project);
  }
  const snapshot = input.selection
    ? await validateSelection(input.selection)
    : null;
  let row;
  try {
    row = await prisma.studioProject.upsert({
      where,
      update: {},
      create: {
        ownerId,
        title: input.title,
        occasion: input.occasion,
        requestId: input.requestId,
        requestHash,
        ...(snapshot
          ? {
              productId: snapshot.productId,
              configuration: snapshot,
              pageCount: snapshot.pageCount,
              minimumPhotos: snapshot.minimumPhotos,
              recommendedPhotos: snapshot.recommendedPhotos,
            }
          : {}),
      },
      select: { ...select, requestHash: true },
    });
  } catch (error) {
    // Covers a database race if Prisma cannot use native ON CONFLICT for this query.
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ))
      throw error;
    row = await prisma.studioProject.findUnique({
      where,
      select: { ...select, requestHash: true },
    });
    if (!row) throw error;
  }
  if (row.requestHash !== requestHash)
    throw new StudioProjectError(
      409,
      "STUDIO_REQUEST_REUSED",
      "This creation request was already used with different details. Open My albums before starting another.",
    );
  const { requestHash: _requestHash, ...project } = row;
  return dto(project);
}

export async function getStudioProject(ownerId: string, id: string) {
  const row = await prisma.studioProject.findFirst({
    where: { id, ownerId, deletedAt: null },
    select,
  });
  if (
    !row ||
    (row.trashedAt &&
      row.trashedAt.getTime() + TRASH_RETENTION_MS <= Date.now())
  )
    throw missing();
  return dto(row);
}

export async function listStudioProjects(
  ownerId: string,
  input: ListStudioProjects,
) {
  let position: Prisma.StudioProjectWhereInput = {};
  if (input.after) {
    const anchor = await prisma.studioProject.findFirst({
      where: { id: input.after, ownerId },
      select: { id: true, createdAt: true },
    });
    if (!anchor) throw missing();
    position = {
      OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { lt: anchor.id } },
      ],
    };
  }
  // Creation order is stable when titles/revisions change between pages.
  const rows = await prisma.studioProject.findMany({
    where: {
      ownerId,
      deletedAt: null,
      ...(input.trash === "true"
        ? { trashedAt: { gt: new Date(Date.now() - TRASH_RETENTION_MS) } }
        : {
            trashedAt: null,
            archivedAt: input.archived === "true" ? { not: null } : null,
          }),
      ...position,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select,
  });
  const items = rows.slice(0, input.limit);
  return {
    items: await Promise.all(items.map(dto)),
    nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
  };
}

export async function updateStudioProject(
  ownerId: string,
  id: string,
  input: UpdateStudioProject,
) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.studioProject.updateMany({
      where: {
        id,
        ownerId,
        revision: input.baseRevision,
        trashedAt: null,
        deletedAt: null,
      },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.occasion !== undefined ? { occasion: input.occasion } : {}),
        ...(input.archived !== undefined
          ? { archivedAt: input.archived ? new Date() : null }
          : {}),
        revision: { increment: 1 },
      },
    });
    const row = await tx.studioProject.findFirst({
      where: { id, ownerId, deletedAt: null },
      select,
    });
    if (!row) throw missing();
    if (result.count !== 1)
      throw new StudioProjectError(
        409,
        "STUDIO_REVISION_CONFLICT",
        "This album changed in another tab. Load the latest details before saving again.",
      );
    return dto(row);
  });
}

// Copies and physical cleanup serialize reference changes to immutable private files.
export async function lockStudioMedia(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(24102501)`;
}
export async function configureStudioProject(
  ownerId: string,
  id: string,
  input: {
    baseRevision: number;
    selection: import("../selection.schema.js").StudioSelection;
  },
) {
  const snapshot = await validateSelection(input.selection);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StudioProject" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const row = await tx.studioProject.findFirst({
      where: { id, ownerId, deletedAt: null, trashedAt: null },
    });
    if (!row) throw missing();
    // Replaying a successful response must not create or reconfigure an album.
    if (
      row.configuration &&
      canonical(row.configuration) === canonical(snapshot)
    )
      return;
    if (row.archivedAt || row.configuration || row.document)
      throw new StudioProjectError(
        409,
        "STUDIO_ALREADY_CONFIGURED",
        "This album already has a format. Open the album to continue.",
      );
    if (row.revision !== input.baseRevision)
      throw new StudioProjectError(
        409,
        "STUDIO_REVISION_CONFLICT",
        "This album changed. Reload before choosing its format.",
      );
    await tx.studioProject.update({
      where: { id },
      data: {
        productId: snapshot.productId,
        configuration: snapshot,
        pageCount: snapshot.pageCount,
        minimumPhotos: snapshot.minimumPhotos,
        recommendedPhotos: snapshot.recommendedPhotos,
        revision: { increment: 1 },
      },
    });
  });
  return getStudioProject(ownerId, id);
}
export async function copyStudioProject(
  ownerId: string,
  id: string,
  input: {
    requestId: string;
    baseRevision: number;
    mode: "duplicate" | "reorder";
  },
) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ id, ...input }))
    .digest("hex");
  const copiedId = await prisma.$transaction(
    async (tx) => {
      await lockStudioMedia(tx);
      const previous = await tx.studioProject.findUnique({
        where: { ownerId_requestId: { ownerId, requestId: input.requestId } },
      });
      if (previous) {
        if (previous.requestHash !== requestHash)
          throw new StudioProjectError(
            409,
            "STUDIO_REQUEST_REUSED",
            "This copy request was already used. Refresh your albums.",
          );
        if (previous.deletedAt || previous.trashedAt) throw missing();
        return previous.id;
      }
      await tx.$queryRaw`SELECT "id" FROM "StudioProject" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const source = await tx.studioProject.findFirst({
        where: { id, ownerId, deletedAt: null, trashedAt: null },
        include: {
          assets: { where: { status: "READY" } },
          orderLinks: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              orderItem: { select: { order: { select: { status: true } } } },
            },
          },
        },
      });
      if (!source) throw missing();
      if (source.revision !== input.baseRevision)
        throw new StudioProjectError(
          409,
          "STUDIO_REVISION_CONFLICT",
          "This album changed. Refresh before making a copy.",
        );
      let title = source.title;
      let configuration = source.configuration;
      let document = source.document;
      if (input.mode === "reorder") {
        const order = source.orderLinks[0];
        if (
          !order ||
          ["CANCELLED", "PENDING_PAYMENT"].includes(
            order.orderItem.order.status,
          )
        )
          throw new StudioProjectError(
            409,
            "ORDER_REQUIRED",
            "Complete the original order first, or duplicate this draft.",
          );
        const snapshot = order.snapshot as {
          title: string;
          configuration: Prisma.JsonObject;
          document: Prisma.JsonObject;
        };
        title = snapshot.title;
        configuration = snapshot.configuration;
        document = snapshot.document;
      }
      const parsed = document ? documentSchema.parse(document) : null;
      const used = new Set(
        parsed
          ? [parsed.cover.photo, ...parsed.pages.flatMap((p) => p.photos)]
              .filter((p) => p !== null)
              .map((p) => p.assetId)
          : [],
      );
      const assets = source.assets.filter(a => a.originalKey && a.previewKey);
      if ([...used].some((assetId) => !assets.some((a) => a.id === assetId)))
        throw new StudioProjectError(
          409,
          "COPY_PHOTOS_UNAVAILABLE",
          "Some photos are unavailable. Open the original album before copying.",
        );
      const newId = randomUUID();
      const mapping = new Map(assets.map((a) => [a.id, randomUUID()]));
      if (parsed) {
        if (parsed.cover.photo)
          parsed.cover.photo.assetId = mapping.get(parsed.cover.photo.assetId)!;
        for (const page of parsed.pages)
          for (const photo of page.photos)
            photo.assetId = mapping.get(photo.assetId)!;
      }
      const config = configuration as {
        productId: string;
        pageCount: number;
        minimumPhotos: number;
        recommendedPhotos: number;
      } | null;
      await tx.studioProject.create({
        data: {
          id: newId,
          ownerId,
          requestId: input.requestId,
          requestHash,
          title: `${title.slice(0, 110)} - copy`,
          occasion: source.occasion,
          ...(config
            ? {
                productId: config.productId,
                configuration: configuration as Prisma.InputJsonObject,
                pageCount: config.pageCount,
                minimumPhotos: config.minimumPhotos,
                recommendedPhotos: config.recommendedPhotos,
              }
            : {}),
          ...(parsed ? { document: parsed } : {}),
        },
      });
      if (assets.length)
        await tx.studioAsset.createMany({
          data: assets.map((a) => ({
            id: mapping.get(a.id)!,
            projectId: newId,
            requestId: randomUUID(),
            uploaderKey: `owner:${ownerId}`,
            filename: a.filename,
            mimeType: a.mimeType,
            byteSize: a.byteSize,
            status: "READY",
            selected: input.mode === "reorder" || a.selected || used.has(a.id),
            stagingKey: `staging/studio/${newId}/${mapping.get(a.id)}`,
            originalKey: a.originalKey,
            previewKey: a.previewKey,
            checksum: a.checksum,
            width: a.width,
            height: a.height,
            expiresAt: new Date(),
          })),
        });
      return newId;
    },
    { timeout: 20000 },
  );
  return getStudioProject(ownerId, copiedId);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
