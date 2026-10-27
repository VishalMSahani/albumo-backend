import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import { emptyConfiguration } from "../src/features/components/types/catalogue.js";
import { getPublicCatalogue } from "../src/features/components/services/catalogue.service.js";
const marker = "catalogue-verification-" + Date.now();
const rollback = new Error("verification rollback");
try {
  const before = await prisma.component.count();
  try {
    await prisma.$transaction(
      async (tx) => {
        const parent = await tx.category.create({
          data: { name: marker, isActive: false },
        });
        const child = await tx.subcategory.create({
          data: {
            categoryId: parent.id,
            name: "Test category",
            configuration: emptyConfiguration,
          },
        });
        const config = {
          ...emptyConfiguration,
          groups: [
            {
              id: "size",
              label: "Size",
              kind: "dimension",
              required: true,
              defaultOptionId: "square",
              options: [
                {
                  id: "square",
                  label: "8 x 8",
                  description: "Square",
                  width: 8,
                  height: 8,
                  unit: "in",
                  priceAdjustmentCents: 25000,
                },
              ],
            },
          ],
        };
        const product = await tx.component.create({
          data: {
            name: marker,
            slug: marker,
            subcategoryId: child.id,
            category: parent.name,
            subcategory: child.name,
            unitPriceCents: 100000,
            isActive: false,
            configuration: config,
          },
        });
        const saved = await tx.component.findUniqueOrThrow({
          where: { id: product.id },
          include: { catalogueCategory: { include: { category: true } } },
        });
        assert.equal(saved.catalogueCategory?.category.id, parent.id);
        assert.deepEqual(saved.configuration, config);
        throw rollback;
      },
      { timeout: 15000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.component.count(), before);
  assert.equal(await prisma.category.count({ where: { name: marker } }), 0);
  const catalogue = await getPublicCatalogue();
  console.log(
    JSON.stringify({
      verified: true,
      superCategories: catalogue.categories.length,
      categories: catalogue.categories.reduce((n, c) => n + c.subcategories.length, 0),
      publishedProducts: catalogue.products.length,
      testRecordsPersisted: false,
    }),
  );
} finally {
  await prisma.$disconnect();
}
