/**
 * Component Validation
 * Input validation for component operations
 */

import type {
  ComponentProductType,
  CreateComponentRequest,
  UpdateComponentRequest,
  ComponentFilters,
} from "../types/component.types.js";

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const PRODUCT_TYPES: ComponentProductType[] = [
  "ELECTRONICS_COMPONENT",
  "MODULE",
  "SENSOR",
  "DEVELOPMENT_BOARD",
  "MOTOR_ACTUATOR",
  "POWER_BATTERY",
  "TOOL_EQUIPMENT",
  "COURSE_KIT",
  "BOOK",
  "SOFTWARE",
  "CUSTOM_PROJECT_SERVICE",
  "OTHER",
];

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      // Fall back to comma-separated tags.
    }

    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return Boolean(value);
}

/**
 * Validate component creation data
 */
export function validateCreateComponent(data: any): ValidationResult<CreateComponentRequest> {
  const errors: string[] = [];

  // Name validation
  if (!data.name || typeof data.name !== "string" || data.name.trim().length === 0) {
    errors.push("Component name is required");
  } else if (data.name.trim().length < 3) {
    errors.push("Component name must be at least 3 characters");
  } else if (data.name.trim().length > 200) {
    errors.push("Component name must be less than 200 characters");
  }

  // SKU validation (optional)
  if (data.sku !== undefined && data.sku !== null) {
    if (typeof data.sku !== "string" || data.sku.trim().length === 0) {
      errors.push("SKU must be a non-empty string");
    } else if (data.sku.trim().length > 50) {
      errors.push("SKU must be less than 50 characters");
    }
  }

  // Price validation
  if (data.unitPriceCents === undefined || data.unitPriceCents === null) {
    errors.push("Unit price is required");
  } else if (typeof data.unitPriceCents !== "number" || isNaN(data.unitPriceCents)) {
    errors.push("Unit price must be a number");
  } else if (data.unitPriceCents < 0) {
    errors.push("Unit price cannot be negative");
  } else if (data.unitPriceCents > 100000000) {
    // Max price 10 lakh rupees
    errors.push("Unit price is too high");
  }

  // Stock quantity validation (optional)
  if (data.stockQuantity !== undefined && data.stockQuantity !== null) {
    if (typeof data.stockQuantity !== "number" || isNaN(data.stockQuantity)) {
      errors.push("Stock quantity must be a number");
    } else if (data.stockQuantity < 0) {
      errors.push("Stock quantity cannot be negative");
    } else if (!Number.isInteger(data.stockQuantity)) {
      errors.push("Stock quantity must be an integer");
    }
  }

  // Description validation (optional)
  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== "string") {
      errors.push("Description must be a string");
    }
  }

  if (data.productType !== undefined && !PRODUCT_TYPES.includes(data.productType)) {
    errors.push("Invalid product type");
  }

  // URL validations (optional)
  if (data.vendorLink && typeof data.vendorLink === "string") {
    try {
      new URL(data.vendorLink);
    } catch {
      errors.push("Vendor link must be a valid URL");
    }
  }

  if (data.imageUrl && typeof data.imageUrl === "string") {
    try {
      new URL(data.imageUrl);
    } catch {
      errors.push("Image URL must be a valid URL");
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      error: errors.join(", "),
    };
  }

  const result: CreateComponentRequest = {
    name: data.name.trim(),
    unitPriceCents: Math.round(data.unitPriceCents),
  };

  if (data.slug?.trim()) result.slug = data.slug.trim();
  if (data.sku?.trim()) result.sku = data.sku.trim();
  if (data.description?.trim()) result.description = data.description.trim();
  if (data.typicalUseCase?.trim()) result.typicalUseCase = data.typicalUseCase.trim();
  if (data.vendorLink?.trim()) result.vendorLink = data.vendorLink.trim();
  if (data.imageUrl?.trim()) result.imageUrl = data.imageUrl.trim();
  if (data.category?.trim()) result.category = data.category.trim();
  if (data.subcategory?.trim()) result.subcategory = data.subcategory.trim();
  if (data.productType) result.productType = data.productType;
  if (data.brand?.trim()) result.brand = data.brand.trim();
  const tags = parseStringArray(data.tags);
  if (tags !== undefined) result.tags = tags;
  const isBestSeller = parseBoolean(data.isBestSeller);
  if (isBestSeller !== undefined) result.isBestSeller = isBestSeller;
  const isRobomaniacItem = parseBoolean(data.isRobomaniacItem);
  if (isRobomaniacItem !== undefined) result.isRobomaniacItem = isRobomaniacItem;
  const isSoftware = parseBoolean(data.isSoftware);
  if (isSoftware !== undefined) result.isSoftware = isSoftware;
  if (data.stockQuantity !== undefined) result.stockQuantity = Math.round(data.stockQuantity);
  const isActive = parseBoolean(data.isActive);
  if (isActive !== undefined) result.isActive = isActive;
  // Discounted price (sale price)
  if (data.discountedPriceCents !== undefined) {
    result.discountedPriceCents =
      data.discountedPriceCents === null || data.discountedPriceCents === ""
        ? null
        : Math.round(Number(data.discountedPriceCents));
  }

  return {
    success: true,
    data: result,
  };
}

/**
 * Validate component update data
 */
export function validateUpdateComponent(data: any): ValidationResult<UpdateComponentRequest> {
  const errors: string[] = [];

  // At least one field must be provided
  if (Object.keys(data).length === 0) {
    errors.push("At least one field must be provided for update");
  }

  // Name validation (if provided)
  if (data.name !== undefined) {
    if (typeof data.name !== "string" || data.name.trim().length === 0) {
      errors.push("Component name must be a non-empty string");
    } else if (data.name.trim().length < 3) {
      errors.push("Component name must be at least 3 characters");
    } else if (data.name.trim().length > 200) {
      errors.push("Component name must be less than 200 characters");
    }
  }

  // SKU validation (if provided)
  if (data.sku !== undefined && data.sku !== null) {
    if (typeof data.sku !== "string" || data.sku.trim().length === 0) {
      errors.push("SKU must be a non-empty string");
    } else if (data.sku.trim().length > 50) {
      errors.push("SKU must be less than 50 characters");
    }
  }

  // Price validation (if provided)
  if (data.unitPriceCents !== undefined) {
    if (typeof data.unitPriceCents !== "number" || isNaN(data.unitPriceCents)) {
      errors.push("Unit price must be a number");
    } else if (data.unitPriceCents < 0) {
      errors.push("Unit price cannot be negative");
    } else if (data.unitPriceCents > 100000000) {
      errors.push("Unit price is too high");
    }
  }

  // Stock quantity validation (if provided)
  if (data.stockQuantity !== undefined) {
    if (typeof data.stockQuantity !== "number" || isNaN(data.stockQuantity)) {
      errors.push("Stock quantity must be a number");
    } else if (data.stockQuantity < 0) {
      errors.push("Stock quantity cannot be negative");
    } else if (!Number.isInteger(data.stockQuantity)) {
      errors.push("Stock quantity must be an integer");
    }
  }

  // Description validation (if provided)
  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== "string") {
      errors.push("Description must be a string");
    }
  }

  if (data.productType !== undefined && !PRODUCT_TYPES.includes(data.productType)) {
    errors.push("Invalid product type");
  }

  // URL validations (if provided)
  if (data.vendorLink !== undefined && data.vendorLink && typeof data.vendorLink === "string") {
    try {
      new URL(data.vendorLink);
    } catch {
      errors.push("Vendor link must be a valid URL");
    }
  }

  if (data.imageUrl !== undefined && data.imageUrl && typeof data.imageUrl === "string") {
    try {
      new URL(data.imageUrl);
    } catch {
      errors.push("Image URL must be a valid URL");
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      error: errors.join(", "),
    };
  }

  const updateData: UpdateComponentRequest = {};

  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.slug !== undefined) updateData.slug = data.slug?.trim() || undefined;
  if (data.sku !== undefined) updateData.sku = data.sku?.trim() || null;
  if (data.description !== undefined) updateData.description = data.description?.trim() || null;
  if (data.typicalUseCase !== undefined) updateData.typicalUseCase = data.typicalUseCase?.trim() || null;
  if (data.vendorLink !== undefined) updateData.vendorLink = data.vendorLink?.trim() || null;
  if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl?.trim() || null;
  if (data.category !== undefined) updateData.category = data.category?.trim() || "Electronics Components";
  if (data.subcategory !== undefined) updateData.subcategory = data.subcategory?.trim() || "General";
  if (data.productType !== undefined) updateData.productType = data.productType;
  if (data.brand !== undefined) updateData.brand = data.brand?.trim() || null;
  const tags = parseStringArray(data.tags);
  if (tags !== undefined) updateData.tags = tags;
  const isBestSeller = parseBoolean(data.isBestSeller);
  if (isBestSeller !== undefined) updateData.isBestSeller = isBestSeller;
  const isRobomaniacItem = parseBoolean(data.isRobomaniacItem);
  if (isRobomaniacItem !== undefined) updateData.isRobomaniacItem = isRobomaniacItem;
  const isSoftware = parseBoolean(data.isSoftware);
  if (isSoftware !== undefined) updateData.isSoftware = isSoftware;
  if (data.unitPriceCents !== undefined) updateData.unitPriceCents = Math.round(data.unitPriceCents);
  if (data.stockQuantity !== undefined) updateData.stockQuantity = Math.round(data.stockQuantity);
  const isActive = parseBoolean(data.isActive);
  if (isActive !== undefined) updateData.isActive = isActive;
  // Discounted price (sale price)
  if (data.discountedPriceCents !== undefined) {
    updateData.discountedPriceCents =
      data.discountedPriceCents === null || data.discountedPriceCents === ""
        ? null
        : Math.round(Number(data.discountedPriceCents));
  }

  return {
    success: true,
    data: updateData,
  };
}

/**
 * Validate component filters
 */
export function validateComponentFilters(query: any): ValidationResult<ComponentFilters> {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));

  const sortBy = ["name", "price", "stock", "createdAt"].includes(query.sortBy)
    ? query.sortBy
    : "createdAt";

  const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

  const filters: ComponentFilters = {
    page,
    limit,
    sortBy,
    sortOrder,
  };

  if (query.search && typeof query.search === "string") {
    filters.search = query.search.trim();
  }

  if (query.isActive !== undefined) {
    filters.isActive = query.isActive === "true" || query.isActive === true;
  }

  if (query.category && typeof query.category === "string") {
    filters.category = query.category.trim();
  }

  if (query.subcategory && typeof query.subcategory === "string") {
    filters.subcategory = query.subcategory.trim();
  }

  if (query.productType && PRODUCT_TYPES.includes(query.productType)) {
    filters.productType = query.productType;
  }

  if (query.isBestSeller !== undefined) {
    filters.isBestSeller = query.isBestSeller === "true" || query.isBestSeller === true;
  }

  if (query.isRobomaniacItem !== undefined) {
    filters.isRobomaniacItem =
      query.isRobomaniacItem === "true" || query.isRobomaniacItem === true;
  }

  if (query.isSoftware !== undefined) {
    filters.isSoftware = query.isSoftware === "true" || query.isSoftware === true;
  }

  if (query.minPrice) {
    const minPrice = parseInt(query.minPrice);
    if (!isNaN(minPrice) && minPrice >= 0) {
      filters.minPrice = minPrice;
    }
  }

  if (query.maxPrice) {
    const maxPrice = parseInt(query.maxPrice);
    if (!isNaN(maxPrice) && maxPrice >= 0) {
      filters.maxPrice = maxPrice;
    }
  }

  if (query.inStock !== undefined) {
    filters.inStock = query.inStock === "true" || query.inStock === true;
  }

  return {
    success: true,
    data: filters,
  };
}
