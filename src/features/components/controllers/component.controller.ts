/**
 * Component Controller
 * Request handlers for component endpoints
 */

import type { Request, Response, NextFunction } from "express";
import { ValidationError } from "../../../utils/types.js";
import {
  validateCreateComponent,
  validateUpdateComponent,
  validateComponentFilters,
} from "../validators/component.validator.js";
import * as componentService from "../services/component.service.js";
import { cacheInvalidate } from "../../../lib/redis.js";
import { logAdminAction } from "../../../services/admin-action-log.service.js";

async function bustComponentCache() {
  await cacheInvalidate("http:/api/components*");
}

/**
 * Create a new component
 * POST /api/components
 * Access: Admin only
 */
export async function createComponentHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const validation = validateCreateComponent(req.body);

    if (!validation.success || !validation.data) {
      throw new ValidationError(validation.error || "Validation failed");
    }

    const component = await componentService.createComponent(validation.data);
    void bustComponentCache();
    void logAdminAction(req.user!.userId, "CREATE_PRODUCT", "PRODUCT", component.id);

    res.status(201).json({
      success: true,
      data: component,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get all components with filters
 * GET /api/components
 * Access: Public
 */
export async function getComponentsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const validation = validateComponentFilters(req.query);

    if (!validation.success || !validation.data) {
      throw new ValidationError(validation.error || "Validation failed");
    }

    const result = await componentService.getComponents(validation.data);

    res.status(200).json({
      success: true,
      data: result.components,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get component category tree
 * GET /api/components/categories/tree
 * Access: Public
 */
export async function getCategoryTreeHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const categories = await componentService.getComponentCategoryTree();

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/components/categories/summary
 * Compact category payload for cards and navigation.
 */
export async function getCategorySummaryHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const categories = await componentService.getComponentCategorySummary();
    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a single component by ID
 * GET /api/components/:id
 * Access: Public
 */
export async function getComponentByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError("Component ID is required");
    }

    const component = await componentService.getComponentById(id);

    res.status(200).json({
      success: true,
      data: component,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a single component by slug
 * GET /api/components/slug/:slug
 * Access: Public
 */
export async function getComponentBySlugHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { slug } = req.params;

    if (!slug) {
      throw new ValidationError("Component slug is required");
    }

    const component = await componentService.getComponentBySlug(slug);

    res.status(200).json({
      success: true,
      data: component,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update a component
 * PATCH /api/components/:id
 * Access: Admin only
 */
export async function updateComponentHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError("Component ID is required");
    }

    const validation = validateUpdateComponent(req.body);

    if (!validation.success) {
      throw new ValidationError(validation.error || "Validation failed");
    }

    const component = await componentService.updateComponent(id, validation.data!);
    void bustComponentCache();
    void logAdminAction(req.user!.userId, "UPDATE_PRODUCT", "PRODUCT", id);

    res.status(200).json({
      success: true,
      data: component,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a component (soft delete)
 * DELETE /api/components/:id
 * Access: Admin only
 */
export async function deleteComponentHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError("Component ID is required");
    }

    const result = await componentService.deleteComponent(id);
    void bustComponentCache();
    void logAdminAction(req.user!.userId, "DELETE_PRODUCT", "PRODUCT", id);

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update component stock
 * PATCH /api/components/:id/stock
 * Access: Admin only
 */
export async function updateStockHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError("Component ID is required");
    }

    const { quantity, operation } = req.body;

    if (typeof quantity !== "number" || quantity < 0) {
      throw new ValidationError("Quantity must be a non-negative number");
    }

    if (operation && !["add", "subtract", "set"].includes(operation)) {
      throw new ValidationError("Operation must be 'add', 'subtract', or 'set'");
    }

    const component = await componentService.updateComponentStock(
      id,
      quantity,
      operation || "set"
    );

    res.status(200).json({
      success: true,
      data: component,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get low stock components
 * GET /api/components/low-stock
 * Access: Admin only
 */
export async function getLowStockHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const threshold = req.query.threshold ? Number(req.query.threshold) : 10;

    const components = await componentService.getLowStockComponents(threshold);

    res.status(200).json({
      success: true,
      data: components,
      count: components.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get out of stock components
 * GET /api/components/out-of-stock
 * Access: Admin only
 */
export async function getOutOfStockHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const components = await componentService.getOutOfStockComponents();

    res.status(200).json({
      success: true,
      data: components,
      count: components.length,
    });
  } catch (error) {
    next(error);
  }
}
