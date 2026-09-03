/**
 * Project Routes
 * HTTP routes for project operations
 */

import { Router } from 'express';
import { authenticate, authorize } from '../../../middlewares/auth.middleware.js';
import { cacheResponse } from '../../../middlewares/cache.middleware.js';
import { uploadProjectFiles } from '../../../middlewares/upload.middleware.js';
import {
  handleListProjects,
  handleGetProjectById,
  handleGetProjectBySlug,
  handleGetCategories,
  handleGetFeaturedByCategory,
  handleCreateProject,
  handleUpdateProject,
  handleDeleteProject,
  handleToggleFeature,
  handleTogglePublish,
  handleUpdateStock
} from '../controllers/project.controller.js';
import { 
  handleCreateProjectWithUploads,
  handleUpdateProjectWithUploads 
} from '../controllers/project-upload.controller.js';

const router: Router = Router();

// ============================================================================
// PUBLIC ROUTES
// ============================================================================

/**
 * GET /api/projects
 * List projects with filters, search, and pagination
 * Query params:
 * - category: ProjectCategory | ProjectCategory[] (filter by category)
 * - difficulty: DifficultyLevel | DifficultyLevel[] (filter by difficulty)
 * - projectType: ProjectType (FEATURED, AI_GENERATED, CUSTOM)
 * - tags: string | string[] (filter by tags)
 * - isFeatured: boolean (featured projects only)
 * - isPublic: boolean (public projects only, default: true)
 * - isAIGenerated: boolean (AI-generated projects)
 * - preBuiltAvailable: boolean (pre-built available)
 * - minCost: number (minimum cost in rupees)
 * - maxCost: number (maximum cost in rupees)
 * - minBuildTime: number (minimum build time in minutes)
 * - maxBuildTime: number (maximum build time in minutes)
 * - search: string (search in title, summary, description)
 * - page: number (page number, default: 1)
 * - limit: number (items per page, default: 20, max: 100)
 * - sortBy: 'createdAt' | 'updatedAt' | 'title' | 'viewCount' | 'buildCount' | 'averageRating' | 'estimatedCostCents'
 * - sortOrder: 'asc' | 'desc' (default: 'desc')
 */
router.get('/', cacheResponse(60), handleListProjects);

/**
 * GET /api/projects/categories
 * Get all categories with project counts
 */
router.get('/categories', handleGetCategories);

/**
 * GET /api/projects/categories/:category/featured
 * Get featured projects by category
 * Path params:
 * - category: ProjectCategory (IOT, ROBOTICS, DRONE, etc.)
 * Query params:
 * - limit: number (default: 6)
 */
router.get('/categories/:category/featured', handleGetFeaturedByCategory);

/**
 * GET /api/projects/slug/:slug
 * Get project by slug (for public URLs)
 * Path params:
 * - slug: string (project slug)
 */
router.get('/slug/:slug', handleGetProjectBySlug);

/**
 * GET /api/projects/:id
 * Get project by ID
 * Path params:
 * - id: string (project UUID)
 */
router.get('/:id', handleGetProjectById);

// ============================================================================
// ADMIN ROUTES (Protected)
// ============================================================================

/**
 * POST /api/projects
 * Create a new project (Admin only)
 * Body:
 * - title: string (required, 3-200 chars)
 * - slug: string (optional, auto-generated from title)
 * - summary: string (optional, max 300 chars)
 * - description: string (required, min 10 chars)
 * - category: ProjectCategory (required)
 * - tags: string[] (optional)
 * - difficulty: DifficultyLevel (required)
 * - projectType: ProjectType (optional, default: FEATURED)
 * - estimatedCostCents: number (optional)
 * - estimatedBuildTimeMinutes: number (optional)
 * - preBuiltAvailable: boolean (optional)
 * - preBuiltStock: number (optional)
 * - preBuiltPriceCents: number (optional)
 * - preBuiltImages: string[] (optional, URLs)
 * - thumbnailUrl: string (optional, URL)
 * - youtubeUrl: string (optional, YouTube URL)
 * - learningOutcomes: string[] (optional)
 * - prerequisites: string[] (optional)
 * - isFeatured: boolean (optional)
 * - isPublic: boolean (optional, default: true)
 * - defaultMentorId: string (optional, UUID)
 * - componentIds: string[] (optional, component UUIDs)
 */
router.post('/', authenticate, authorize('ADMIN'), handleCreateProject);

/**
 * POST /api/projects/upload
 * Create a new project with file uploads (Admin only)
 * Multipart form data with:
 * - images: File[] (max 5 images, JPEG/PNG/WebP)
 * - pdfs: File[] (max 5 PDFs for documentation)
 * - thumbnail: File (1 thumbnail image)
 * - title: string (required)
 * - category: ProjectCategory (required)
 * - description: string (required)
 * - summary: string (optional)
 * - difficulty: DifficultyLevel (required)
 * - tags: string[] (JSON array)
 * - prerequisites: string[] (JSON array)
 * - learningOutcomes: string[] (JSON array)
 * - estimatedCostCents: number
 * - estimatedBuildTimeMinutes: number
 * - youtubeUrl: string (optional)
 * - externalLinks: string[] (JSON array)
 * - componentIds: string[] (JSON array of required component IDs)
 * - isFeatured: boolean
 * - isPublic: boolean
 * - preBuiltAvailable: boolean
 * - preBuiltStock: number
 * - preBuiltPriceCents: number
 */
router.post('/upload', authenticate, authorize('ADMIN'), uploadProjectFiles, handleCreateProjectWithUploads);

/**
 * PUT /api/projects/:id
 * Update a project (Admin only)
 * Path params:
 * - id: string (project UUID)
 * Body: Same as POST but all fields optional
 */
router.put('/:id', authenticate, authorize('ADMIN'), handleUpdateProject);

/**
 * PUT /api/projects/:id/upload
 * Update a project with file uploads (Admin only)
 * Multipart form data with:
 * - images: File[] (additional images to add)
 * - pdfs: File[] (additional PDFs to add)
 * - thumbnail: File (replace thumbnail)
 * - replaceImages: 'true' | 'false' (if true, replace all images; if false, append)
 * - replacePdfs: 'true' | 'false' (if true, replace all PDFs; if false, append)
 * - replaceLinks: 'true' | 'false' (if true, replace all links; if false, append)
 * - All other fields from create endpoint (optional)
 */
router.put('/:id/upload', authenticate, authorize('ADMIN'), uploadProjectFiles, handleUpdateProjectWithUploads);

/**
 * DELETE /api/projects/:id
 * Delete a project (Admin only)
 * Path params:
 * - id: string (project UUID)
 */
router.delete('/:id', authenticate, authorize('ADMIN'), handleDeleteProject);

/**
 * POST /api/projects/:id/feature
 * Feature/unfeature a project (Admin only)
 * Path params:
 * - id: string (project UUID)
 * Body:
 * - isFeatured: boolean (required)
 */
router.post('/:id/feature', authenticate, authorize('ADMIN'), handleToggleFeature);

/**
 * POST /api/projects/:id/publish
 * Publish/unpublish a project (Admin only)
 * Path params:
 * - id: string (project UUID)
 * Body:
 * - isPublic: boolean (required)
 */
router.post('/:id/publish', authenticate, authorize('ADMIN'), handleTogglePublish);

/**
 * POST /api/projects/:id/stock
 * Update pre-built stock (Admin only)
 * Path params:
 * - id: string (project UUID)
 * Body:
 * - stockChange: number (required, positive to add, negative to remove)
 */
router.post('/:id/stock', authenticate, authorize('ADMIN'), handleUpdateStock);

export default router;
