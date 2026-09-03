/**
 * Project Service
 * Business logic for project operations
 */

import { prisma } from '../../../lib/prisma.js';
import { ProjectCategory, DifficultyLevel } from '../../../generated/prisma/enums.js';
import type {
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectFilters,
  ProjectResponse,
  ProjectListResponse
} from '../types/project.types.js';
import { generateSlug } from '../validators/project.validator.js';
import { CATEGORY_INFO, DIFFICULTY_DISPLAY } from '../types/project.types.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Transform database project to response format
 */
function transformProjectToResponse(project: any, includeCreator: boolean = false): ProjectResponse {
  const categoryInfo = CATEGORY_INFO[project.category as ProjectCategory];
  const difficultyDisplay = DIFFICULTY_DISPLAY[project.difficulty as DifficultyLevel];

  // Calculate estimated cost in rupees
  const estimatedCost = project.estimatedCostCents ? project.estimatedCostCents / 100 : undefined;
  const preBuiltPrice = project.preBuiltPriceCents ? project.preBuiltPriceCents / 100 : undefined;

  // Calculate savings if pre-built is available and cheaper
  let preBuiltSavings: number | undefined;
  if (estimatedCost && preBuiltPrice && preBuiltPrice < estimatedCost) {
    preBuiltSavings = estimatedCost - preBuiltPrice;
  }

  // Format build time display
  let estimatedBuildTimeDisplay: string | undefined;
  if (project.estimatedBuildTimeMinutes) {
    const hours = Math.floor(project.estimatedBuildTimeMinutes / 60);
    const minutes = project.estimatedBuildTimeMinutes % 60;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      estimatedBuildTimeDisplay = remainingHours > 0 
        ? `${days} day${days > 1 ? 's' : ''} ${remainingHours} hour${remainingHours > 1 ? 's' : ''}`
        : `${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      estimatedBuildTimeDisplay = minutes > 0
        ? `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`
        : `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      estimatedBuildTimeDisplay = `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
  }

  // Format YouTube embed URL
  let youtubeEmbedUrl: string | undefined;
  if (project.youtubeUrl) {
    const url = project.youtubeUrl;
    let videoId: string | null = null;
    
    // Extract video ID from various YouTube URL formats
    if (url.includes('youtube.com/watch')) {
      const urlParams = new URL(url).searchParams;
      videoId = urlParams.get('v');
    } else if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split('?')[0];
    }
    
    if (videoId) {
      youtubeEmbedUrl = `https://www.youtube.com/embed/${videoId}`;
    }
  }

  const response: any = {
    id: project.id,
    title: project.title,
    slug: project.slug,
    summary: project.summary || undefined,
    description: project.description || undefined,
    
    category: project.category,
    categoryDisplay: categoryInfo.label,
    tags: project.tags || [],
    
    difficulty: project.difficulty,
    difficultyDisplay,
    projectType: project.projectType,
    
    estimatedCostCents: project.estimatedCostCents || undefined,
    estimatedCost,
    estimatedBuildTimeMinutes: project.estimatedBuildTimeMinutes || undefined,
    estimatedBuildTimeDisplay,
    
    preBuiltAvailable: project.preBuiltAvailable,
    preBuiltStock: project.preBuiltStock,
    preBuiltPriceCents: project.preBuiltPriceCents || undefined,
    preBuiltPrice,
    preBuiltImages: project.preBuiltImages || [],
    preBuiltSavings,
    
    thumbnailUrl: project.thumbnailUrl || undefined,
    imageUrls: project.imageUrls || [],
    youtubeUrl: project.youtubeUrl || undefined,
    youtubeEmbedUrl,
    pdfUrls: project.pdfUrls || [],
    externalLinks: Array.isArray(project.externalLinks) ? project.externalLinks : 
                   typeof project.externalLinks === 'string' ? JSON.parse(project.externalLinks) : [],
    
    learningOutcomes: project.learningOutcomes || [],
    prerequisites: project.prerequisites || [],
    
    isFeatured: project.isFeatured,
    isPublic: project.isPublic,
    isAIGenerated: project.isAIGenerated,
    publishedAt: project.publishedAt || undefined,
    
    viewCount: project.viewCount,
    buildCount: project.buildCount,
    averageRating: project.averageRating,
    
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };

  // Add creator info if included
  if (includeCreator && project.createdBy) {
    response.createdBy = {
      id: project.createdBy.id,
      name: project.createdBy.name || undefined,
      email: project.createdBy.email
    };
  }

  // Add mentor info if included
  if (project.defaultMentor) {
    response.defaultMentor = {
      id: project.defaultMentor.id,
      name: project.defaultMentor.name,
      expertise: project.defaultMentor.expertise || []
    };
  }

  // Add component details if included
  if (project.projectComponents && Array.isArray(project.projectComponents)) {
    let totalComponentsCost = 0;
    response.components = project.projectComponents.map((pc: any) => {
      const unitPrice = pc.component.unitPriceCents / 100;
      const totalCost = (pc.component.unitPriceCents * pc.quantity) / 100;
      totalComponentsCost += totalCost;
      
      return {
        id: pc.id,
        componentId: pc.componentId,
        quantity: pc.quantity,
        notes: pc.notes || undefined,
        component: {
          id: pc.component.id,
          name: pc.component.name,
          sku: pc.component.sku || undefined,
          description: pc.component.description || undefined,
          typicalUseCase: pc.component.typicalUseCase || undefined,
          vendorLink: pc.component.vendorLink || undefined,
          imageUrl: pc.component.imageUrl || undefined,
          unitPriceCents: pc.component.unitPriceCents,
          unitPrice,
          stockQuantity: pc.component.stockQuantity,
          isActive: pc.component.isActive
        },
        totalCost
      };
    });
    response.componentsCount = project.projectComponents.length;
    response.totalComponentsCost = totalComponentsCost;
  }

  return response as ProjectResponse;
}

/**
 * Build filter conditions for Prisma query
 */
function buildFilterConditions(filters: ProjectFilters) {
  const where: any = { deletedAt: null };

  // Category filter
  if (filters.category) {
    where.category = Array.isArray(filters.category)
      ? { in: filters.category }
      : filters.category;
  }

  // Difficulty filter
  if (filters.difficulty) {
    where.difficulty = Array.isArray(filters.difficulty)
      ? { in: filters.difficulty }
      : filters.difficulty;
  }

  // Project type filter
  if (filters.projectType) {
    where.projectType = filters.projectType;
  }

  // Tags filter
  if (filters.tags) {
    const tagsArray = Array.isArray(filters.tags) ? filters.tags : [filters.tags];
    where.tags = { hasSome: tagsArray };
  }

  // Boolean filters
  if (filters.isFeatured !== undefined) {
    where.isFeatured = filters.isFeatured;
  }

  if (filters.isPublic !== undefined) {
    where.isPublic = filters.isPublic;
  }

  if (filters.isAIGenerated !== undefined) {
    where.isAIGenerated = filters.isAIGenerated;
  }

  if (filters.preBuiltAvailable !== undefined) {
    where.preBuiltAvailable = filters.preBuiltAvailable;
  }

  // Price range filter
  if (filters.minCost !== undefined || filters.maxCost !== undefined) {
    where.estimatedCostCents = {};
    if (filters.minCost !== undefined) {
      where.estimatedCostCents.gte = filters.minCost * 100; // Convert to cents
    }
    if (filters.maxCost !== undefined) {
      where.estimatedCostCents.lte = filters.maxCost * 100; // Convert to cents
    }
  }

  // Build time range filter
  if (filters.minBuildTime !== undefined || filters.maxBuildTime !== undefined) {
    where.estimatedBuildTimeMinutes = {};
    if (filters.minBuildTime !== undefined) {
      where.estimatedBuildTimeMinutes.gte = filters.minBuildTime;
    }
    if (filters.maxBuildTime !== undefined) {
      where.estimatedBuildTimeMinutes.lte = filters.maxBuildTime;
    }
  }

  // Search filter (title, summary, description)
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { summary: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } }
    ];
  }

  return where;
}

// ============================================================================
// PROJECT CRUD OPERATIONS
// ============================================================================

/**
 * Create a new project
 */
export async function createProject(data: CreateProjectRequest, createdById: string): Promise<ProjectResponse> {
  // Generate slug if not provided
  const slug = data.slug || generateSlug(data.title);

  // Check if slug already exists
  const existingProject = await prisma.project.findUnique({
    where: { slug }
  });

  if (existingProject) {
    throw new Error(`A project with slug "${slug}" already exists`);
  }

  // Create project
  const project = await prisma.project.create({
    data: {
      title: data.title,
      slug,
      summary: data.summary || null,
      description: data.description || null,
      
      category: data.category,
      tags: data.tags || [],
      
      difficulty: data.difficulty,
      projectType: data.projectType || 'FEATURED',
      
      estimatedCostCents: data.estimatedCostCents || null,
      estimatedBuildTimeMinutes: data.estimatedBuildTimeMinutes || null,
      
      preBuiltAvailable: data.preBuiltAvailable || false,
      preBuiltStock: data.preBuiltStock || 0,
      preBuiltPriceCents: data.preBuiltPriceCents || null,
      preBuiltImages: data.preBuiltImages || [],
      
      thumbnailUrl: data.thumbnailUrl || null,
      youtubeUrl: data.youtubeUrl || null,
      
      learningOutcomes: data.learningOutcomes || [],
      prerequisites: data.prerequisites || [],
      
      isFeatured: data.isFeatured || false,
      isPublic: data.isPublic !== undefined ? data.isPublic : true,
      isAIGenerated: false, // Manual projects are not AI generated
      
      createdById,
      defaultMentorId: data.defaultMentorId || null
    },
    include: {
      createdBy: true,
      defaultMentor: true
    }
  });

  // If component IDs are provided, create project-component relations
  if (data.components && data.components.length > 0) {
    // New format with quantities
    await Promise.all(
      data.components.map((comp) =>
        prisma.projectComponent.create({
          data: {
            projectId: project.id,
            componentId: comp.componentId,
            quantity: comp.quantity,
            notes: comp.notes || null
          }
        })
      )
    );
  } else if (data.componentIds && data.componentIds.length > 0) {
    // Backward compatibility - simple ID array
    await Promise.all(
      data.componentIds.map((componentId) =>
        prisma.projectComponent.create({
          data: {
            projectId: project.id,
            componentId,
            quantity: 1, // Default quantity
            notes: null
          }
        })
      )
    );
  }

  // Re-fetch project with components to include in response
  const projectWithComponents = await prisma.project.findUnique({
    where: { id: project.id },
    include: {
      createdBy: true,
      defaultMentor: true,
      projectComponents: {
        include: {
          component: true
        }
      }
    }
  });

  return transformProjectToResponse(projectWithComponents!, true);
}

/**
 * Get project by ID with component details
 */
export async function getProjectById(projectId: string, includeComponents: boolean = false): Promise<ProjectResponse | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: {
      createdBy: true,
      defaultMentor: true,
      projectComponents: includeComponents ? {
        include: {
          component: true
        }
      } : false
    }
  });

  if (!project) {
    return null;
  }

  return transformProjectToResponse(project, true);
}

/**
 * Get project by slug with component details
 */
export async function getProjectBySlug(slug: string, includeComponents: boolean = false): Promise<ProjectResponse | null> {
  const project = await prisma.project.findFirst({
    where: { slug, deletedAt: null },
    include: {
      createdBy: true,
      defaultMentor: true,
      projectComponents: includeComponents ? {
        include: {
          component: true
        }
      } : false
    }
  });

  if (!project) {
    return null;
  }

  return transformProjectToResponse(project, true);
}

/**
 * List projects with filters and pagination
 */
export async function listProjects(filters: ProjectFilters): Promise<ProjectListResponse> {
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const skip = (page - 1) * limit;

  const where = buildFilterConditions(filters);

  // Build orderBy
  const sortBy = filters.sortBy || 'createdAt';
  const sortOrder = filters.sortOrder || 'desc';
  const orderBy: any = { [sortBy]: sortOrder };

  // Fetch projects and total count
  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      include: {
        createdBy: true,
        defaultMentor: true,
        projectComponents: {
          include: {
            component: true
          }
        }
      },
      skip,
      take: limit,
      orderBy
    }),
    prisma.project.count({ where })
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    projects: projects.map((p: any) => transformProjectToResponse(p, false)),
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  };
}

/**
 * Update a project
 */
export async function updateProject(
  projectId: string,
  data: UpdateProjectRequest
): Promise<ProjectResponse> {
  // Check if project exists
  const existingProject = await prisma.project.findUnique({
    where: { id: projectId }
  });

  if (!existingProject) {
    throw new Error('Project not found');
  }

  // If slug is being updated, check for conflicts
  if (data.slug && data.slug !== existingProject.slug) {
    const slugConflict = await prisma.project.findUnique({
      where: { slug: data.slug }
    });

    if (slugConflict) {
      throw new Error(`A project with slug "${data.slug}" already exists`);
    }
  }

  // Build update data with proper null handling
  const updateData: any = {};
  Object.keys(data).forEach((key) => {
    // Skip components key as we'll handle it separately
    if (key === 'components') return;
    
    const value = (data as any)[key];
    updateData[key] = value === undefined ? null : value;
  });

  // Handle component updates if provided
  if (data.components) {
    // Delete existing component relations
    await prisma.projectComponent.deleteMany({
      where: { projectId }
    });

    // Create new component relations
    await Promise.all(
      data.components.map((comp) =>
        prisma.projectComponent.create({
          data: {
            projectId,
            componentId: comp.componentId,
            quantity: comp.quantity,
            notes: comp.notes || null
          }
        })
      )
    );
  }

  // Update project
  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: updateData,
    include: {
      createdBy: true,
      defaultMentor: true,
      projectComponents: {
        include: {
          component: true
        }
      }
    }
  });

  return transformProjectToResponse(updatedProject, true);
}

/**
 * Soft-delete a project (sets deletedAt; never hard-deletes)
 */
export async function deleteProject(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project || project.deletedAt) {
    throw new Error('Project not found');
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date(), isPublic: false },
  });
}

/**
 * Increment view count
 */
export async function incrementViewCount(projectId: string): Promise<void> {
  await prisma.project.update({
    where: { id: projectId },
    data: {
      viewCount: { increment: 1 }
    }
  });
}

/**
 * Update pre-built stock
 */
export async function updatePreBuiltStock(
  projectId: string,
  stockChange: number
): Promise<ProjectResponse> {
  const project = await prisma.project.findUnique({
    where: { id: projectId }
  });

  if (!project) {
    throw new Error('Project not found');
  }

  const newStock = project.preBuiltStock + stockChange;

  if (newStock < 0) {
    throw new Error('Insufficient stock');
  }

  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: {
      preBuiltStock: newStock
    },
    include: {
      createdBy: true,
      defaultMentor: true
    }
  });

  return transformProjectToResponse(updatedProject, true);
}

// ============================================================================
// CATEGORY OPERATIONS
// ============================================================================

/**
 * Get all categories with project counts
 */
export async function getCategoriesWithCounts(): Promise<Array<{ category: ProjectCategory; count: number }>> {
  const categoryCounts = await prisma.project.groupBy({
    by: ['category'],
    _count: true,
    where: { isPublic: true }
  });

  return categoryCounts.map((item: any) => ({
    category: item.category,
    count: item._count
  }));
}

/**
 * Get featured projects by category
 */
export async function getFeaturedProjectsByCategory(category: ProjectCategory, limit: number = 6): Promise<ProjectResponse[]> {
  const projects = await prisma.project.findMany({
    where: {
      category,
      isFeatured: true,
      isPublic: true
    },
    include: {
      createdBy: true,
      defaultMentor: true,
      projectComponents: {
        include: {
          component: true
        }
      }
    },
    take: limit,
    orderBy: { viewCount: 'desc' }
  });

  return projects.map((p: any) => transformProjectToResponse(p, false));
}
