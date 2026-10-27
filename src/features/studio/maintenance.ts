import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { documentSchema } from "./design.js";
import { lockProject } from "./collection.js";
import { lockStudioMedia } from "./projects/project.service.js";
import { deleteR2Object } from "../../services/r2-storage.service.js";
import { operationSettings, defaultPolicy } from "./operation-settings.js";

export async function removeUnsharedFiles(
  tx: Prisma.TransactionClient,
  assets: {
    id: string;
    stagingKey: string;
    originalKey: string | null;
    previewKey: string | null;
  }[],
) {
  if (!assets.length) return;
  const ids = assets.map((a) => a.id);
  const keys = [
    ...new Set(
      assets
        .flatMap((a) => [a.stagingKey, a.originalKey, a.previewKey])
        .filter((v): v is string => !!v),
    ),
  ];
  const sharedRows = await tx.studioAsset.findMany({
    where: {
      id: { notIn: ids },
      OR: [
        { originalKey: { in: keys } },
        { previewKey: { in: keys } },
        { stagingKey: { in: keys } },
      ],
    },
    select: { originalKey: true, previewKey: true, stagingKey: true },
  });
  const shared = new Set(
    sharedRows.flatMap((a) => [a.originalKey, a.previewKey, a.stagingKey]),
  );
  const removable = keys.filter((k) => !shared.has(k));
  for (let offset = 0; offset < removable.length; offset += 8) {
    const results = await Promise.allSettled(
      removable
        .slice(offset, offset + 8)
        .map((k) => deleteR2Object(k, "private")),
    );
    if (results.some((r) => r.status === "rejected"))
      throw new Error("STORAGE_DELETE_FAILED");
  }
}
export async function retentionCandidates(
  tx: Prisma.TransactionClient,
  id: string,
  days: number,
  now = new Date(),
) {
  const project = await tx.studioProject.findUnique({
    where: { id },
    include: {
      orderLinks: {
        include: {
          orderItem: {
            select: {
              order: { select: { id: true, status: true, deliveredAt: true } },
            },
          },
        },
      },
      assets: true,
      cartItems: { select: { id: true } },
    },
  });
  if (
    !project?.deletedAt ||
    !project.orderLinks.length ||
    project.cartItems.length
  )
    return {
      assets: [],
      reason: "Only deleted albums with completed orders are eligible.",
    };
  if (project.assets.some((a) => a.leaseUntil && a.leaseUntil > now))
    return { assets: [], reason: "A photo is still processing." };
  const cutoff = now.getTime() - days * 86400000;
  if (
    project.deletedAt.getTime() > cutoff ||
    project.orderLinks.some(
      (l) =>
        l.orderItem.order.status !== "DELIVERED" ||
        !l.orderItem.order.deliveredAt ||
        l.orderItem.order.deliveredAt.getTime() > cutoff,
    )
  )
    return {
      assets: [],
      reason: "Retention starts after both delivery and album deletion.",
    };
  const orderIds = project.orderLinks.map((l) => l.orderItem.order.id);
  if (
    await tx.supportTicket.count({
      where: {
        orderId: { in: orderIds },
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
    })
  )
    return { assets: [], reason: "An order has an open support request." };
  const protectedIds = new Set<string>();
  for (const link of project.orderLinks) {
    const snapshot = link.snapshot as { document?: unknown; configuration?: { pageCount?: number } };
    const doc = documentSchema.safeParse(snapshot?.document);
    if (!doc.success || !doc.data.cover.photo || doc.data.pages.length !== snapshot.configuration?.pageCount ||
        doc.data.pages.some(p => p.photos.length !== (p.layout === 'duo' ? 2 : 1)))
      return { assets: [], reason: "An order snapshot needs inspection." };
    protectedIds.add(doc.data.cover.photo.assetId);
    for (const page of doc.data.pages)
      for (const p of page.photos) protectedIds.add(p.assetId);
  }
  return {
    assets: project.assets.filter((a) => !protectedIds.has(a.id)),
    reason: "Only photos absent from every order design are eligible.",
  };
}
export async function previewRetention(days?: number) {
  const settings = await operationSettings();
  const period = days ?? settings.policy.retentionDays;
  if (!period)
    return { items: [], days: null, enabled: false, inspected: 0, limit: 100 };
  const projects = await prisma.studioProject.findMany({
    where: { deletedAt: { not: null }, orderLinks: { some: {} } },
    orderBy: { deletedAt: "asc" },
    take: 100,
    select: { id: true, title: true },
  });
  const items = [];
  for (const p of projects) {
    const candidate = await retentionCandidates(prisma, p.id, period);
    items.push({
      id: p.id,
      title: p.title,
      photos: candidate.assets.length,
      bytes: candidate.assets.reduce((sum, a) => sum + a.byteSize, 0),
      reason: candidate.reason,
    });
  }
  return {
    items,
    days: period,
    enabled: settings.policy.retentionEnabled,
    inspected: projects.length,
    limit: 100,
  };
}
export async function pruneRetainedExtras(now = new Date()) {
  const settings = await operationSettings();
  if (!settings.policy.retentionEnabled || !settings.policy.retentionDays)
    return;
  const projects = await prisma.studioProject.findMany({
    where: {
      deletedAt: { not: null },
      orderLinks: { some: {} },
      assets: { some: {} },
    },
    orderBy: [
      { cleanupLastAt: { sort: "asc", nulls: "first" } },
      { deletedAt: "asc" },
    ],
    take: 10,
    select: { id: true },
  });
  for (const p of projects) {
    try {
      await prisma.$transaction(
        async (tx) => {
          await lockStudioMedia(tx);
          await lockProject(tx, p.id);
          // Hold the policy row so disabling cleanup cannot race a new destructive pass.
          await tx.$queryRaw`SELECT "id" FROM "StudioOperationSetting" WHERE "id"=1 FOR SHARE`;
          const current = await operationSettings(tx);
          if (!current.policy.retentionEnabled || !current.policy.retentionDays)
            return;
          const candidate = await retentionCandidates(
            tx,
            p.id,
            current.policy.retentionDays,
            now,
          );
          if (candidate.assets.length) {
            await removeUnsharedFiles(tx, candidate.assets);
            await tx.studioAsset.deleteMany({
              where: { id: { in: candidate.assets.map((a) => a.id) } },
            });
            await tx.studioActivity.create({
              data: {
                projectId: p.id,
                actorId: "studio-media-worker",
                action: "prune-unused-photos",
                note: `Removed ${candidate.assets.length} unused photos under the ${current.policy.retentionDays}-day policy. Order photos retained.`,
                metadata: {
                  policyRevision: current.revision,
                  count: candidate.assets.length,
                },
              },
            });
          }
          await tx.studioProject.update({
            where: { id: p.id },
            data: {
              cleanupLastAt: now,
              cleanupError: null,
              cleanupAttempts: { increment: 1 },
            },
          });
        },
        { timeout: 120000, maxWait: 10000 },
      );
    } catch {
      await prisma.studioProject
        .updateMany({
          where: { id: p.id },
          data: {
            cleanupLastAt: now,
            cleanupAttempts: { increment: 1 },
            cleanupError: "RETENTION_CLEANUP_FAILED",
          },
        })
        .catch(() => {});
    }
  }
}
export async function workerPulse(error: string | null) {
  const now = new Date();
  await prisma.studioOperationSetting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      policy: defaultPolicy,
      workerHeartbeatAt: now,
      workerError: error,
      ...(!error ? { workerLastSuccessAt: now } : {}),
    },
    update: {
      workerHeartbeatAt: now,
      workerError: error,
      ...(!error ? { workerLastSuccessAt: now } : {}),
    },
  });
}
export async function operationMonitor() {
  const settings = await operationSettings();
  const cutoff = new Date(Date.now() - settings.policy.alertMinutes * 60000);
  const [pending, oldest, failed, processing, stalled, items] =
    await Promise.all([
      prisma.studioProject.count({
        where: { deletedAt: { not: null }, orderLinks: { none: {} } },
      }),
      prisma.studioProject.findFirst({
        where: { deletedAt: { not: null }, orderLinks: { none: {} } },
        orderBy: { deletedAt: "asc" },
        select: { deletedAt: true },
      }),
      prisma.studioProject.count({ where: { cleanupError: { not: null } } }),
      prisma.studioAsset.count({
        where: {
          status: { in: ["UPLOADING", "PROCESSING"] },
          project: { deletedAt: null, trashedAt: null },
        },
      }),
      prisma.studioAsset.count({
        where: {
          status: "PROCESSING",
          createdAt: { lt: cutoff },
          project: { deletedAt: null, trashedAt: null },
        },
      }),
      prisma.studioProject.findMany({
        where: {
          OR: [
            { cleanupError: { not: null } },
            { deletedAt: { not: null }, orderLinks: { none: {} } },
          ],
        },
        orderBy: { deletedAt: "asc" },
        take: 50,
        select: {
          id: true,
          title: true,
          deletedAt: true,
          cleanupAttempts: true,
          cleanupLastAt: true,
          cleanupError: true,
        },
      }),
    ]);
  const alerts: string[] = [];
  if (!settings.workerHeartbeatAt || settings.workerHeartbeatAt < cutoff)
    alerts.push("Media worker heartbeat is missing or stale.");
  if (settings.workerError)
    alerts.push("The worker could not reach a required service.");
  if (failed)
    alerts.push(
      `${failed} album cleanup jobs need attention; retries continue automatically.`,
    );
  if (oldest?.deletedAt && oldest.deletedAt < cutoff)
    alerts.push(
      "Trash cleanup is taking longer than the configured threshold.",
    );
  if (stalled) alerts.push(`${stalled} photo processing jobs are delayed.`);
  return {
    settings,
    pending,
    oldestPendingAt: oldest?.deletedAt ?? null,
    failed,
    processing,
    stalled,
    items,
    alerts,
  };
}
