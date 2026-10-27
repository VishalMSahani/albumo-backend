import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { referenceProduct } from "../src/features/components/data/reference-products.ts";
import {
  parseProductCsv,
  productsToCsv,
  productTemplateCsv,
  csvCell,
} from "../src/features/components/validators/product-csv.ts";
import { emptyConfiguration } from "../src/features/components/types/catalogue.ts";

const names = [
  "Travel Books",
  "Wedding Albums",
  "Birthday Albums",
  "Everyday Stories",
  "Canvas Prints",
  "Framed Prints",
  "Acrylic Prints",
  "Photo Mugs",
  "Photo Cushions",
  "Calendars",
  "Small Keepsakes",
];
const leaves = names.map((name, i) => ({
  id: "cmg000000000000000000000" + String(i).padStart(2, "0"),
  name,
  category: {
    name: i < 4 ? "Photo Albums" : i < 7 ? "Wall Art" : "Gifts",
    isActive: true,
  },
  configuration: null,
  isActive: true,
}));
test("all 11 templates have distinct relevant choices, draft visibility and lossless CSV configuration", () => {
  const products = leaves.map(referenceProduct);
  const exported = parseProductCsv(productsToCsv(products));
  for (let i = 0; i < products.length; i++) {
    assert.equal(exported[i].data.isActive, false);
    assert.deepEqual(exported[i].data.configuration, products[i].configuration);
    assert.equal(exported[i].data.subcategoryId, leaves[i].id);
    assert.equal(exported[i].data.imageUrl, "");
  }
  assert(products[1].configuration.groups.some((g) => g.kind === "binding"));
  assert(products[5].configuration.groups.some((g) => g.kind === "frame"));
  assert(products[7].configuration.groups.some((g) => g.label === "Capacity"));
  assert(!products[7].configuration.groups.some((g) => g.kind === "cover"));
  const rows = parseProductCsv(productTemplateCsv(leaves));
  assert.equal(rows.length, 11);
  assert(rows.every((row) => row.data.sku.startsWith("NEW-")));
});
test("blank option data preserves configuration; explicit invalid JSON, dimensions, modes and external images fail", () => {
  const [preserved] = parseProductCsv(
    "name,sku,unitPrice,configuration,stockQuantity,isActive\nTravel Book,TRAVEL,100,,,",
  );
  assert.equal(preserved.data.configuration, undefined);
  assert.equal(preserved.data.stockQuantity, undefined);
  assert.equal(preserved.data.isActive, undefined);
  const config = referenceProduct(leaves[0]).configuration;
  for (const value of [
    "{bad json",
    "null",
    JSON.stringify({ ...config, format: "robot" }),
  ])
    assert.throws(() =>
      parseProductCsv(
        "name,sku,unitPrice,configuration\nTravel Book,TRAVEL,100," +
          csvCell(value),
      ),
    );
  assert.throws(() =>
    parseProductCsv(
      "name,sku,unitPrice,configurationSource\nTravel Book,TRAVEL,100,custom",
    ),
  );
  assert.throws(() =>
    parseProductCsv(
      "name,sku,unitPrice,imageUrl\nTravel Book,TRAVEL,100,https://outside.invalid/photo.jpg",
    ),
  );
});
const mock = {};
globalThis.__albumoImportPrisma = mock;
const bundle = await build({
  stdin: {
    contents:
      "export { bulkImportController, bulkExportController, productTemplateController } from './src/controller/bulk.ts'; export { prepareProductImportRow } from './src/features/components/services/product-import.service.ts';",
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "isolated-import",
      setup(builder) {
        builder.onResolve({ filter: /lib\/prisma\.js$/ }, () => ({
          path: "prisma",
          namespace: "fixture",
        }));
        builder.onResolve({ filter: /lib\/redis\.js$/ }, () => ({
          path: "redis",
          namespace: "fixture",
        }));
        builder.onResolve(
          { filter: /services\/storage\.service\.js$/ },
          () => ({ path: "storage", namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "prisma"
              ? "export const prisma=globalThis.__albumoImportPrisma;"
              : path === "redis"
                ? "export async function cacheInvalidate() {}"
                : "export const FileType={}; export async function uploadFile(){throw Error('No uploads in tests');}",
          loader: "js",
        }));
      },
    },
  ],
});
const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
let products, writes;
function reset() {
  products = [];
  writes = 0;
  mock.subcategory = {
    findUnique: async (q) =>
      leaves.find((leaf) => leaf.id === q.where.id) ?? null,
    findFirst: async (q) =>
      leaves.find(
        (leaf) =>
          leaf.name.toLowerCase() === q.where.name.equals.toLowerCase() &&
          leaf.category.name.toLowerCase() ===
            q.where.category.name.equals.toLowerCase(),
      ) ?? null,
    findMany: async (q) =>
      leaves.filter((leaf) => !q.where?.id || leaf.id === q.where.id),
  };
  mock.component = {
    findUnique: async (q) =>
      products.find((product) =>
        Object.entries(q.where).every(([key, value]) => product[key] === value),
      ) ?? null,
    findMany: async () => products,
    create: async (q) => {
      writes++;
      const product = {
        id: "product-" + products.length,
        ...structuredClone(q.data),
      };
      products.push(product);
      return product;
    },
    update: async (q) => {
      writes++;
      const product = products.find((p) => p.id === q.where.id);
      Object.assign(product, structuredClone(q.data));
      return product;
    },
  };
}
function response() {
  return {
    code: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}
async function upload(csv, dryRun = false) {
  const res = response();
  await api.bulkImportController(
    { body: { csv }, query: dryRun ? { dryRun: "true" } : {} },
    res,
  );
  return res;
}
test("preview writes nothing; import creates 11 drafts; repeating it updates the same SKUs without duplicates", async () => {
  reset();
  const csv = productTemplateCsv(leaves);
  const preview = await upload(csv, true);
  assert.equal(preview.code, 200);
  assert.equal(writes, 0);
  assert.equal(preview.body.data.previews.length, 11);
  const first = await upload(csv);
  assert.equal(first.body.data.createdCount, 11);
  assert.equal(products.length, 11);
  assert(
    products.every(
      (product) =>
        product.isActive === false && product.productType === "OTHER",
    ),
  );
  const second = await upload(csv);
  assert.equal(second.body.data.updatedCount, 11);
  assert.equal(products.length, 11);
});
test("preserve keeps product choices; category resets to destination preset; category moves require a decision", async () => {
  reset();
  await upload(productTemplateCsv([leaves[0]]));
  const original = structuredClone(products[0].configuration);
  const sku = products[0].sku;
  const keep = await upload(
    "name,sku,unitPrice,configurationSource\nEdited Travel Book," +
      sku +
      ",1600,preserve",
  );
  assert.equal(keep.body.data.errors.length, 0);
  assert.deepEqual(products[0].configuration, original);
  const move =
    "name,sku,unitPrice,subcategoryId,configurationSource\nEdited Travel Book," +
    sku +
    ",1600," +
    leaves[7].id +
    ",";
  assert.match(
    (await upload(move + "preserve", true)).body.data.errors[0].error,
    /Review and save/,
  );
  const preset = referenceProduct(leaves[7]).configuration;
  leaves[7].configuration = preset;
  const resetResult = await upload(move + "category");
  assert.equal(resetResult.body.data.errors.length, 0);
  assert.deepEqual(products[0].configuration, preset);
  leaves[7].configuration = null;
});
test("invalid categories and ID/SKU conflicts are reported; successful rows remain retryable", async () => {
  reset();
  const valid = parseProductCsv(productTemplateCsv([leaves[0]]))[0];
  const broken = {
    ...referenceProduct(leaves[1]),
    subcategoryId: "cmg99999999999999999999999",
  };
  const result = await upload(
    productsToCsv([referenceProduct(leaves[0]), broken]),
  );
  assert.equal(result.body.data.createdCount, 1);
  assert.equal(result.body.data.errors[0].row, 3);
  assert.equal(products.length, 1);
  const noSku = await upload(
    "name,unitPrice,subcategoryId\nNew Book,100," + leaves[0].id,
    true,
  );
  assert.match(noSku.body.data.errors[0].error, /unique SKU/);
  await upload(productsToCsv([referenceProduct(leaves[1])]));
  const conflict = await upload(
    "id,name,sku,unitPrice\n" +
      products[0].id +
      ",Wrong target," +
      products[1].sku +
      ",100",
    true,
  );
  assert.match(conflict.body.data.errors[0].error, /different products/);
  assert.equal(valid.configurationSource, "custom");
});
test("inactive ancestry cannot publish and bad files perform no writes", async () => {
  reset();
  leaves[0].isActive = false;
  const active = { ...referenceProduct(leaves[0]), isActive: true };
  const blocked = await upload(productsToCsv([active]));
  assert.match(blocked.body.data.errors[0].error, /active category/);
  assert.equal(writes, 0);
  const draft = await upload(productsToCsv([{ ...active, isActive: false }]));
  assert.equal(draft.body.data.createdCount, 1);
  leaves[0].isActive = true;
  const before = writes;
  const invalid = await upload(
    'name,unitPrice,configuration\nBad Book,100,"broken"',
  );
  assert.equal(invalid.code, 400);
  assert.equal(writes, before);
});
test("exports preserve full configuration and category-filtered templates contain only that category", async () => {
  reset();
  await upload(productTemplateCsv([leaves[0], leaves[7]]));
  const res = response();
  await api.bulkExportController({}, res);
  const rows = parseProductCsv(res.body);
  assert.deepEqual(rows[1].data.configuration, products[1].configuration);
  assert(res.headers["Content-Disposition"].includes("albumo"));
  const template = response();
  await api.productTemplateController(
    { query: { subcategoryId: leaves[7].id } },
    template,
  );
  assert.equal(parseProductCsv(template.body).length, 1);
  assert.equal(
    parseProductCsv(template.body)[0].data.subcategoryId,
    leaves[7].id,
  );
});
