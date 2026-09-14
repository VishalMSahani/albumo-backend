/**
 * Project Validators
 * Manual validation for project-related requests (consistent with components module)
 */

import { ProjectCategory, DifficultyLevel, ProjectType } from '../../../generated/prisma/enums.js';
import { createProjectSchema, updateProjectSchema } from './project.schema.js';
import type { CreateProjectRequest, UpdateProjectRequest, ProjectFilters } from '../types/project.types.js';

// ============================================================================
// VALIDATION RESULT TYPE
// ============================================================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate project creation data
 */
export function validateCreateProject(data: unknown): ValidationResult<CreateProjectRequest> {
  const result = createProjectSchema.safeParse(data);
  return result.success ? { success: true, data: result.data } : {
    success: false, errors: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
  };
}

export function validateUpdateProject(data: unknown): ValidationResult<UpdateProjectRequest> {
  const result = updateProjectSchema.safeParse(data);
  return result.success ? { success: true, data: result.data } : {
    success: false, errors: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
  };
}

/**
 * Validate project filters
 */
export function validateProjectFilters(data: any): ValidationResult<ProjectFilters> {
  const errors: string[] = [];

  // Category validation
  if (data.category !== undefined) {
    if (Array.isArray(data.category)) {
      if (!data.category.every((cat: any) => Object.values(ProjectCategory).includes(cat))) {
        errors.push('All categories must be valid');
      }
    } else if (!Object.values(ProjectCategory).includes(data.category)) {
      errors.push('Invalid category');
    }
  }

  // Difficulty validation
  if (data.difficulty !== undefined) {
    if (Array.isArray(data.difficulty)) {
      if (!data.difficulty.every((diff: any) => Object.values(DifficultyLevel).includes(diff))) {
        errors.push('All difficulty levels must be valid');
      }
    } else if (!Object.values(DifficultyLevel).includes(data.difficulty)) {
      errors.push('Invalid difficulty level');
    }
  }

  // Project type validation
  if (data.projectType !== undefined && !Object.values(ProjectType).includes(data.projectType)) {
    errors.push('Invalid project type');
  }

  // Price range validation
  if (data.minCost !== undefined && data.maxCost !== undefined) {
    if (data.minCost > data.maxCost) {
      errors.push('minCost must be less than or equal to maxCost');
    }
  }

  // Build time range validation
  if (data.minBuildTime !== undefined && data.maxBuildTime !== undefined) {
    if (data.minBuildTime > data.maxBuildTime) {
      errors.push('minBuildTime must be less than or equal to maxBuildTime');
    }
  }

  // Pagination validation
  if (data.page !== undefined) {
    const page = parseInt(data.page);
    if (isNaN(page) || page < 1) {
      errors.push('Page must be a positive integer');
    }
  }

  if (data.limit !== undefined) {
    const limit = parseInt(data.limit);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      errors.push('Limit must be between 1 and 100');
    }
  }

  // Sort validation
  if (data.sortBy !== undefined) {
    const validSortFields = ['createdAt', 'updatedAt', 'title', 'viewCount', 'buildCount', 'averageRating', 'estimatedCostCents'];
    if (!validSortFields.includes(data.sortBy)) {
      errors.push('Invalid sort field');
    }
  }

  if (data.sortOrder !== undefined && !['asc', 'desc'].includes(data.sortOrder)) {
    errors.push('Sort order must be asc or desc');
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: data as ProjectFilters
  };
}

// ============================================================================
// HELPER VALIDATORS
// ============================================================================

/**
 * Validate ID format (supports both UUID and CUID)
 * CUID format: c[a-z0-9]{24,32} (e.g., cmixvbx2200019mv7k1tl7l2o)
 * UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export function isValidUUID(id: string): boolean {
  // UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // CUID format (starts with 'c', followed by 24-32 alphanumeric chars)
  const cuidRegex = /^c[a-z0-9]{24,32}$/i;
  
  return uuidRegex.test(id) || cuidRegex.test(id);
}

export function isValidSlug(slug: string): boolean {
  const slugRegex = /^[a-z0-9-]+$/;
  return slugRegex.test(slug);
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidYoutubeUrl(url: string): boolean {
  if (!isValidUrl(url)) return false;
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//;
  return youtubeRegex.test(url);
}

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}
