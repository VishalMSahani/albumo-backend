import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { configurationSchema } from "../src/features/components/validators/catalogue.ts";
import { emptyConfiguration } from "../src/features/components/types/catalogue.ts";

const configuration = {
  ...emptyConfiguration,
  personalizationEnabled: true,
  allowPhotoUpload: true,
  groups: [
    {
      id: "size",
      label: "Dimensions",
      kind: "dimension",
      required: true,
      defaultOptionId: "square",
      options: [
        {
          id: "square",
          label: "Square",
          description: "A compact album",
          width: 8,
          height: 8,
          unit: "in",
          priceAdjustmentCents: 30000,
        },
      ],
    },
  ],
};
test("option validation rejects invalid prices, dimensions, duplicates and unavailable defaults", () => {
  assert(configurationSchema.safeParse(configuration).success);
  for (const change of [
    (c) => {
      c.groups[0].options[0].priceAdjustmentCents = -1;
    },
    (c) => {
      c.groups[0].options[0].priceAdjustmentCents = 0.5;
    },
    (c) => {
      delete c.groups[0].options[0].width;
    },
    (c) => {
      c.groups[0].defaultOptionId = "missing";
    },
    (c) => {
      c.groups.push(structuredClone(c.groups[0]));
    },
    (c) => {
      c.groups[0].options.push(structuredClone(c.groups[0].options[0]));
    },
    (c) => {
      c.groups[0].options = [];
    },
    (c) => {
      c.personalizationEnabled = false;
    },
    (c) => {
      c.groups[0].options[0].imageUrl = "https://external.invalid/image.jpg";
    },
  ]) {
    const invalid = structuredClone(configuration);
    change(invalid);
    assert.equal(configurationSchema.safeParse(invalid).success, false);
  }
});
const mock = {};
globalThis.__albumoCataloguePrisma = mock;
const bundled = await build({
  stdin: {
    contents:
      "export * from './src/features/components/services/catalogue.service.ts'; export * from './src/features/components/services/component.service.ts';",
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "catalogue-prisma",
      setup(builder) {
        builder.onResolve({ filter: /lib\/prisma\.js$/ }, () => ({
          path: "prisma",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const prisma = globalThis.__albumoCataloguePrisma;",
          loader: "js",
        }));
      },
    },
  ],
});
const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
const leaf = {
  id: "cmg00000000000000000000001",
  name: "Travel Books",
  isActive: true,
  configuration,
  category: { id: "parent", name: "Photo Albums", isActive: true },
};
test("category assignment requires a real child, checks parent and snapshots its options", async () => {
  mock.subcategory = { findUnique: async () => leaf, findFirst: async () => null };
  await assert.rejects(
    api.resolveCatalogueAssignment({ category: "Missing", subcategory: "Missing" }),
    /Choose a category/,
  );
  await assert.rejects(
    api.resolveCatalogueAssignment({ subcategoryId: leaf.id, category: "Gifts" }),
    /does not belong/,
  );
  const saved = await api.resolveCatalogueAssignment({ subcategoryId: leaf.id });
  assert.equal(saved.category, "Photo Albums");
  assert.deepEqual(saved.configuration, configuration);
  assert.notEqual(saved.configuration, configuration);
  const previous = { subcategoryId: "different", configuration, isActive: true };
  await assert.rejects(
    api.resolveCatalogueAssignment({ subcategoryId: leaf.id }, previous),
    /Review and save/,
  );
  assert.equal(
    (
      await api.resolveCatalogueAssignment(
        { subcategoryId: leaf.id, configuration: emptyConfiguration },
        previous,
      )
    ).configuration.groups.length,
    0,
  );
});
test("hidden parents/categories cannot publish; category template edits do not overwrite saved options", async () => {
  const hidden = { ...leaf, category: { ...leaf.category, isActive: false } };
  mock.subcategory = { findUnique: async () => hidden };
  await assert.rejects(
    api.resolveCatalogueAssignment({ subcategoryId: leaf.id, isActive: true }),
    /active category/,
  );
  assert.equal(
    (await api.resolveCatalogueAssignment({ subcategoryId: leaf.id, isActive: false }))
      .subcategoryId,
    leaf.id,
  );
  mock.subcategory.findUnique = async () => ({
    ...leaf,
    configuration: emptyConfiguration,
  });
  const retained = await api.resolveCatalogueAssignment(
    { isActive: true },
    { subcategoryId: leaf.id, configuration },
  );
  assert.deepEqual(retained.configuration, configuration);
});
test("product create/edit round trip retains option prices and stable category IDs", async () => {
  let stored;
  mock.subcategory = { findUnique: async () => leaf };
  mock.component = {
    findUnique: async (query) => (query.where.id ? stored : null),
    create: async (query) => (stored = { id: "product", ...query.data }),
    update: async (query) => (stored = { ...stored, ...query.data }),
  };
  const product = await api.createComponent({
    name: "Travel album",
    subcategoryId: leaf.id,
    unitPriceCents: 100000,
    configuration,
    isActive: false,
  });
  assert.equal(product.subcategoryId, leaf.id);
  assert.equal(product.configuration.groups[0].options[0].width, 8);
  const edited = structuredClone(configuration);
  edited.groups[0].options[0].priceAdjustmentCents = 45000;
  const updated = await api.updateComponent(product.id, { configuration: edited });
  assert.equal(updated.configuration.groups[0].options[0].priceAdjustmentCents, 45000);
  assert.equal(product.configuration.groups[0].options[0].priceAdjustmentCents, 30000);
});
test("public catalogue and detail queries enforce publication and active ancestry", async () => {
  mock.category = {
    findMany: async (query) => {
      assert.equal(query.where.isActive, true);
      assert.equal(query.select.subcategories.where.isActive, true);
      return [];
    },
  };
  mock.component = {
    findMany: async (query) => {
      assert.deepEqual(query.where, api.publishedProductWhere);
      assert.equal(query.select.vendorLink, undefined);
      return [];
    },
    findUnique: async (query) => {
      assert.equal(query.where.isActive, true);
      assert(query.where.catalogueCategory);
      return null;
    },
  };
  assert.deepEqual(await api.getPublicCatalogue(), { categories: [], products: [] });
  await assert.rejects(api.getComponentById("hidden"), /not found/);
});
