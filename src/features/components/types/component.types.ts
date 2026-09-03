/**
 * Component Feature Types
 * Type definitions for component management
 */

export interface CreateComponentRequest {
  name: string;
  slug?: string;
  sku?: string;
  description?: string;
  typicalUseCase?: string;
  vendorLink?: string;
  imageUrl?: string;
  category?: string;
  subcategory?: string;
  productType?: ComponentProductType;
  brand?: string;
  tags?: string[];
  isBestSeller?: boolean;
  isRobomaniacItem?: boolean;
  isSoftware?: boolean;
  unitPriceCents: number;
  discountedPriceCents?: number | null;
  stockQuantity?: number;
  isActive?: boolean;
}

export interface UpdateComponentRequest {
  name?: string;
  slug?: string; // Allow manual slug override from admin
  sku?: string;
  description?: string;
  typicalUseCase?: string;
  vendorLink?: string;
  imageUrl?: string;
  category?: string;
  subcategory?: string;
  productType?: ComponentProductType;
  brand?: string | null;
  tags?: string[];
  isBestSeller?: boolean;
  isRobomaniacItem?: boolean;
  isSoftware?: boolean;
  unitPriceCents?: number;
  discountedPriceCents?: number | null;
  stockQuantity?: number;
  isActive?: boolean;
}

export interface ComponentFilters {
  search?: string;
  isActive?: boolean;
  category?: string;
  subcategory?: string;
  productType?: ComponentProductType;
  isBestSeller?: boolean;
  isRobomaniacItem?: boolean;
  isSoftware?: boolean;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  page?: number;
  limit?: number;
  sortBy?: "name" | "price" | "stock" | "createdAt";
  sortOrder?: "asc" | "desc";
}

export interface ComponentResponse {
  id: string;
  slug: string;
  name: string;
  sku: string | null;
  description: string | null;
  typicalUseCase: string | null;
  vendorLink: string | null;
  imageUrl: string | null;
  category: string;
  subcategory: string;
  productType: ComponentProductType;
  brand: string | null;
  tags: string[];
  isBestSeller: boolean;
  isRobomaniacItem: boolean;
  isSoftware: boolean;
  unitPriceCents: number;
  discountedPriceCents: number | null;
  unitPrice: number; // Formatted price in rupees
  stockQuantity: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedComponentsResponse {
  components: ComponentResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface ComponentStockUpdate {
  componentId: string;
  quantity: number;
  operation: "add" | "subtract" | "set";
}

export type ComponentProductType =
  | "ELECTRONICS_COMPONENT"
  | "MODULE"
  | "SENSOR"
  | "DEVELOPMENT_BOARD"
  | "MOTOR_ACTUATOR"
  | "POWER_BATTERY"
  | "TOOL_EQUIPMENT"
  | "COURSE_KIT"
  | "BOOK"
  | "SOFTWARE"
  | "CUSTOM_PROJECT_SERVICE"
  | "OTHER";

export interface ComponentCategoryNode {
  category: string;
  imageUrl?: string | null;
  description?: string | null;
  count: number;
  subcategories: {
    name: string;
    count: number;
    products: ComponentResponse[];
  }[];
}

export interface ComponentCategorySummaryNode {
  category: string;
  imageUrl?: string | null;
  description?: string | null;
  count: number;
  subcategories: {
    name: string;
    count: number;
    products: {
      id: string;
      name: string;
      imageUrl: string | null;
    }[];
  }[];
}
