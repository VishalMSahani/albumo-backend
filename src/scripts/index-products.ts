import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { chunkComponent, chunkProject } from "../features/embeddings/services/chunker.service.js";
import { embedAndStore } from "../features/embeddings/services/indexer.service.js";

async function main(): Promise<void> {
  const [components, projects] = await Promise.all([
    prisma.component.findMany({
      where: { isActive: true },
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
      },
    }),
    prisma.project.findMany({
      where: { deletedAt: null, isPublic: true },
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
      },
    }),
  ]);

  const chunks = [
    ...components.map(chunkComponent),
    ...projects.map(chunkProject),
  ];

  const stored = await embedAndStore(chunks);
  console.info(`Indexed ${stored} catalog chunk(s): ${components.length} component(s), ${projects.length} project(s).`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown indexing failure";
    console.error(`Catalog indexing failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
