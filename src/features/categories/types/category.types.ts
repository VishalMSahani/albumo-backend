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
  categoryId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
}

export interface UpdateSubcategoryRequest {
  name?: string;
  description?: string;
  imageUrl?: string;
  isActive?: boolean;
}
