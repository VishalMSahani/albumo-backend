import { photoFrame } from "./page-appearance.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { documentSchema } from "./design.js";
import { authorizeCollection, lockProject } from "./collection.js";
import {
  operationSettings,
  profileFor,
  type OperationPolicy,
} from "./operation-settings.js";
import { StudioProjectError } from "./error.js";
type Photo = {
  id: string;
  width: number | null;
  height: number | null;
  checksum?: string | null;
};
export function fingerprint(value: unknown): string {
  const stable = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(stable)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, stable(v)]),
          )
        : item;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
// Legacy v2 frames and optional v3 appearance match every saved-design renderer.
// Object-fit: cover uses
// the smaller pixel/inch ratio; subject position changes cropping, not DPI.
export function assessPrint(
  document: unknown,
  configuration: unknown,
  photos: Photo[],
  policy: OperationPolicy,
) {
  const doc = documentSchema.safeParse(document);
  const config = configuration as {
    productId?: string;
    pageCount?: number;
    options?: {
      kind: string;
      width?: number;
      height?: number;
      unit?: string;
    }[];
  } | null;
  const profile = profileFor(policy, config?.productId);
  const size = config?.options?.find((p) => p.kind === "dimension");
  const toMm =
    size?.unit === "in"
      ? 25.4
      : size?.unit === "cm"
        ? 10
        : size?.unit === "mm"
          ? 1
          : 0;
  const widthMm = (size?.width || 0) * toMm,
    heightMm = (size?.height || 0) * toMm;
  const issues: string[] = [];
  if (!doc.success || doc.data.pages.length !== config?.pageCount)
    issues.push("The album needs a complete saved design.");
  if (!widthMm || !heightMm) issues.push("Album dimensions are unavailable.");
  const slots: {
    page: number;
    slot: number;
    assetId: string | null;
    label: string;
    dpi: number | null;
    status: "good" | "warning" | "low" | "unknown";
    repeated: boolean;
  }[] = [];
  const identities = new Map<string, number>();
  const add = (
    page: number,
    slot: number,
    placement: { assetId: string } | undefined | null,
    widthFactor: number,
    heightFactor: number,
  ) => {
    const photo = photos.find((p) => p.id === placement?.assetId);
    const dpi =
      photo?.width && photo.height && widthMm && heightMm
        ? Math.floor(
            Math.min(
              photo.width / ((widthMm * widthFactor) / 25.4),
              photo.height / ((heightMm * heightFactor) / 25.4),
            ),
          )
        : null;
    const identity = photo?.checksum || photo?.id;
    if (identity) identities.set(identity, (identities.get(identity) || 0) + 1);
    const status =
      dpi === null
        ? "unknown"
        : !profile?.approved
          ? "unknown"
          : dpi < profile.minimumDpi
            ? "low"
            : dpi < profile.targetDpi
              ? "warning"
              : "good";
    slots.push({
      page,
      slot,
      assetId: placement?.assetId || null,
      label: page < 0 ? "Cover" : `Page ${page + 1}, photo ${slot + 1}`,
      dpi,
      status,
      repeated: false,
    });
  };
  if (doc.success) {
    const coverFrame = photoFrame(doc.data.cover.appearance, true, false);
    add(-1, 0, doc.data.cover.photo, coverFrame.width, coverFrame.height);
    doc.data.pages.forEach((page, i) => {
      const count = page.layout === "duo" ? 2 : 1;
      const frame = photoFrame(page.appearance, false, !!page.caption, count === 2);
      for (let n = 0; n < count; n++)
        add(
          i,
          n,
          page.photos[n],
          frame.width,
          frame.height,
        );
    });
  }
  for (const slot of slots) {
    const p = photos.find((p) => p.id === slot.assetId);
    slot.repeated = (identities.get(p?.checksum || p?.id || "") || 0) > 1;
  }
  if (slots.some((s) => !s.assetId)) issues.push("Fill every photo space.");
  if (
    profile?.approved &&
    slots.some((s) => s.status === "low" || s.dpi === null)
  )
    issues.push(
      "Replace photos below the minimum resolution or with unavailable dimensions.",
    );
  if (profile?.approved && Math.min(widthMm, heightMm) * 0.06 < profile.safeMm)
    issues.push(
      "This format needs a larger content margin. Ask Albumo to review the print settings.",
    );
  const layoutVersion = doc.success && (doc.data.cover.appearance || doc.data.pages.some(p=>p.appearance)) ? 3 : 2;
  return {
    layoutVersion,
    profile: profile?.approved ? profile : null,
    specificationsPending: !profile?.approved,
    widthMm,
    heightMm,
    bleedWidthMm: widthMm + 2 * (profile?.approved ? profile.bleedMm : 0),
    bleedHeightMm: heightMm + 2 * (profile?.approved ? profile.bleedMm : 0),
    slots,
    issues,
    lowCount: slots.filter((s) => s.status === "low").length,
    warningCount: slots.filter((s) => s.status === "warning").length,
    repeatedCount: [...identities.values()].filter((n) => n > 1).length,
    canApprove: doc.success && issues.length === 0,
    reportHash: fingerprint({
      layoutVersion,
      document,
      configuration,
      profile,
      photos: photos
        .filter((p) => slots.some((slot) => slot.assetId === p.id))
        .map((p) => ({
          id: p.id,
          width: p.width,
          height: p.height,
          checksum: p.checksum,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  };
}
export async function printReport(
  db: Prisma.TransactionClient,
  projectId: string,
  document: unknown,
  configuration: unknown,
) {
  const [settings, photos] = await Promise.all([
    operationSettings(db),
    db.studioAsset.findMany({
      where: { projectId, status: "READY" },
      select: { id: true, width: true, height: true, checksum: true },
    }),
  ]);
  return assessPrint(document, configuration, photos, settings.policy);
}
export async function projectQuality(projectId: string, ownerId: string) {
  const project = await authorizeCollection(
    prisma,
    projectId,
    { ownerId },
    false,
  );
  const report = await printReport(
    prisma,
    projectId,
    project.document,
    project.configuration,
  );
  const proof = project.proof as {
    revision?: number;
    reportHash?: string;
  } | null;
  return {
    ...report,
    revision: project.revision,
    accepted:
      proof?.revision === project.revision &&
      proof.reportHash === report.reportHash,
  };
}
export const acceptProofSchema = z
  .object({
    baseRevision: z.number().int().min(1),
    reportHash: z.string().regex(/^[a-f0-9]{64}$/),
    accepted: z.literal(true),
  })
  .strict();
export async function acceptProjectProof(
  projectId: string,
  ownerId: string,
  input: z.infer<typeof acceptProofSchema>,
) {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const project = await authorizeCollection(tx, projectId, { ownerId });
    const report = await printReport(
      tx,
      projectId,
      project.document,
      project.configuration,
    );
    if (
      project.revision !== input.baseRevision ||
      report.reportHash !== input.reportHash
    )
      throw new StudioProjectError(
        409,
        "PROOF_CHANGED",
        "The design or print settings changed. Review the latest checks.",
      );
    if (!report.canApprove)
      throw new StudioProjectError(
        409,
        "PRINT_CHECKS_REQUIRED",
        "Resolve the highlighted checks before approving this proof.",
      );
    const proof = {
      revision: project.revision,
      reportHash: report.reportHash,
      acceptedAt: new Date().toISOString(),
      actorId: ownerId,
      profile: report.profile,
      layoutVersion: report.layoutVersion,
      specificationsPending: report.specificationsPending,
    };
    await tx.studioProject.update({
      where: { id: projectId },
      data: { proof },
    });
    return { accepted: true };
  });
}
export async function approveOrderPrint(
  projectId: string,
  linkId: string,
  actorId: string,
  input: { reportHash: string; note: string; supplierProofChecked: true },
) {
  return prisma.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const link = await tx.studioOrderLink.findFirst({
      where: { id: linkId, projectId },
      include: {
        orderItem: { select: { order: { select: { status: true } } } },
      },
    });
    if (!link)
      throw new StudioProjectError(
        404,
        "ORDER_NOT_FOUND",
        "Order design unavailable.",
      );
    if (!["PAID", "PROCESSING", "PACKED"].includes(link.orderItem.order.status))
      throw new StudioProjectError(
        409,
        "ORDER_NOT_READY",
        "Only paid orders awaiting shipment can receive print approval.",
      );
    const snapshot = link.snapshot as {
      document: Prisma.JsonValue;
      configuration: Prisma.JsonValue;
    };
    const report = await printReport(
      tx,
      projectId,
      snapshot.document,
      snapshot.configuration,
    );
    if (
      !report.profile ||
      !report.canApprove ||
      report.reportHash !== input.reportHash
    )
      throw new StudioProjectError(
        409,
        "PRINT_CHECKS_REQUIRED",
        "Review the latest print profile and resolve quality checks before approving.",
      );
    const printApproval = {
      actorId,
      reportHash: report.reportHash,
      profile: report.profile,
      approvedAt: new Date().toISOString(),
      note: input.note,
      supplierProofChecked: true,
    };
    await tx.studioOrderLink.update({
      where: { id: linkId },
      data: { printApproval },
    });
    await tx.studioActivity.create({
      data: {
        projectId,
        actorId,
        action: "approve-print",
        note: input.note,
        metadata: { linkId, reportHash: report.reportHash },
      },
    });
    return { approved: true };
  });
}
