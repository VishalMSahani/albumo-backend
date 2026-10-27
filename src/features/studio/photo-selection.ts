import { documentSchema } from "./design.js";
import { StudioProjectError } from "./error.js";
import type { Prisma } from "../../generated/prisma/client.js";
export function usedPhotoIds(document: unknown) {
  const parsed = documentSchema.safeParse(document);
  return new Set(
    parsed.success
      ? [parsed.data.cover.photo, ...parsed.data.pages.flatMap((p) => p.photos)]
          .filter((p) => p !== null)
          .map((p) => p.assetId)
      : [],
  );
}
export async function protectPhotoSelection(
  tx: Prisma.TransactionClient,
  project: { id: string; document: unknown; minimumPhotos: number | null },
  id: string,
  selected: boolean,
) {
  const photo = await tx.studioAsset.findFirst({
    where: { id, projectId: project.id, status: "READY" },
  });
  if (!photo)
    throw new StudioProjectError(404, "UPLOAD_NOT_FOUND", "Photo unavailable.");
  if (selected || !photo.selected) return;
  if (usedPhotoIds(project.document).has(id))
    throw new StudioProjectError(
      409,
      "PHOTO_IN_DESIGN",
      "Replace this photo in your design and wait for Saved before excluding it.",
    );
  if (
    project.document &&
    (await tx.studioAsset.count({
      where: { projectId: project.id, status: "READY", selected: true },
    })) <= (project.minimumPhotos || 0)
  )
    throw new StudioProjectError(
      409,
      "DESIGN_PHOTO_MINIMUM",
      "Add and include another photo before excluding this one. Your design needs its minimum photo count.",
    );
}
