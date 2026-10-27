import { removeUnsharedFiles } from "./maintenance.js";
import { lockStudioMedia } from "./projects/project.service.js";
import { prisma } from "../../lib/prisma.js";
import { lockProject } from "./collection.js";
import { StudioProjectError } from "./error.js";

export const TRASH_RETENTION_MS = 15 * 24 * 60 * 60 * 1000;
const fail = (status: number, code: string, message: string): never => {
  throw new StudioProjectError(status, code, message);
};

export async function changeAlbumLifecycle(
  ownerId: string,
  id: string,
  input: { baseRevision: number; action: "trash" | "restore" | "delete" },
) {
  if (
    !(await prisma.studioProject.findFirst({
      where: { id, ownerId, deletedAt: null },
      select: { id: true },
    }))
  )
    return fail(404, "STUDIO_PROJECT_NOT_FOUND", "Album unavailable.");
  // Same cart -> project lock order as Add to cart and checkout.
  const cart = await prisma.cart.upsert({
    where: { userId: ownerId },
    create: { userId: ownerId },
    update: {},
    select: { id: true },
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "id" = ${cart.id} FOR UPDATE`;
    await lockProject(tx, id);
    const row = await tx.studioProject.findFirst({
      where: { id, ownerId, deletedAt: null },
    });
    if (!row)
      return fail(404, "STUDIO_PROJECT_NOT_FOUND", "Album unavailable.");
    if (row.revision !== input.baseRevision)
      return fail(
        409,
        "STUDIO_REVISION_CONFLICT",
        "This album changed. Refresh your albums and try again.",
      );
    const now = new Date();
    if (input.action === "restore") {
      if (
        !row.trashedAt ||
        row.trashedAt.getTime() + TRASH_RETENTION_MS <= now.getTime()
      )
        return fail(
          410,
          "TRASH_EXPIRED",
          "This album can no longer be restored.",
        );
      await tx.studioProject.update({
        where: { id },
        data: { trashedAt: null, archivedAt: null, revision: { increment: 1 } },
      });
    } else {
      if (input.action === "delete" && !row.trashedAt)
        return fail(409, "TRASH_REQUIRED", "Move this album to Trash first.");
      await tx.studioProject.update({
        where: { id },
        data: {
          trashedAt: row.trashedAt ?? now,
          ...(input.action === "delete" ? { deletedAt: now } : {}),
          revision: { increment: 1 },
        },
      });
      await tx.studioCartItem.deleteMany({ where: { projectId: id } });
      await tx.studioInvite.updateMany({
        where: { projectId: id, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    return {
      action: input.action,
      orderFilesRetained:
        (await tx.studioOrderLink.count({ where: { projectId: id } })) > 0,
    };
  });
}

// Called by the existing media worker. Failed object deletion leaves the DB rows
// intact so the next pass retries. Order snapshots and their source files survive.
export async function purgeTrashedAlbums(now = new Date()) {
  await prisma.studioProject.updateMany({
    where: {
      deletedAt: null,
      trashedAt: { lte: new Date(now.getTime() - TRASH_RETENTION_MS) },
    },
    data: { deletedAt: now },
  });
  const rows = await prisma.studioProject.findMany({
    where: { deletedAt: { not: null }, orderLinks: { none: {} } },
    take: 10,
    orderBy: [{ cleanupLastAt: { sort: "asc", nulls: "first" } }, { deletedAt: "asc" }],
    select: { id: true },
  });
  for (const row of rows) {
    try {
      await prisma.$transaction(
        async (tx) => {
          await lockStudioMedia(tx);
          await lockProject(tx, row.id);
          const current = await tx.studioProject.findUnique({
            where: { id: row.id },
            select: {
              deletedAt: true,
              _count: { select: { orderLinks: true } },
            },
          });
          if (!current?.deletedAt || current._count.orderLinks) return;
          const assets = await tx.studioAsset.findMany({
            where: { projectId: row.id },
          });
          if (assets.some((a) => a.leaseUntil && a.leaseUntil > now)) return;
          await removeUnsharedFiles(tx, assets);
          await tx.studioCartItem.deleteMany({ where: { projectId: row.id } });
          await tx.studioAsset.deleteMany({ where: { projectId: row.id } });
          await tx.studioGuestSession.deleteMany({
            where: { invite: { projectId: row.id } },
          });
          await tx.studioInvite.deleteMany({ where: { projectId: row.id } });
          await tx.studioActivity.deleteMany({ where: { projectId: row.id } });
          await tx.studioProject.delete({ where: { id: row.id } });
        },
        { timeout: 120000, maxWait: 10000 },
      );
    } catch {
      await prisma.studioProject.updateMany({ where: { id: row.id }, data: { cleanupLastAt: now, cleanupAttempts: { increment: 1 }, cleanupError: 'TRASH_CLEANUP_FAILED' } }).catch(() => {});
      console.error("Studio trash cleanup deferred; will retry.");
    }
  }
}
