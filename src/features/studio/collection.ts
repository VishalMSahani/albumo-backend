import { protectPhotoSelection, usedPhotoIds } from "./photo-selection.js";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import {
  prepareStagedPut,
  privateDownloadUrl,
} from "../../services/r2-storage.service.js";
import { StudioProjectError } from "./error.js";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const uploadSchema = z
  .object({
    requestId: z.uuid(),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .regex(/^[^\x00-\x1f\x7f]+$/),
    byteSize: z.number().int().min(1).max(MAX_FILE_BYTES),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  })
  .strict();
export const exchangeSchema = z
  .object({
    inviteId: z.uuid(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    displayName: z.string().trim().max(80).default("Friend"),
  })
  .strict();
export type Actor = { ownerId: string } | { guestId: string };
type Db = Prisma.TransactionClient;
export const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const fail = (status: number, code: string, message: string): never => {
  throw new StudioProjectError(status, code, message);
};
export async function authorizeCollection(
  db: Db,
  projectId: string,
  actor: Actor,
  write = true,
) {
  const project = await db.studioProject.findUnique({
    where: { id: projectId },
  });
  if (!project || project.deletedAt || project.trashedAt)
    return fail(404, "STUDIO_PROJECT_NOT_FOUND", "Album unavailable.");
  if ("ownerId" in actor) {
    if (project.ownerId !== actor.ownerId)
      return fail(404, "STUDIO_PROJECT_NOT_FOUND", "Album unavailable.");
  } else {
    const guest = await db.studioGuestSession.findUnique({
      where: { id: actor.guestId },
      include: { invite: true },
    });
    if (
      !guest ||
      guest.invite.projectId !== project.id ||
      guest.expiresAt <= new Date() ||
      guest.invite.expiresAt <= new Date() ||
      guest.invite.revokedAt
    )
      return fail(
        403,
        "COLLECTION_CLOSED",
        "This collection link has expired or been closed.",
      );
  }
  if (write && project.archivedAt)
    return fail(
      409,
      "STUDIO_ARCHIVED",
      "Restore this album before adding photos.",
    );
  if (!project.configuration || !project.minimumPhotos)
    return fail(
      409,
      "STUDIO_FORMAT_REQUIRED",
      "Choose an album and its options on the Albumo website first.",
    );
  return project;
}
export async function lockProject(db: Db, id: string) {
  await db.$queryRaw`SELECT "id" FROM "StudioProject" WHERE "id" = ${id}::uuid FOR UPDATE`;
}
export async function createInvite(projectId: string, ownerId: string) {
  const token = randomBytes(32).toString("hex");
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    await authorizeCollection(tx, projectId, { ownerId });
    await tx.studioInvite.updateMany({
      where: { projectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const invite = await tx.studioInvite.create({
      data: {
        projectId,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      },
    });
    return { id: invite.id, token, expiresAt: invite.expiresAt.toISOString() };
  });
}
export async function closeInvites(projectId: string, ownerId: string) {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    await authorizeCollection(tx, projectId, { ownerId }, false);
    await tx.studioInvite.updateMany({
      where: { projectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { closed: true };
  });
}
export async function exchangeInvite(input: z.infer<typeof exchangeSchema>) {
  const first = await prisma.studioInvite.findUnique({
    where: { id: input.inviteId },
  });
  if (!first || first.tokenHash !== hash(input.token))
    return fail(
      403,
      "COLLECTION_CLOSED",
      "This collection link is unavailable.",
    );
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, first.projectId);
    const invite = await tx.studioInvite.findUnique({
      where: { id: first.id },
      include: { project: true },
    });
    if (
      !invite ||
      invite.revokedAt ||
      invite.expiresAt <= new Date() ||
      invite.project.archivedAt ||
      invite.project.trashedAt ||
      invite.project.deletedAt
    )
      return fail(
        403,
        "COLLECTION_CLOSED",
        "This collection link has expired or been closed.",
      );
    if (
      (await tx.studioGuestSession.count({ where: { inviteId: invite.id } })) >=
      100
    )
      return fail(
        429,
        "GUEST_LIMIT",
        "This collection has reached its contributor limit.",
      );
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(
      Math.min(Date.now() + 12 * 3600_000, invite.expiresAt.getTime()),
    );
    await tx.studioGuestSession.create({
      data: {
        inviteId: invite.id,
        tokenHash: hash(token),
        displayName: input.displayName || "Friend",
        expiresAt,
      },
    });
    return {
      token,
      projectId: invite.projectId,
      title: invite.project.title,
      expiresAt: expiresAt.toISOString(),
      maxFileBytes: MAX_FILE_BYTES,
    };
  });
}
export async function guestActor(
  token: string,
): Promise<{ actor: Actor; projectId: string }> {
  const guest = await prisma.studioGuestSession.findUnique({
    where: { tokenHash: hash(token) },
    include: { invite: true },
  });
  if (
    !guest ||
    guest.expiresAt <= new Date() ||
    guest.invite.expiresAt <= new Date() ||
    guest.invite.revokedAt
  )
    return fail(
      403,
      "COLLECTION_CLOSED",
      "Your upload session has expired or been closed. Scan the active QR again.",
    );
  return { actor: { guestId: guest.id }, projectId: guest.invite.projectId };
}
export async function prepareUpload(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof uploadSchema>,
) {
  const asset = await prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    await authorizeCollection(tx, projectId, actor);
    const uploaderKey =
      "ownerId" in actor ? `owner:${actor.ownerId}` : `guest:${actor.guestId}`;
    const old = await tx.studioAsset.findUnique({
      where: {
        projectId_uploaderKey_requestId: {
          projectId,
          uploaderKey,
          requestId: input.requestId,
        },
      },
    });
    if (old) {
      if (
        old.filename !== input.filename ||
        old.byteSize !== input.byteSize ||
        old.mimeType !== input.mimeType
      )
        return fail(
          409,
          "UPLOAD_REQUEST_REUSED",
          "Retry with the same photo or select it as a new upload.",
        );
      if (
        (old.status === "UPLOADING" && old.expiresAt <= new Date()) ||
        (old.status === "FAILED" && old.errorCode === "UPLOAD_EXPIRED")
      ) {
        const reserved = await tx.studioAsset.aggregate({
          where: {
            projectId,
            id: { not: old.id },
            status: { in: ["UPLOADING", "PROCESSING", "READY"] },
          },
          _sum: { byteSize: true },
          _count: true,
        });
        if (
          reserved._count >= 500 ||
          (reserved._sum.byteSize || 0) + input.byteSize > 1024 * 1024 * 1024
        )
          return fail(
            413,
            "COLLECTION_FULL",
            "This album has reached its photo limit.",
          );
        return tx.studioAsset.update({
          where: { id: old.id },
          data: {
            status: "UPLOADING",
            errorCode: null,
            stagingKey: `staging/studio/${projectId}/${old.id}/${randomUUID()}`,
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
      }
      return old;
    }
    // The project row lock serializes reservations from owners and all guests.
    const reserved = await tx.studioAsset.aggregate({
      where: {
        projectId,
        status: { in: ["UPLOADING", "PROCESSING", "READY"] },
      },
      _sum: { byteSize: true },
      _count: true,
    });
    if (
      reserved._count >= 500 ||
      (reserved._sum.byteSize || 0) + input.byteSize > 1024 * 1024 * 1024
    )
      return fail(
        413,
        "COLLECTION_FULL",
        "This album has reached its 500-photo or 1 GB collection limit.",
      );
    if (
      "guestId" in actor &&
      (await tx.studioAsset.count({ where: { guestId: actor.guestId } })) >= 100
    )
      return fail(
        413,
        "GUEST_UPLOAD_LIMIT",
        "You have reached this upload session’s photo limit.",
      );
    const id = randomUUID();
    return tx.studioAsset.create({
      data: {
        id,
        projectId,
        ...input,
        uploaderKey,
        ...("guestId" in actor ? { guestId: actor.guestId } : {}),
        stagingKey: `staging/studio/${projectId}/${id}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
  });
  return {
    id: asset.id,
    status: asset.status,
    ...(asset.status === "UPLOADING"
      ? await prepareStagedPut(asset.stagingKey, asset.byteSize)
      : {}),
  };
}
export async function completeUpload(
  projectId: string,
  id: string,
  actor: Actor,
) {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    await authorizeCollection(tx, projectId, actor);
    const asset = await tx.studioAsset.findFirst({
      where: {
        id,
        projectId,
        ...("guestId" in actor ? { guestId: actor.guestId } : {}),
      },
    });
    if (!asset) return fail(404, "UPLOAD_NOT_FOUND", "Upload unavailable.");
    if (["READY", "PROCESSING"].includes(asset.status))
      return { id, status: asset.status };
    if (asset.status !== "UPLOADING" || asset.expiresAt <= new Date())
      return fail(
        410,
        "UPLOAD_EXPIRED",
        "This upload expired. Please select the photo again.",
      );
    await tx.studioAsset.update({
      where: { id },
      data: { status: "PROCESSING" },
    });
    return { id, status: "PROCESSING" };
  });
}
export async function assetSummary(
  projectId: string,
  ownerId: string,
  after?: string,
) {
  const project = await authorizeCollection(
    prisma,
    projectId,
    { ownerId },
    false,
  );
  const [counts, rows] = await Promise.all([
    prisma.studioAsset.groupBy({
      by: ["status", "selected"],
      where: { projectId },
      _count: true,
    }),
    prisma.studioAsset.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 41,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      include: { guest: { select: { displayName: true } } },
    }),
  ]);
  // A supplied cursor cannot be used to inspect another project's row.
  if (
    after &&
    !(await prisma.studioAsset.findFirst({ where: { id: after, projectId } }))
  )
    return fail(404, "UPLOAD_NOT_FOUND", "Photo unavailable.");
  const ready = counts
    .filter((row) => row.status === "READY" && row.selected)
    .reduce((sum, row) => sum + row._count, 0);
  const used = usedPhotoIds(project.document);
  return {
    ready,
    minimumPhotos: project.minimumPhotos!,
    recommendedPhotos: project.recommendedPhotos!,
    canDesign: ready >= project.minimumPhotos! && !project.archivedAt,
    processing: counts
      .filter((row) => ["UPLOADING", "PROCESSING"].includes(row.status))
      .reduce((sum, row) => sum + row._count, 0),
    nextCursor: rows.length > 40 ? rows[39]!.id : null,
    items: await Promise.all(
      rows
        .slice(0, 40)
        .map(async (row) => ({
          id: row.id,
          filename: row.filename,
          status: row.status,
          selected: row.selected,
          usedInDesign: used.has(row.id),
          exclusionBlocked:
            row.selected &&
            (used.has(row.id)
              ? "Replace in design first"
              : project.document && ready <= project.minimumPhotos!
                ? "Add another photo first"
                : null),
          contributor: row.guest?.displayName || "You",
          errorCode: row.errorCode,
          width: row.width,
          height: row.height,
          previewUrl:
            row.status === "READY" && row.previewKey
              ? await privateDownloadUrl(row.previewKey, "photo.webp")
              : null,
        })),
    ),
  };
}
export async function selectAsset(
  projectId: string,
  id: string,
  ownerId: string,
  selected: boolean,
) {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const project = await authorizeCollection(tx, projectId, { ownerId });
    await protectPhotoSelection(tx, project, id, selected);
    const result = await tx.studioAsset.updateMany({
      where: { id, projectId, status: "READY" },
      data: { selected },
    });
    if (!result.count)
      return fail(404, "UPLOAD_NOT_FOUND", "Photo unavailable.");
    await tx.studioProject.update({
      where: { id: projectId },
      data: { revision: { increment: 1 } },
    });
    return { id, selected };
  });
}
export async function guestProgress(projectId: string, actor: Actor) {
  await authorizeCollection(prisma, projectId, actor);
  if (!("guestId" in actor))
    return fail(403, "GUEST_REQUIRED", "Guest session required.");
  return prisma.studioAsset.findMany({
    where: { projectId, guestId: actor.guestId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, filename: true, status: true, errorCode: true },
  });
}
