import { prisma } from "../../../lib/prisma.js";
import { resolveCatalogueAssignment } from "./catalogue.service.js";
import { productPricingSchema } from "../validators/product-pricing.js";
import type { parseProductCsv } from "../validators/product-csv.js";

export type ProductImportRow = ReturnType<typeof parseProductCsv>[number];
export async function prepareProductImportRow(row: ProductImportRow) {
  const byId = row.id
    ? await prisma.component.findUnique({ where: { id: row.id } })
    : null;
  const bySku = row.data.sku
    ? await prisma.component.findUnique({ where: { sku: row.data.sku } })
    : null;
  if (row.id && !byId)
    throw new Error(
      "Product ID does not exist; remove ID to create a new product",
    );
  if (byId && bySku && byId.id !== bySku.id)
    throw new Error("ID and SKU refer to different products");
  const existing = byId || bySku;
  if (!existing && !row.data.sku)
    throw new Error(
      "New products need a unique SKU so retrying an upload cannot create duplicates",
    );
  const data = {
    ...row.data,
    ...(!existing
      ? {
          isActive: row.data.isActive ?? false,
          productType: row.data.productType ?? ("OTHER" as const),
        }
      : {}),
  };
  // Category mode explicitly resets options to the destination category preset.
  // Preserve mode (or blank configuration) retains existing options, and inherits for new products.
  const { configuration: _configuration, ...previous } = existing ?? {};
  const assignment = await resolveCatalogueAssignment(
    data,
    row.configurationSource === "category"
      ? { ...previous, subcategoryId: null }
      : (existing ?? undefined),
  );
  const pricing = productPricingSchema.safeParse({ ...existing, ...data });
  if (!pricing.success)
    throw new Error(
      pricing.error.issues.map((issue) => issue.message).join("; "),
    );
  return { row, existing, data: { ...data, ...assignment } };
}
