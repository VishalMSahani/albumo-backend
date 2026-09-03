import type { Request, Response, NextFunction } from "express";
import { ValidationError } from "../../../utils/types.js";
import * as categoryService from "../services/category.service.js";
import {
  validateCreateCategory,
  validateUpdateCategory,
  validateCreateSubcategory,
  validateUpdateSubcategory,
} from "../validators/category.validator.js";
import { cacheInvalidate } from "../../../lib/redis.js";

async function bustCategoryCache() {
  await cacheInvalidate("http:/api/components*", "http:/api/categories*");
}

export async function getAllCategoriesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categories = await categoryService.getAllCategories();
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
}

export async function createCategoryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validation = validateCreateCategory(req.body);
    if (!validation.success) {
      throw new ValidationError(validation.error.message || "Validation failed");
    }
    const category = await categoryService.createCategory(validation.data as any);
    void bustCategoryCache();
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
}

export async function updateCategoryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    if (!id) throw new ValidationError("Category ID is required");
    const validation = validateUpdateCategory(req.body);
    if (!validation.success) {
      throw new ValidationError(validation.error.message || "Validation failed");
    }
    const category = await categoryService.updateCategory(id, validation.data as any);
    void bustCategoryCache();
    res.status(200).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
}

export async function deleteCategoryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    if (!id) throw new ValidationError("Category ID is required");
    const result = await categoryService.deleteCategory(id);
    void bustCategoryCache();
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
}

export async function createSubcategoryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    if (!id) throw new ValidationError("Category ID is required");
    const validation = validateCreateSubcategory({ ...req.body, categoryId: id });
    if (!validation.success) {
      throw new ValidationError(validation.error.message || "Validation failed");
    }
    const subcategory = await categoryService.createSubcategory(validation.data as any);
    void bustCategoryCache();
    res.status(201).json({ success: true, data: subcategory });
  } catch (error) {
    next(error);
  }
}

export async function updateSubcategoryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { subId } = req.params;
    if (!subId) throw new ValidationError("Subcategory ID is required");
    const validation = validateUpdateSubcategory(req.body);
    if (!validation.success) {
      throw new ValidationError(validation.error.message || "Validation failed");
    }
    const subcategory = await categoryService.updateSubcategory(subId, validation.data as any);
    void bustCategoryCache();
    res.status(200).json({ success: true, data: subcategory });
  } catch (error) {
    next(error);
  }
}

export async function deleteSubcategoryHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { subId } = req.params;
    if (!subId) throw new ValidationError("Subcategory ID is required");
    const result = await categoryService.deleteSubcategory(subId);
    void bustCategoryCache();
    res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    next(error);
  }
}
