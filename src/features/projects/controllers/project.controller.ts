/**
 * Project Controllers
 * Request handlers for project operations
 */

import type { Request, Response } from 'express';
import { projectFiltersSchema } from '../validators/project.schema.js';
import type { ProjectFilters } from '../types/project.types.js';
import { projectError } from './project-error.js';
import { cacheInvalidate } from '../../../lib/redis.js';

async function bustProjectCache() {
  await cacheInvalidate("http:/api/projects*");
}
import {
  validateCreateProject,
  validateUpdateProject
} from '../validators/project.validator.js';
import {
  createProject,
  getProjectById,
  getProjectBySlug,
  listProjects,
  updateProject,
  deleteProject,
  incrementViewCount,
  updatePreBuiltStock,
  getCategoriesWithCounts,
  getFeaturedProjectsByCategory
} from '../services/project.service.js';
import { ProjectCategory } from '../../../generated/prisma/enums.js';

// ============================================================================
// PUBLIC ENDPOINTS
// ============================================================================

/**
 * GET /api/projects
 * List projects with filters and pagination
 */
async function respondWithProjects(req: Request, res: Response, admin: boolean): Promise<void> {
  try {
    const parsed = projectFiltersSchema.parse(req.query);
    const filters = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined)) as ProjectFilters;
    if (!admin) filters.isPublic = true;
    const result = await listProjects(filters);
    res.json({ success: true, data: result });
  } catch (error) { projectError(res, error); }
}
export async function handleListProjects(req: Request, res: Response): Promise<void> {
  await respondWithProjects(req, res, false);
}
export async function handleAdminListProjects(req: Request, res: Response): Promise<void> {
  await respondWithProjects(req, res, true);
}
export async function handleAdminGetProject(req: Request, res: Response): Promise<void> {
  try {
    const project = await getProjectById(req.params.id!, true);
    if (!project) { res.status(404).json({ success: false, error: 'Project not found' }); return; }
    res.json({ success: true, data: project });
  } catch (error) { projectError(res, error); }
}

/**
 * GET /api/projects/:id
 * Get project by ID
 */
export async function handleGetProjectById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
      return;
    }

    const project = await getProjectById(id, true); // Include components

    if (!project || !project.isPublic) {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }

    // Increment view count (fire and forget)
    incrementViewCount(id).catch(err => console.error('Failed to increment view count:', err));

    res.status(200).json({
      success: true,
      data: project
    });
  } catch (error: any) {
    console.error('Error getting project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get project'
    });
  }
}

/**
 * GET /api/projects/slug/:slug
 * Get project by slug
 */
export async function handleGetProjectBySlug(req: Request, res: Response): Promise<void> {
  try {
    const { slug } = req.params;

    if (!slug) {
      res.status(400).json({
        success: false,
        error: 'Project slug is required'
      });
      return;
    }

    const project = await getProjectBySlug(slug, true); // Include components

    if (!project || !project.isPublic) {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }

    // Increment view count (fire and forget)
    incrementViewCount(project.id).catch(err => console.error('Failed to increment view count:', err));

    res.status(200).json({
      success: true,
      data: project
    });
  } catch (error: any) {
    console.error('Error getting project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get project'
    });
  }
}

/**
 * GET /api/projects/categories
 * Get all categories with project counts
 */
export async function handleGetCategories(req: Request, res: Response): Promise<void> {
  try {
    const categories = await getCategoriesWithCounts();

    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error: any) {
    console.error('Error getting categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get categories'
    });
  }
}

/**
 * GET /api/projects/categories/:category/featured
 * Get featured projects by category
 */
export async function handleGetFeaturedByCategory(req: Request, res: Response): Promise<void> {
  try {
    const { category } = req.params;
    const limit = req.query.limit ? Number(req.query.limit) : 6;

    // Validate category
    if (!Object.values(ProjectCategory).includes(category as ProjectCategory)) {
      res.status(400).json({
        success: false,
        error: 'Invalid category'
      });
      return;
    }

    const projects = await getFeaturedProjectsByCategory(category as ProjectCategory, limit);

    res.status(200).json({
      success: true,
      data: projects
    });
  } catch (error: any) {
    console.error('Error getting featured projects:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get featured projects'
    });
  }
}

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

/**
 * POST /api/projects
 * Create a new project (Admin only)
 */
export async function handleCreateProject(req: Request, res: Response): Promise<void> {
  try {
    const validation = validateCreateProject(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        errors: validation.errors
      });
      return;
    }

    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    const project = await createProject(validation.data!, userId);
    void bustProjectCache();

    res.status(201).json({
      success: true,
      data: project,
      message: 'Project created successfully'
    });
  } catch (error) {
    projectError(res, error);
  }
}

/**
 * PUT /api/projects/:id
 * Update a project (Admin only)
 */
export async function handleUpdateProject(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
      return;
    }

    const validation = validateUpdateProject(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        errors: validation.errors
      });
      return;
    }

    const project = await updateProject(id, validation.data!);
    void bustProjectCache();

    res.status(200).json({
      success: true,
      data: project,
      message: 'Project updated successfully'
    });
  } catch (error) {
    projectError(res, error);
  }
}

/**
 * DELETE /api/projects/:id
 * Delete a project (Admin only)
 */
export async function handleDeleteProject(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
      return;
    }

    await deleteProject(id);
    void bustProjectCache();

    res.status(200).json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting project:', error);

    if (error.message === 'Project not found') {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to delete project'
    });
  }
}

/**
 * POST /api/projects/:id/feature
 * Feature/unfeature a project (Admin only)
 */
export async function handleToggleFeature(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { isFeatured } = req.body;

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
      return;
    }

    if (typeof isFeatured !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'isFeatured must be a boolean'
      });
      return;
    }

    const project = await updateProject(id, { isFeatured });

    res.status(200).json({
      success: true,
      data: project,
      message: isFeatured ? 'Project featured successfully' : 'Project unfeatured successfully'
    });
  } catch (error: any) {
    console.error('Error toggling feature status:', error);

    if (error.message === 'Project not found') {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to toggle feature status'
    });
  }
}

/**
 * POST /api/projects/:id/publish
 * Publish/unpublish a project (Admin only)
 */
export async function handleTogglePublish(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { isPublic } = req.body;

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
      return;
    }

    if (typeof isPublic !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'isPublic must be a boolean'
      });
      return;
    }

    const updateData: any = { isPublic };
    
    // Set publishedAt when publishing for the first time
    if (isPublic) {
      const existingProject = await getProjectById(id);
      if (existingProject && !existingProject.publishedAt) {
        updateData.publishedAt = new Date();
      }
    }

    const project = await updateProject(id, updateData);

    res.status(200).json({
      success: true,
      data: project,
      message: isPublic ? 'Project published successfully' : 'Project unpublished successfully'
    });
  } catch (error: any) {
    console.error('Error toggling publish status:', error);

    if (error.message === 'Project not found') {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to toggle publish status'
    });
  }
}

/**
 * POST /api/projects/:id/stock
 * Update pre-built stock (Admin only)
 */
export async function handleUpdateStock(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { stockChange } = req.body;

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
      return;
    }

    if (typeof stockChange !== 'number') {
      res.status(400).json({
        success: false,
        error: 'stockChange must be a number'
      });
      return;
    }

    const project = await updatePreBuiltStock(id, stockChange);

    res.status(200).json({
      success: true,
      data: project,
      message: 'Stock updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating stock:', error);

    if (error.message === 'Project not found') {
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
      return;
    }

    if (error.message === 'Insufficient stock') {
      res.status(400).json({
        success: false,
        error: 'Insufficient stock'
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update stock'
    });
  }
}
