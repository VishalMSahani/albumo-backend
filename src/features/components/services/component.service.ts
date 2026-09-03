/**
 * Component Service
 * Business logic for component management
 */

import { prisma } from "../../../lib/prisma.js";
import { NotFoundError, ConflictError } from "../../../utils/types.js";
import type {
  CreateComponentRequest,
  UpdateComponentRequest,
  ComponentFilters,
  ComponentResponse,
  ComponentCategoryNode,
  ComponentCategorySummaryNode,
  PaginatedComponentsResponse,
} from "../types/component.types.js";

/**
 * Generate a URL-safe slug from a component name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

/**
 * Generate a unique slug, appending -2, -3, etc. on collision
 */
export async function generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
  const baseSlug = generateSlug(name);
  let slug = baseSlug;
  let attempt = 1;

  while (true) {
    const existing = await prisma.component.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing || (excludeId && existing.id === excludeId)) {
      return slug;
    }

    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }
}

/**
 * Format component for response
 */
function formatComponent(component: any): ComponentResponse {
  return {
    id: component.id,
    slug: component.slug,
    name: component.name,
    sku: component.sku,
    description: component.description,
    typicalUseCase: component.typicalUseCase,
    vendorLink: component.vendorLink,
    imageUrl: component.imageUrl,
    category: component.category,
    subcategory: component.subcategory,
    productType: component.productType,
    brand: component.brand,
    tags: component.tags || [],
    isBestSeller: component.isBestSeller,
    isRobomaniacItem: component.isRobomaniacItem,
    isSoftware: component.isSoftware,
    unitPriceCents: component.unitPriceCents,
    discountedPriceCents: component.discountedPriceCents ?? null,
    unitPrice: component.unitPriceCents / 100, // Convert to rupees
    stockQuantity: component.stockQuantity,
    isActive: component.isActive,
    createdAt: component.createdAt,
    updatedAt: component.updatedAt,
  };
}

/**
 * Create a new component (Admin only)
 */
export async function createComponent(data: CreateComponentRequest): Promise<ComponentResponse> {
  // Check if SKU already exists
  if (data.sku) {
    const existing = await prisma.component.findUnique({
      where: { sku: data.sku },
    });

    if (existing) {
      throw new ConflictError(`Component with SKU "${data.sku}" already exists`);
    }
  }

  // Auto-generate or sanitize a unique slug
  const slug = data.slug ? await generateUniqueSlug(data.slug) : await generateUniqueSlug(data.name);

  const component = await prisma.component.create({
    data: {
      name: data.name,
      slug,
      sku: data.sku || null,
      description: data.description || null,
      typicalUseCase: data.typicalUseCase || null,
      vendorLink: data.vendorLink || null,
      imageUrl: data.imageUrl || null,
      category: data.category || "Electronics Components",
      subcategory: data.subcategory || "General",
      productType: data.productType || "ELECTRONICS_COMPONENT",
      brand: data.brand || null,
      tags: data.tags || [],
      isBestSeller: data.isBestSeller || false,
      isRobomaniacItem: data.isRobomaniacItem || false,
      isSoftware: data.isSoftware || false,
      unitPriceCents: data.unitPriceCents,
      discountedPriceCents: data.discountedPriceCents ?? null,
      stockQuantity: data.stockQuantity || 0,
      isActive: data.isActive !== undefined ? data.isActive : true,
    },
  });

  return formatComponent(component);
}

/**
 * Get all components with filters and pagination
 */
export async function getComponents(
  filters: ComponentFilters
): Promise<PaginatedComponentsResponse> {
  const {
    search,
    isActive,
    category,
    subcategory,
    productType,
    isBestSeller,
    isRobomaniacItem,
    isSoftware,
    minPrice,
    maxPrice,
    inStock,
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = filters;

  // Build where clause
  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { brand: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
      { subcategory: { contains: search, mode: "insensitive" } },
      { tags: { has: search } },
    ];
  }

  if (isActive !== undefined) {
    where.isActive = isActive;
  } else {
    where.isActive = true;
  }

  if (category) {
    where.category = { equals: category, mode: "insensitive" };
  }

  if (subcategory) {
    where.subcategory = { equals: subcategory, mode: "insensitive" };
  }

  if (productType) {
    where.productType = productType;
  }

  if (isBestSeller !== undefined) {
    where.isBestSeller = isBestSeller;
  }

  if (isRobomaniacItem !== undefined) {
    where.isRobomaniacItem = isRobomaniacItem;
  }

  if (isSoftware !== undefined) {
    where.isSoftware = isSoftware;
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    where.unitPriceCents = {};
    if (minPrice !== undefined) where.unitPriceCents.gte = minPrice;
    if (maxPrice !== undefined) where.unitPriceCents.lte = maxPrice;
  }

  if (inStock) {
    where.stockQuantity = { gt: 0 };
  }

  // Build orderBy clause
  const orderBy: any = {};
  if (sortBy === "price") {
    orderBy.unitPriceCents = sortOrder;
  } else if (sortBy === "stock") {
    orderBy.stockQuantity = sortOrder;
  } else if (sortBy === "name") {
    orderBy.name = sortOrder;
  } else {
    orderBy.createdAt = sortOrder;
  }

  // Get total count
  const total = await prisma.component.count({ where });

  // Get paginated results
  const components = await prisma.component.findMany({
    where,
    orderBy,
    skip: (page - 1) * limit,
    take: limit,
  });

  const totalPages = Math.ceil(total / limit);

  return {
    components: components.map(formatComponent),
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

/**
 * Get a single component by ID
 */
export async function getComponentById(id: string): Promise<ComponentResponse> {
  const component = await prisma.component.findUnique({
    where: { id },
    include: { media: true },
  });

  if (!component) {
    throw new NotFoundError("Component not found");
  }

  return formatComponent(component);
}

/**
 * Get a single component by slug (for SEO-friendly public URLs)
 */
export async function getComponentBySlug(slug: string): Promise<ComponentResponse> {
  const component = await prisma.component.findUnique({
    where: { slug },
    include: { media: true },
  });

  if (!component) {
    throw new NotFoundError(`Component not found`);
  }

  return formatComponent(component);
}

/**
 * Get a single component by SKU
 */
export async function getComponentBySku(sku: string): Promise<ComponentResponse> {
  const component = await prisma.component.findUnique({
    where: { sku },
    include: { media: true },
  });

  if (!component) {
    throw new NotFoundError(`Component with SKU ${sku} not found`);
  }

  return formatComponent(component);
}

/**
 * Get category > subcategory > products tree for browse-all-categories.
 */
export async function getComponentCategoryTree(): Promise<ComponentCategoryNode[]> {
  // Get all active categories and their subcategories
  const dbCategories = await prisma.category.findMany({
    where: { isActive: true },
    include: {
      subcategories: {
        where: { isActive: true },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  // Get all active components
  const components = await prisma.component.findMany({
    where: { isActive: true },
  });

  const categoryTree: ComponentCategoryNode[] = [];

  for (const dbCat of dbCategories) {
    const subnodes = dbCat.subcategories.map((sub) => {
      // Find components matching this subcategory AND category name
      const matchingComponents = components
        .filter(
          (c) =>
            c.category.toLowerCase() === dbCat.name.toLowerCase() &&
            c.subcategory.toLowerCase() === sub.name.toLowerCase()
        )
        .map(formatComponent);

      return {
        name: sub.name,
        count: matchingComponents.length,
        products: matchingComponents,
      };
    });

    // Also count products in the category as a whole
    const totalCatCount = subnodes.reduce((acc, s) => acc + s.count, 0);

    categoryTree.push({
      category: dbCat.name,
      imageUrl: dbCat.imageUrl,
      description: dbCat.description,
      count: totalCatCount,
      subcategories: subnodes,
    });
  }

  // Fallback: Check if there are components that belong to categories/subcategories NOT in the DB table
  for (const component of components) {
    const formatted = formatComponent(component);
    const categoryName = formatted.category || "Electronics Components";
    const subcategoryName = formatted.subcategory || "General";

    // Check if category is already in our tree
    let catNode = categoryTree.find(
      (n) => n.category.toLowerCase() === categoryName.toLowerCase()
    );
    if (!catNode) {
      catNode = {
        category: categoryName,
        imageUrl: null,
        description: null,
        count: 0,
        subcategories: [],
      };
      categoryTree.push(catNode);
    }

    let subNode = catNode.subcategories.find(
      (s) => s.name.toLowerCase() === subcategoryName.toLowerCase()
    );
    if (!subNode) {
      subNode = {
        name: subcategoryName,
        count: 0,
        products: [],
      };
      catNode.subcategories.push(subNode);
    }

    // If this product was not already added, add it
    if (!subNode.products.some((p) => p.id === formatted.id)) {
      subNode.products.push(formatted);
      subNode.count += 1;
      catNode.count += 1;
    }
  }

  // Sort everything alphabetically
  categoryTree.sort((a, b) => a.category.localeCompare(b.category));
  for (const node of categoryTree) {
    node.subcategories.sort((a, b) => a.name.localeCompare(b.name));
    for (const sub of node.subcategories) {
      sub.products.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return categoryTree;
}

/**
 * Lightweight category data for navigation and category cards.
 * Keeps only three image candidates per subcategory instead of serializing
 * every product and every product field in the catalog.
 */
export async function getComponentCategorySummary(): Promise<ComponentCategorySummaryNode[]> {
  const [dbCategories, components] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      select: {
        name: true,
        imageUrl: true,
        description: true,
        subcategories: {
          where: { isActive: true },
          select: { name: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.component.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        category: true,
        subcategory: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const summary: ComponentCategorySummaryNode[] = dbCategories.map((category) => ({
    category: category.name,
    imageUrl: category.imageUrl,
    description: category.description,
    count: 0,
    subcategories: category.subcategories.map((subcategory) => ({
      name: subcategory.name,
      count: 0,
      products: [],
    })),
  }));
  const categoryLookup = new Map(
    summary.map((category) => [category.category.toLowerCase(), category]),
  );

  for (const component of components) {
    const categoryName = component.category || "Electronics Components";
    const subcategoryName = component.subcategory || "General";
    const categoryKey = categoryName.toLowerCase();
    let category = categoryLookup.get(categoryKey);

    if (!category) {
      category = {
        category: categoryName,
        imageUrl: null,
        description: null,
        count: 0,
        subcategories: [],
      };
      categoryLookup.set(categoryKey, category);
      summary.push(category);
    }

    let subcategory = category.subcategories.find(
      (item) => item.name.toLowerCase() === subcategoryName.toLowerCase(),
    );
    if (!subcategory) {
      subcategory = { name: subcategoryName, count: 0, products: [] };
      category.subcategories.push(subcategory);
    }

    category.count += 1;
    subcategory.count += 1;
    if (component.imageUrl && subcategory.products.length < 3) {
      subcategory.products.push({
        id: component.id,
        name: component.name,
        imageUrl: component.imageUrl,
      });
    }
  }

  summary.sort((a, b) => a.category.localeCompare(b.category));
  for (const category of summary) {
    category.subcategories.sort((a, b) => a.name.localeCompare(b.name));
  }
  return summary;
}

/**
 * Update a component (Admin only)
 */
export async function updateComponent(
  id: string,
  data: UpdateComponentRequest
): Promise<ComponentResponse> {
  // Check if component exists
  const existing = await prisma.component.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new NotFoundError("Component not found");
  }

  // Check if new SKU already exists
  if (data.sku && data.sku !== existing.sku) {
    const skuExists = await prisma.component.findUnique({
      where: { sku: data.sku },
    });

    if (skuExists) {
      throw new ConflictError(`Component with SKU "${data.sku}" already exists`);
    }
  }

  // If name changed AND no explicit slug override provided, regenerate slug
  const updateData: any = { ...data };
  if (data.name && data.name !== existing.name && !data.slug) {
    updateData.slug = await generateUniqueSlug(data.name, id);
  } else if (data.slug) {
    // Validate manual slug format
    updateData.slug = data.slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 100);
  }

  const component = await prisma.component.update({
    where: { id },
    data: updateData,
  });

  return formatComponent(component);
}

/**
 * Delete a component (Admin only)
 * Soft delete by setting isActive to false
 */
export async function deleteComponent(id: string): Promise<{ message: string }> {
  const existing = await prisma.component.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new NotFoundError("Component not found");
  }

  // Soft delete
  await prisma.component.update({
    where: { id },
    data: { isActive: false },
  });

  console.log(`🗑️  Component deleted (soft): ${id}`);

  return { message: "Component deleted successfully" };
}

/**
 * Update component stock
 */
export async function updateComponentStock(
  id: string,
  quantity: number,
  operation: "add" | "subtract" | "set" = "set"
): Promise<ComponentResponse> {
  const existing = await prisma.component.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new NotFoundError("Component not found");
  }

  let newStock = existing.stockQuantity;

  if (operation === "set") {
    newStock = quantity;
  } else if (operation === "add") {
    newStock += quantity;
  } else if (operation === "subtract") {
    newStock -= quantity;
    if (newStock < 0) newStock = 0;
  }

  const component = await prisma.component.update({
    where: { id },
    data: { stockQuantity: newStock },
  });

  console.log(`📦 Stock updated for ${component.name}: ${newStock} units`);

  return formatComponent(component);
}

/**
 * Get low stock components (stock below threshold)
 */
export async function getLowStockComponents(threshold: number = 10): Promise<ComponentResponse[]> {
  const components = await prisma.component.findMany({
    where: {
      isActive: true,
      stockQuantity: {
        lte: threshold,
        gt: 0,
      },
    },
    orderBy: {
      stockQuantity: "asc",
    },
  });

  return components.map(formatComponent);
}

/**
 * Get out of stock components
 */
export async function getOutOfStockComponents(): Promise<ComponentResponse[]> {
  const components = await prisma.component.findMany({
    where: {
      isActive: true,
      stockQuantity: 0,
    },
    orderBy: {
      name: "asc",
    },
  });

  return components.map(formatComponent);
}
