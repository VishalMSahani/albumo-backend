/**
 * Project Validators
 * Manual validation for project-related requests (consistent with components module)
 */

import { ProjectCategory, DifficultyLevel, ProjectType } from '../../../generated/prisma/enums.js';
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
export function validateCreateProject(data: any): ValidationResult<CreateProjectRequest> {
  const errors: string[] = [];

  // Title validation
  if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
    errors.push('Title is required');
  } else if (data.title.trim().length < 3) {
    errors.push('Title must be at least 3 characters');
  } else if (data.title.trim().length > 200) {
    errors.push('Title must not exceed 200 characters');
  }

  // Slug validation (optional)
  if (data.slug !== undefined && data.slug !== null) {
    if (typeof data.slug !== 'string' || !/^[a-z0-9-]+$/.test(data.slug)) {
      errors.push('Slug must contain only lowercase letters, numbers, and hyphens');
    }
  }

  // Summary validation (optional)
  if (data.summary !== undefined && data.summary !== null) {
    if (typeof data.summary !== 'string') {
      errors.push('Summary must be a string');
    } else if (data.summary.trim().length > 300) {
      errors.push('Summary must not exceed 300 characters');
    }
  }

  // Description validation
  if (!data.description || typeof data.description !== 'string' || data.description.trim().length === 0) {
    errors.push('Description is required');
  }

  // Category validation
  if (!data.category || !Object.values(ProjectCategory).includes(data.category)) {
    errors.push('Valid category is required');
  }

  // Tags validation (optional array)
  if (data.tags !== undefined && data.tags !== null) {
    if (!Array.isArray(data.tags)) {
      errors.push('Tags must be an array');
    } else if (!data.tags.every((tag: any) => typeof tag === 'string')) {
      errors.push('All tags must be strings');
    }
  }

  // Difficulty validation
  if (!data.difficulty || !Object.values(DifficultyLevel).includes(data.difficulty)) {
    errors.push('Valid difficulty level is required');
  }

  // Project type validation (optional)
  if (data.projectType !== undefined && data.projectType !== null) {
    if (!Object.values(ProjectType).includes(data.projectType)) {
      errors.push('Invalid project type');
    }
  }

  // Cost validation (optional)
  if (data.estimatedCostCents !== undefined && data.estimatedCostCents !== null) {
    if (typeof data.estimatedCostCents !== 'number' || isNaN(data.estimatedCostCents)) {
      errors.push('Estimated cost must be a number');
    } else if (data.estimatedCostCents < 0) {
      errors.push('Estimated cost cannot be negative');
    }
  }

  // Build time validation (optional)
  if (data.estimatedBuildTimeMinutes !== undefined && data.estimatedBuildTimeMinutes !== null) {
    if (typeof data.estimatedBuildTimeMinutes !== 'number' || isNaN(data.estimatedBuildTimeMinutes)) {
      errors.push('Estimated build time must be a number');
    } else if (data.estimatedBuildTimeMinutes < 0) {
      errors.push('Estimated build time cannot be negative');
    }
  }

  // Pre-built validations
  if (data.preBuiltAvailable !== undefined && typeof data.preBuiltAvailable !== 'boolean') {
    errors.push('preBuiltAvailable must be a boolean');
  }

  if (data.preBuiltStock !== undefined && data.preBuiltStock !== null) {
    if (typeof data.preBuiltStock !== 'number' || isNaN(data.preBuiltStock)) {
      errors.push('Pre-built stock must be a number');
    } else if (data.preBuiltStock < 0) {
      errors.push('Pre-built stock cannot be negative');
    }
  }

  if (data.preBuiltPriceCents !== undefined && data.preBuiltPriceCents !== null) {
    if (typeof data.preBuiltPriceCents !== 'number' || isNaN(data.preBuiltPriceCents)) {
      errors.push('Pre-built price must be a number');
    } else if (data.preBuiltPriceCents < 0) {
      errors.push('Pre-built price cannot be negative');
    }
  }

  if (data.preBuiltImages !== undefined && data.preBuiltImages !== null) {
    if (!Array.isArray(data.preBuiltImages)) {
      errors.push('Pre-built images must be an array');
    } else if (!data.preBuiltImages.every((url: any) => typeof url === 'string' && isValidUrl(url))) {
      errors.push('All pre-built images must be valid URLs');
    }
  }

  // Media validations
  if (data.thumbnailUrl !== undefined && data.thumbnailUrl !== null) {
    if (typeof data.thumbnailUrl !== 'string' || !isValidUrl(data.thumbnailUrl)) {
      errors.push('Thumbnail URL must be a valid URL');
    }
  }

  if (data.youtubeUrl !== undefined && data.youtubeUrl !== null) {
    if (typeof data.youtubeUrl !== 'string' || !isValidYoutubeUrl(data.youtubeUrl)) {
      errors.push('YouTube URL must be a valid YouTube URL');
    }
  }

  // Learning info validations
  if (data.learningOutcomes !== undefined && data.learningOutcomes !== null) {
    if (!Array.isArray(data.learningOutcomes)) {
      errors.push('Learning outcomes must be an array');
    } else if (!data.learningOutcomes.every((item: any) => typeof item === 'string')) {
      errors.push('All learning outcomes must be strings');
    }
  }

  if (data.prerequisites !== undefined && data.prerequisites !== null) {
    if (!Array.isArray(data.prerequisites)) {
      errors.push('Prerequisites must be an array');
    } else if (!data.prerequisites.every((item: any) => typeof item === 'string')) {
      errors.push('All prerequisites must be strings');
    }
  }

  // Visibility flags
  if (data.isFeatured !== undefined && typeof data.isFeatured !== 'boolean') {
    errors.push('isFeatured must be a boolean');
  }

  if (data.isPublic !== undefined && typeof data.isPublic !== 'boolean') {
    errors.push('isPublic must be a boolean');
  }

  // Mentor ID validation (optional)
  if (data.defaultMentorId !== undefined && data.defaultMentorId !== null) {
    if (typeof data.defaultMentorId !== 'string' || !isValidUUID(data.defaultMentorId)) {
      errors.push('Default mentor ID must be a valid UUID');
    }
  }

  // Component IDs validation (backward compatibility - optional)
  if (data.componentIds !== undefined && data.componentIds !== null) {
    if (!Array.isArray(data.componentIds)) {
      errors.push('Component IDs must be an array');
    } else if (!data.componentIds.every((id: any) => typeof id === 'string' && isValidUUID(id))) {
      errors.push('All component IDs must be valid UUIDs');
    }
  }

  // Components with quantities validation (new format - optional)
  if (data.components !== undefined && data.components !== null) {
    if (!Array.isArray(data.components)) {
      errors.push('Components must be an array');
    } else {
      data.components.forEach((comp: any, index: number) => {
        if (!comp.componentId || typeof comp.componentId !== 'string' || !isValidUUID(comp.componentId)) {
          errors.push(`Component ${index + 1}: Invalid component ID`);
        }
        if (comp.quantity === undefined || typeof comp.quantity !== 'number' || comp.quantity < 1) {
          errors.push(`Component ${index + 1}: Quantity must be a positive number`);
        }
        if (comp.notes !== undefined && comp.notes !== null && typeof comp.notes !== 'string') {
          errors.push(`Component ${index + 1}: Notes must be a string`);
        }
      });
    }
  }

  // Cannot specify both componentIds and components
  if (data.componentIds && data.components) {
    errors.push('Cannot specify both componentIds and components. Use components for detailed list with quantities.');
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: data as CreateProjectRequest
  };
}

/**
 * Validate project update data
 */
export function validateUpdateProject(data: any): ValidationResult<UpdateProjectRequest> {
  const errors: string[] = [];

  // Check that at least one field is provided
  const hasFields = Object.keys(data).length > 0;
  if (!hasFields) {
    errors.push('At least one field must be provided for update');
    return { success: false, errors };
  }

  // Title validation (optional)
  if (data.title !== undefined) {
    if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
      errors.push('Title cannot be empty');
    } else if (data.title.trim().length < 3) {
      errors.push('Title must be at least 3 characters');
    } else if (data.title.trim().length > 200) {
      errors.push('Title must not exceed 200 characters');
    }
  }

  // Slug validation (optional)
  if (data.slug !== undefined) {
    if (typeof data.slug !== 'string' || !/^[a-z0-9-]+$/.test(data.slug)) {
      errors.push('Slug must contain only lowercase letters, numbers, and hyphens');
    }
  }

  // Summary validation (optional)
  if (data.summary !== undefined && data.summary !== null) {
    if (typeof data.summary !== 'string') {
      errors.push('Summary must be a string');
    } else if (data.summary.trim().length > 300) {
      errors.push('Summary must not exceed 300 characters');
    }
  }

  // Description validation (optional)
  if (data.description !== undefined) {
    if (!data.description || typeof data.description !== 'string' || data.description.trim().length === 0) {
      errors.push('Description cannot be empty');
    }
  }

  // Category validation (optional)
  if (data.category !== undefined && !Object.values(ProjectCategory).includes(data.category)) {
    errors.push('Invalid category');
  }

  // Tags validation (optional)
  if (data.tags !== undefined && data.tags !== null) {
    if (!Array.isArray(data.tags)) {
      errors.push('Tags must be an array');
    } else if (!data.tags.every((tag: any) => typeof tag === 'string')) {
      errors.push('All tags must be strings');
    }
  }

  // Difficulty validation (optional)
  if (data.difficulty !== undefined && !Object.values(DifficultyLevel).includes(data.difficulty)) {
    errors.push('Invalid difficulty level');
  }

  // Project type validation (optional)
  if (data.projectType !== undefined && data.projectType !== null) {
    if (!Object.values(ProjectType).includes(data.projectType)) {
      errors.push('Invalid project type');
    }
  }

  // Cost validation (optional)
  if (data.estimatedCostCents !== undefined && data.estimatedCostCents !== null) {
    if (typeof data.estimatedCostCents !== 'number' || isNaN(data.estimatedCostCents)) {
      errors.push('Estimated cost must be a number');
    } else if (data.estimatedCostCents < 0) {
      errors.push('Estimated cost cannot be negative');
    }
  }

  // Build time validation (optional)
  if (data.estimatedBuildTimeMinutes !== undefined && data.estimatedBuildTimeMinutes !== null) {
    if (typeof data.estimatedBuildTimeMinutes !== 'number' || isNaN(data.estimatedBuildTimeMinutes)) {
      errors.push('Estimated build time must be a number');
    } else if (data.estimatedBuildTimeMinutes < 0) {
      errors.push('Estimated build time cannot be negative');
    }
  }

  // Pre-built validations (optional)
  if (data.preBuiltAvailable !== undefined && typeof data.preBuiltAvailable !== 'boolean') {
    errors.push('preBuiltAvailable must be a boolean');
  }

  if (data.preBuiltStock !== undefined && data.preBuiltStock !== null) {
    if (typeof data.preBuiltStock !== 'number' || isNaN(data.preBuiltStock)) {
      errors.push('Pre-built stock must be a number');
    } else if (data.preBuiltStock < 0) {
      errors.push('Pre-built stock cannot be negative');
    }
  }

  if (data.preBuiltPriceCents !== undefined && data.preBuiltPriceCents !== null) {
    if (typeof data.preBuiltPriceCents !== 'number' || isNaN(data.preBuiltPriceCents)) {
      errors.push('Pre-built price must be a number');
    } else if (data.preBuiltPriceCents < 0) {
      errors.push('Pre-built price cannot be negative');
    }
  }

  if (data.preBuiltImages !== undefined && data.preBuiltImages !== null) {
    if (!Array.isArray(data.preBuiltImages)) {
      errors.push('Pre-built images must be an array');
    } else if (!data.preBuiltImages.every((url: any) => typeof url === 'string' && isValidUrl(url))) {
      errors.push('All pre-built images must be valid URLs');
    }
  }

  // Media validations (optional)
  if (data.thumbnailUrl !== undefined && data.thumbnailUrl !== null) {
    if (typeof data.thumbnailUrl !== 'string' || !isValidUrl(data.thumbnailUrl)) {
      errors.push('Thumbnail URL must be a valid URL');
    }
  }

  if (data.youtubeUrl !== undefined && data.youtubeUrl !== null) {
    if (typeof data.youtubeUrl !== 'string' || !isValidYoutubeUrl(data.youtubeUrl)) {
      errors.push('YouTube URL must be a valid YouTube URL');
    }
  }

  // Learning info validations (optional)
  if (data.learningOutcomes !== undefined && data.learningOutcomes !== null) {
    if (!Array.isArray(data.learningOutcomes)) {
      errors.push('Learning outcomes must be an array');
    } else if (!data.learningOutcomes.every((item: any) => typeof item === 'string')) {
      errors.push('All learning outcomes must be strings');
    }
  }

  if (data.prerequisites !== undefined && data.prerequisites !== null) {
    if (!Array.isArray(data.prerequisites)) {
      errors.push('Prerequisites must be an array');
    } else if (!data.prerequisites.every((item: any) => typeof item === 'string')) {
      errors.push('All prerequisites must be strings');
    }
  }

  // Visibility flags (optional)
  if (data.isFeatured !== undefined && typeof data.isFeatured !== 'boolean') {
    errors.push('isFeatured must be a boolean');
  }

  if (data.isPublic !== undefined && typeof data.isPublic !== 'boolean') {
    errors.push('isPublic must be a boolean');
  }

  // Mentor ID validation (optional)
  if (data.defaultMentorId !== undefined && data.defaultMentorId !== null) {
    if (typeof data.defaultMentorId !== 'string' || !isValidUUID(data.defaultMentorId)) {
      errors.push('Default mentor ID must be a valid UUID');
    }
  }

  // Components with quantities validation (optional)
  if (data.components !== undefined && data.components !== null) {
    if (!Array.isArray(data.components)) {
      errors.push('Components must be an array');
    } else {
      data.components.forEach((comp: any, index: number) => {
        if (!comp.componentId || typeof comp.componentId !== 'string' || !isValidUUID(comp.componentId)) {
          errors.push(`Component ${index + 1}: Invalid component ID`);
        }
        if (comp.quantity === undefined || typeof comp.quantity !== 'number' || comp.quantity < 1) {
          errors.push(`Component ${index + 1}: Quantity must be a positive number`);
        }
        if (comp.notes !== undefined && comp.notes !== null && typeof comp.notes !== 'string') {
          errors.push(`Component ${index + 1}: Notes must be a string`);
        }
      });
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: data as UpdateProjectRequest
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
