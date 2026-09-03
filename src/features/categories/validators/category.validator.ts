import { z } from "zod";
import type {
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CreateSubcategoryRequest,
  UpdateSubcategoryRequest,
} from "../types/category.types.js";

const createCategorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  imageUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateCategorySchema = createCategorySchema.partial();

const createSubcategorySchema = z.object({
  categoryId: z.string().cuid("Invalid category ID"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  imageUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateSubcategorySchema = createSubcategorySchema.omit({ categoryId: true }).partial();

export function validateCreateCategory(data: unknown) {
  return createCategorySchema.safeParse(data);
}

export function validateUpdateCategory(data: unknown) {
  return updateCategorySchema.safeParse(data);
}

export function validateCreateSubcategory(data: unknown) {
  return createSubcategorySchema.safeParse(data);
}

export function validateUpdateSubcategory(data: unknown) {
  return updateSubcategorySchema.safeParse(data);
}
