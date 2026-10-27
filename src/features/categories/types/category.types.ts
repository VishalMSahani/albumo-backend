import type { ProductConfiguration } from "../../components/types/catalogue.js";

export interface CreateCategoryRequest {
  name: string;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
}

export interface UpdateCategoryRequest {
  name?: string;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
}

export interface CreateSubcategoryRequest {
  configuration?: ProductConfiguration;
  categoryId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
}

export interface UpdateSubcategoryRequest {
  configuration?: ProductConfiguration;
  name?: string;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
}
