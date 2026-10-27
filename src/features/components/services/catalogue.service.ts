import { prisma } from "../../../lib/prisma.js";
import { catalogueImageSchema } from "../validators/catalogue-images.js";
import { ValidationError } from "../../../utils/types.js";
import { configurationSchema } from "../validators/catalogue.js";
import { emptyConfiguration } from "../types/catalogue.js";
import type { ProductConfiguration } from "../types/catalogue.js";

type Assignment = {
  imageUrl?: string | null;
  subcategoryId?: string | null;
  category?: string;
  subcategory?: string;
  configuration?: unknown;
  isActive?: boolean;
};
/** Resolve names only for older import clients; persist a real relation for every new listing. */
export async function resolveCatalogueAssignment(
  data: Assignment,
  existing?: Assignment,
) {
  if (data.imageUrl && !catalogueImageSchema.safeParse(data.imageUrl).success)
    throw new ValidationError("Product photos must use an Albumo CDN URL");
  const namesChanged = data.category !== undefined || data.subcategory !== undefined;
  const id = data.subcategoryId || (!namesChanged ? existing?.subcategoryId : undefined);
  const leaf = id
    ? await prisma.subcategory.findUnique({ where: { id }, include: { category: true } })
    : await prisma.subcategory.findFirst({
        where: {
          name: {
            equals: data.subcategory ?? existing?.subcategory ?? "",
            mode: "insensitive",
          },
          category: {
            name: {
              equals: data.category ?? existing?.category ?? "",
              mode: "insensitive",
            },
          },
        },
        include: { category: true },
      });
  if (!leaf)
    throw new ValidationError(
      "Choose a category within an existing super category before saving this product",
    );
  if (
    data.subcategoryId &&
    ((data.category && data.category !== leaf.category.name) ||
      (data.subcategory && data.subcategory !== leaf.name))
  )
    throw new ValidationError(
      "The selected category does not belong to this super category",
    );
  if (
    (data.isActive ?? existing?.isActive ?? true) &&
    (!leaf.isActive || !leaf.category.isActive)
  )
    throw new ValidationError(
      "Published products need an active category and super category",
    );
  const moved = existing?.subcategoryId && existing.subcategoryId !== leaf.id;
  if (moved && data.configuration === undefined)
    throw new ValidationError(
      "Review and save product options when moving a product to another category",
    );
  const configuration = configurationSchema.safeParse(
    data.configuration ??
      existing?.configuration ??
      leaf.configuration ??
      emptyConfiguration,
  );
  if (!configuration.success)
    throw new ValidationError(
      configuration.error.issues
        .map((issue) => issue.path.join(".") + ": " + issue.message)
        .join("; "),
    );
  return {
    subcategoryId: leaf.id,
    category: leaf.category.name,
    subcategory: leaf.name,
    configuration: configuration.data,
  };
}

export const publishedProductWhere = {
  isActive: true,
  catalogueCategory: { is: { isActive: true, category: { isActive: true } } },
};
/** Explicit public projection excludes supplier links, costs, stock and internal flags. */
export async function getPublicCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      subcategories: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, description: true, imageUrl: true },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function getPublicCatalogue() {
  const categories = await getPublicCategories();
  const products = await prisma.component.findMany({
    where: publishedProductWhere,
    orderBy: [{ isBestSeller: "desc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      imageUrl: true,
      specifications: true,
      countryOfOrigin: true,
      warranty: true,
      typicalUseCase: true,
      subcategoryId: true,
      unitPriceCents: true,
      discountedPriceCents: true,
      isBestSeller: true,
      configuration: true,
      catalogueCategory: {
        select: { id: true, name: true, category: { select: { id: true, name: true } } },
      },
      media: {
        where: { type: "IMAGE" },
        orderBy: { sortOrder: "asc" },
        select: { id: true, url: true },
      },
    },
  });
  return {
    categories,
    products: products.map(({ catalogueCategory, configuration, ...product }) => ({
      ...product,
      superCategoryId: catalogueCategory!.category.id,
      superCategoryName: catalogueCategory!.category.name,
      categoryId: catalogueCategory!.id,
      categoryName: catalogueCategory!.name,
      configuration: configurationSchema.parse(
        configuration ?? emptyConfiguration,
      ) as ProductConfiguration,
    })),
  };
}
