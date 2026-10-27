import { z } from "zod";
import { ComponentProductType } from "../../../generated/prisma/enums.js";
import { productDetailsSchema } from "./product-details.js";
import { configurationSchema } from "./catalogue.js";
import { catalogueImageSchema } from "./catalogue-images.js";
import {
  referenceProduct,
  type ReferenceCategory,
} from "../data/reference-products.js";

export const productCsvHeaders = [
  "id",
  "name",
  "slug",
  "sku",
  "category",
  "subcategory",
  "subcategoryId",
  "configurationSource",
  "configuration",
  "brand",
  "unitPrice",
  "discountedPrice",
  "stockQuantity",
  "isBestSeller",
  "isActive",
  "tags",
  "imageUrl",
  "description",
  "typicalUseCase",
  "specifications",
  "countryOfOrigin",
  "warranty",
];

const url = z
  .string()
  .refine((value) => {
    if (!value) return true;
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Use an http(s) URL")
  .optional();
const blankAsMissing = (value: unknown) => (value === "" ? undefined : value);
const configurationInput = z.preprocess((value) => {
  if (value === "") return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, configurationSchema.optional());
const flag = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1")
  .optional();
const price = z
  .string()
  .regex(
    /^\d+(?:\.\d{1,2})?$/,
    "Use a nonnegative INR amount with up to 2 decimals",
  )
  .transform((value) => Math.round(Number(value) * 100))
  .pipe(z.number().int().max(100000000));
const schema = z
  .object({
    ...productDetailsSchema.shape,
    id: z.string().max(100).optional(),
    name: z.string().min(3).max(200),
    slug: z.string().max(100).optional(),
    sku: z.string().max(50).optional(),
    category: z.preprocess(
      blankAsMissing,
      z.string().min(1).max(200).optional(),
    ),
    subcategory: z.preprocess(
      blankAsMissing,
      z.string().min(1).max(200).optional(),
    ),
    subcategoryId: z.preprocess(blankAsMissing, z.string().cuid().optional()),
    configurationSource: z.preprocess(
      blankAsMissing,
      z.enum(["custom", "category", "preserve"]).optional(),
    ),
    configuration: configurationInput,
    brand: z.string().max(200).optional(),
    productType: z.enum(ComponentProductType).optional(),
    unitPrice: price,
    discountedPrice: z
      .union([z.literal("").transform(() => null), price])
      .optional(),
    stockQuantity: z.preprocess(
      blankAsMissing,
      z
        .string()
        .regex(/^\d+$/, "Stock must be a nonnegative whole number")
        .transform(Number)
        .pipe(z.number().int().max(2147483647))
        .optional(),
    ),
    isBestSeller: z.preprocess(blankAsMissing, flag),
    isRobomaniacItem: z.preprocess(blankAsMissing, flag),
    isSoftware: z.preprocess(blankAsMissing, flag),
    isActive: z.preprocess(blankAsMissing, flag),
    tags: z
      .string()
      .max(5000)
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      )
      .optional(),
    imageUrl: z.union([z.literal(""), catalogueImageSchema]).optional(),
    vendorLink: url,
    description: z.string().max(100000).optional(),
    typicalUseCase: z.string().max(5000).optional(),
  })
  .strict()
  .superRefine((data, context) => {
    if (data.configurationSource === "custom" && !data.configuration)
      context.addIssue({
        code: "custom",
        path: ["configuration"],
        message: "Custom options need a complete configuration",
      });
    if (
      data.configuration &&
      data.configurationSource &&
      data.configurationSource !== "custom"
    )
      context.addIssue({
        code: "custom",
        path: ["configurationSource"],
        message:
          "Use custom for explicit options, or remove configuration to use category/preserve",
      });
    if (data.discountedPrice != null && data.discountedPrice >= data.unitPrice)
      context.addIssue({
        code: "custom",
        path: ["discountedPrice"],
        message: "Sale price must be lower than unit price",
      });
  });

/** Single-pass CSV parser: quoted commas, escaped quotes, CRLF and multiline cells stay intact. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const input = text.replace(/^\uFEFF/, "");
  function endCell() {
    row.push(cell);
    cell = "";
    closed = false;
  }
  function endRow() {
    endCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === ",") {
      endCell();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      endRow();
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed && char.trim())
      throw new Error("Unexpected text after a quoted CSV cell");
    else if (char === '"') throw new Error("Quote inside an unquoted CSV cell");
    else if (!closed) cell += char;
  }
  if (quoted) throw new Error("Unclosed quote in CSV");
  if (cell || row.length || closed) endRow();
  return rows;
}

export function parseProductCsv(text: string) {
  const [rawHeaders, ...rows] = parseCsv(text);
  if (!rawHeaders || !rows.length)
    throw new Error("Add column headers and at least one product row");
  if (rows.length > 500)
    throw new Error("Import at most 500 products per file");
  const aliases: Record<string, string> = {
    title: "name",
    price: "unitPrice",
    saleprice: "discountedPrice",
    stock: "stockQuantity",
    desc: "description",
    image: "imageUrl",
    bestseller: "isBestSeller",
    robomaniac: "isRobomaniacItem",
    software: "isSoftware",
    active: "isActive",
  };
  const headers = rawHeaders.map((header) => {
    const normalized = header
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return (
      [
        ...productCsvHeaders,
        "productType",
        "isRobomaniacItem",
        "isSoftware",
        "vendorLink",
      ].find((key) => key.toLowerCase() === normalized) ||
      aliases[normalized] ||
      header.trim()
    );
  });
  if (new Set(headers).size !== headers.length)
    throw new Error("Duplicate CSV columns");
  if (!headers.includes("name") || !headers.includes("unitPrice"))
    throw new Error("name and unitPrice columns are required (prices in INR)");
  const ids = new Set<string>(),
    skus = new Set<string>();
  return rows.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length)
      throw new Error(
        "Row " + rowNumber + ": column count does not match the header",
      );
    const result = schema.safeParse(
      Object.fromEntries(
        headers.map((key, i) => [key, values[i]?.trim() ?? ""]),
      ),
    );
    if (!result.success)
      throw new Error(
        "Row " +
          rowNumber +
          ": " +
          result.error.issues
            .map((issue) => issue.path.join(".") + " " + issue.message)
            .join("; "),
      );
    const { id, unitPrice, discountedPrice, configurationSource, ...fields } =
      result.data;
    if (!fields.sku) delete fields.sku;
    if (!fields.slug) delete fields.slug;
    if ((id && ids.has(id)) || (fields.sku && skus.has(fields.sku)))
      throw new Error(
        "Row " + rowNumber + ": duplicate product ID or SKU in this file",
      );
    if (id) ids.add(id);
    if (fields.sku) skus.add(fields.sku);
    const data = {
      ...fields,
      unitPriceCents: unitPrice,
      ...(discountedPrice !== undefined
        ? { discountedPriceCents: discountedPrice }
        : {}),
    };
    const defined = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    ) as { [K in keyof typeof data]: Exclude<(typeof data)[K], undefined> };
    return { rowNumber, id, configurationSource, data: defined };
  });
}

export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  // Prevent spreadsheet applications treating exported text as executable formulas.
  const safe = /^[=+@\-\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

/** Shared export path keeps per-product customisations intact in CSV and Excel downloads. */
export function productsToCsv(products: Record<string, unknown>[]) {
  return [
    productCsvHeaders.join(","),
    ...products.map((product) => {
      const values: Record<string, unknown> = {
        ...product,
        unitPrice: (Number(product.unitPriceCents) / 100).toFixed(2),
        discountedPrice:
          product.discountedPriceCents == null
            ? ""
            : (Number(product.discountedPriceCents) / 100).toFixed(2),
        tags: Array.isArray(product.tags)
          ? product.tags.join(",")
          : product.tags,
        specifications: JSON.stringify(product.specifications ?? []),
        configurationSource: product.configuration ? "custom" : "preserve",
        configuration: product.configuration
          ? JSON.stringify(product.configuration)
          : "",
      };
      return productCsvHeaders.map((key) => csvCell(values[key])).join(",");
    }),
  ].join("\r\n");
}
export function productTemplateCsv(categories: ReferenceCategory[] = []) {
  const examples = categories.length
    ? categories
    : [
        {
          id: "cmg00000000000000000000001",
          name: "Travel Books",
          category: { name: "Photo Albums" },
          configuration: null,
        },
      ];
  return productsToCsv(
    examples.map((category) => ({
      ...referenceProduct(category),
      id: "",
      slug: "",
      sku: "NEW-" + category.id,
      name: category.name + " - replace example",
      subcategoryId: categories.length ? category.id : "",
    })),
  );
}
