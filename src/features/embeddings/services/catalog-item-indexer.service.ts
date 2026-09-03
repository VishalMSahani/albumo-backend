import { prisma } from "../../../lib/prisma.js";
import { chunkComponent, chunkProject } from "./chunker.service.js";
import { deleteSourceChunks, embedAndStore } from "./indexer.service.js";

export type CatalogReindexSourceType = "component" | "project";
export type CatalogReindexAction = "upsert" | "delete";

export interface CatalogReindexResult {
  sourceType: CatalogReindexSourceType;
  sourceId: string;
  action: CatalogReindexAction;
  storedChunks: number;
  deletedChunks: number;
}

export async function reindexCatalogItem(
  sourceType: CatalogReindexSourceType,
  sourceId: string,
  action: CatalogReindexAction,
): Promise<CatalogReindexResult> {
  if (action === "delete") {
    return {
      sourceType,
      sourceId,
      action,
      storedChunks: 0,
      deletedChunks: await deleteSourceChunks(sourceType, sourceId),
    };
  }

  if (sourceType === "component") {
    return await reindexComponent(sourceId);
  }

  return await reindexProject(sourceId);
}

async function reindexComponent(sourceId: string): Promise<CatalogReindexResult> {
  const component = await prisma.component.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      name: true,
      sku: true,
      description: true,
      typicalUseCase: true,
      category: true,
      subcategory: true,
      productType: true,
      brand: true,
      tags: true,
      unitPriceCents: true,
      stockQuantity: true,
      imageUrl: true,
      vendorLink: true,
      isBestSeller: true,
      isRobomaniacItem: true,
      isSoftware: true,
      isActive: true,
    },
  });

  if (!component || !component.isActive) {
    return {
      sourceType: "component",
      sourceId,
      action: "delete",
      storedChunks: 0,
      deletedChunks: await deleteSourceChunks("component", sourceId),
    };
  }

  const storedChunks = await embedAndStore([chunkComponent(component)]);
  return {
    sourceType: "component",
    sourceId,
    action: "upsert",
    storedChunks,
    deletedChunks: 0,
  };
}

async function reindexProject(sourceId: string): Promise<CatalogReindexResult> {
  const project = await prisma.project.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      title: true,
      slug: true,
      summary: true,
      description: true,
      category: true,
      tags: true,
      difficulty: true,
      projectType: true,
      estimatedCostCents: true,
      estimatedBuildTimeMinutes: true,
      thumbnailUrl: true,
      learningOutcomes: true,
      prerequisites: true,
      deletedAt: true,
      isPublic: true,
    },
  });

  if (!project || project.deletedAt || !project.isPublic) {
    return {
      sourceType: "project",
      sourceId,
      action: "delete",
      storedChunks: 0,
      deletedChunks: await deleteSourceChunks("project", sourceId),
    };
  }

  const storedChunks = await embedAndStore([chunkProject(project)]);
  return {
    sourceType: "project",
    sourceId,
    action: "upsert",
    storedChunks,
    deletedChunks: 0,
  };
}
