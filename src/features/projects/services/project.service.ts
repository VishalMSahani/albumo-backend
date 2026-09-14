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
  ProjectListResponse,
  ProjectContentSectionInput
} from '../types/project.types.js';
import { generateSlug } from '../validators/project.validator.js';
import { createProjectSchema, updateProjectSchema } from '../validators/project.schema.js';
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
    
    estimatedCostCents: project.estimatedCostCents ?? undefined,
    costEstimateMinCents: project.costEstimateMinCents ?? undefined,
    costEstimateMaxCents: project.costEstimateMaxCents ?? undefined,
    estimatedCost,
    estimatedBuildTimeMinutes: project.estimatedBuildTimeMinutes ?? undefined,
    estimatedBuildTimeDisplay,
    
    preBuiltAvailable: project.preBuiltAvailable,
    preBuiltStock: project.preBuiltStock,
    preBuiltPriceCents: project.preBuiltPriceCents || undefined,
    preBuiltPrice,
    preBuiltImages: project.preBuiltImages || [],
    preBuiltSavings,
    
    thumbnailUrl: project.thumbnailUrl || undefined,
    heroImageUrl: project.heroImageUrl || undefined,
    heroVideoUrl: project.heroVideoUrl || undefined,
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

  if (project.contentSections && Array.isArray(project.contentSections)) {
    response.contentSections = project.contentSections.map((section: any) => ({
      id: section.id,
      sectionKey: section.sectionKey,
      heading: section.heading,
      body: section.body,
      sortOrder: section.sortOrder,
      diagramUrl: section.diagramUrl || undefined,
      code: section.code || undefined,
      repoUrl: section.repoUrl || undefined,
      steps: Array.isArray(section.steps) ? section.steps : [],
      faqs: Array.isArray(section.faqs) ? section.faqs : [],
    }));
  }

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
        note: pc.note || pc.notes || undefined,
        isOptional: pc.isOptional,
        component: {
          id: pc.component.id,
          name: pc.component.name,
          slug: pc.component.slug || undefined,
          sku: pc.component.sku || undefined,
          description: pc.component.description || undefined,
          typicalUseCase: pc.component.typicalUseCase || undefined,
          vendorLink: pc.component.vendorLink || undefined,
          imageUrl: pc.component.imageUrl || undefined,
          imageUrls: pc.component.imageUrls || [],
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
  if (filters.componentId) {
    where.projectComponents = { some: { componentId: filters.componentId, component: { isActive: true } } };
  }

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
function definedFields<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

function componentData(component: { componentId: string; quantity: number; note?: string | undefined; notes?: string | undefined; isOptional?: boolean | undefined }) {
  return { componentId: component.componentId, quantity: component.quantity,
    notes: component.note || component.notes || null, note: component.note || component.notes || null,
    isOptional: component.isOptional ?? false };
}

function sectionData(section: ProjectContentSectionInput) {
  return { sectionKey: section.sectionKey, heading: section.heading, body: section.body, sortOrder: section.sortOrder ?? 0,
    diagramUrl: section.diagramUrl || null, code: section.code || null, repoUrl: section.repoUrl || null,
    steps: section.steps ?? [], faqs: section.faqs ?? [] };
}

export async function createProject(input: CreateProjectRequest, createdById: string): Promise<ProjectResponse> {
  const data = createProjectSchema.parse(input);
  const slug = data.slug || generateSlug(data.title);
  if (!slug) throw new Error('Provide a URL slug using letters and numbers');
  const { components, componentIds, contentSections, ...fields } = data;
  const rows = components ?? componentIds?.map(componentId => ({ componentId, quantity: 1 })) ?? [];
  const project = await prisma.$transaction(async tx => {
    const existing = await tx.project.findUnique({ where: { slug } });
    if (existing) throw new Error(`A project with slug "${slug}" already exists`);
    return tx.project.create({
      data: {
        ...definedFields(fields), slug, createdById, tags: data.tags ?? [], learningOutcomes: data.learningOutcomes ?? [], prerequisites: data.prerequisites ?? [],
        preBuiltAvailable: data.preBuiltAvailable ?? false,
        preBuiltPriceCents: data.preBuiltAvailable ? data.preBuiltPriceCents ?? null : null,
        preBuiltStock: data.preBuiltAvailable ? data.preBuiltStock ?? 0 : 0,
        preBuiltImages: data.preBuiltImages ?? [], imageUrls: data.imageUrls ?? [], pdfUrls: data.pdfUrls ?? [],
        projectComponents: { create: rows.map(componentData) },
        contentSections: { create: (contentSections ?? []).map(sectionData) },
      },
      include: { createdBy: true, defaultMentor: true, projectComponents: { include: { component: true } }, contentSections: { orderBy: { sortOrder: 'asc' } } },
    });
  });
  return transformProjectToResponse(project, true);
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
      } : false,
      contentSections: includeComponents ? { orderBy: { sortOrder: 'asc' } } : false
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
      } : false,
      contentSections: includeComponents ? { orderBy: { sortOrder: 'asc' } } : false
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
export async function updateProject(projectId: string, input: UpdateProjectRequest): Promise<ProjectResponse> {
  const data = updateProjectSchema.parse(input);
  const updated = await prisma.$transaction(async tx => {
    const existing = await tx.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!existing) throw new Error('Project not found');
    if (data.slug && data.slug !== existing.slug) {
      const conflict = await tx.project.findUnique({ where: { slug: data.slug } });
      if (conflict) throw new Error(`A project with slug "${data.slug}" already exists`);
    }
    const effective = updateProjectSchema.parse({
      ...data, preBuiltAvailable: data.preBuiltAvailable ?? existing.preBuiltAvailable,
      preBuiltPriceCents: data.preBuiltPriceCents === undefined ? existing.preBuiltPriceCents : data.preBuiltPriceCents,
      costEstimateMinCents: data.costEstimateMinCents === undefined ? existing.costEstimateMinCents : data.costEstimateMinCents,
      costEstimateMaxCents: data.costEstimateMaxCents === undefined ? existing.costEstimateMaxCents : data.costEstimateMaxCents,
    });
    const { components, contentSections, ...fields } = effective;
    return tx.project.update({
      where: { id: projectId },
      data: {
        ...definedFields(fields),
        ...(!effective.preBuiltAvailable ? { preBuiltPriceCents: null, preBuiltStock: 0 } : {}),
        ...(components !== undefined ? { projectComponents: {
          deleteMany: { componentId: { notIn: components.map(row => row.componentId) } },
          upsert: components.map(row => ({
            where: { projectId_componentId: { projectId, componentId: row.componentId } },
            create: componentData(row), update: componentData(row),
          })),
        } } : {}),
        ...(contentSections !== undefined ? { contentSections: {
          deleteMany: { sectionKey: { notIn: contentSections.map(section => section.sectionKey) } },
          upsert: contentSections.map(section => ({
            where: { projectId_sectionKey: { projectId, sectionKey: section.sectionKey } },
            create: sectionData(section), update: sectionData(section),
          })),
        } } : {}),
      },
      include: { createdBy: true, defaultMentor: true, projectComponents: { include: { component: true } }, contentSections: { orderBy: { sortOrder: 'asc' } } },
    });
  });
  return transformProjectToResponse(updated, true);
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
