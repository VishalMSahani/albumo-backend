/**
 * Admin Project Upload Controller
 * Handles project creation with image and PDF uploads
 */

import type { Request, Response } from 'express';
import {
  uploadFileToAzure,
  uploadMultipleFilesToAzure,
  FileType,
  UPLOAD_LIMITS,
} from '../../../services/azure-storage.service.js';
import { createProject } from '../services/project.service.js';
import { ProjectCategory, DifficultyLevel, ProjectType } from '../../../generated/prisma/enums.js';

interface MulterFiles {
  images?: Express.Multer.File[];
  pdfs?: Express.Multer.File[];
  thumbnail?: Express.Multer.File[];
}

/**
 * POST /api/projects/upload
 * Create a new project with file uploads (Admin only)
 * Multipart form data with:
 * - images: File[] (max 5 images)
 * - pdfs: File[] (max 5 PDFs)
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
 * - componentIds: string[] (JSON array)
 * - isFeatured: boolean
 * - isPublic: boolean
 * - preBuiltAvailable: boolean
 * - preBuiltStock: number
 * - preBuiltPriceCents: number
 */
export async function handleCreateProjectWithUploads(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const files = req.files as MulterFiles;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated',
      });
      return;
    }

    // Validate required fields
    const { title, category, description, difficulty } = req.body;

    if (!title || !category || !description || !difficulty) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: title, category, description, difficulty',
      });
      return;
    }

    // Validate category and difficulty
    if (!Object.values(ProjectCategory).includes(category as ProjectCategory)) {
      res.status(400).json({
        success: false,
        error: `Invalid category. Allowed: ${Object.values(ProjectCategory).join(', ')}`,
      });
      return;
    }

    if (!Object.values(DifficultyLevel).includes(difficulty as DifficultyLevel)) {
      res.status(400).json({
        success: false,
        error: `Invalid difficulty. Allowed: ${Object.values(DifficultyLevel).join(', ')}`,
      });
      return;
    }

    // Upload thumbnail (if provided)
    let thumbnailUrl: string | undefined;
    if (files?.thumbnail && files.thumbnail.length > 0) {
      const thumbnailFile = files.thumbnail[0]!;
      const uploadResult = await uploadFileToAzure(
        thumbnailFile.buffer,
        thumbnailFile.originalname,
        thumbnailFile.mimetype,
        FileType.PROJECT_THUMBNAIL
      );

      if ('success' in uploadResult && !uploadResult.success) {
        res.status(400).json({
          success: false,
          error: `Thumbnail upload failed: ${uploadResult.error}`,
        });
        return;
      }

      thumbnailUrl = (uploadResult as any).url;
    }

    // Upload project images (if provided)
    let imageUrls: string[] = [];
    if (files?.images && files.images.length > 0) {
      if (files.images.length > UPLOAD_LIMITS.MAX_PROJECT_IMAGES) {
        res.status(400).json({
          success: false,
          error: `Maximum ${UPLOAD_LIMITS.MAX_PROJECT_IMAGES} images allowed`,
        });
        return;
      }

      const imagesToUpload = files.images.map((file) => ({
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
      }));

      const uploadResult = await uploadMultipleFilesToAzure(
        imagesToUpload,
        FileType.PROJECT_IMAGE,
        UPLOAD_LIMITS.MAX_PROJECT_IMAGES
      );

      if (!uploadResult.success) {
        res.status(400).json({
          success: false,
          error: `Image upload failed: ${uploadResult.error}`,
        });
        return;
      }

      imageUrls = uploadResult.urls;
    }

    // Upload PDF documents (if provided)
    let pdfUrls: string[] = [];
    if (files?.pdfs && files.pdfs.length > 0) {
      if (files.pdfs.length > UPLOAD_LIMITS.MAX_PROJECT_PDFS) {
        res.status(400).json({
          success: false,
          error: `Maximum ${UPLOAD_LIMITS.MAX_PROJECT_PDFS} PDFs allowed`,
        });
        return;
      }

      const pdfsToUpload = files.pdfs.map((file) => ({
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
      }));

      const uploadResult = await uploadMultipleFilesToAzure(
        pdfsToUpload,
        FileType.PROJECT_PDF,
        UPLOAD_LIMITS.MAX_PROJECT_PDFS
      );

      if (!uploadResult.success) {
        res.status(400).json({
          success: false,
          error: `PDF upload failed: ${uploadResult.error}`,
        });
        return;
      }

      pdfUrls = uploadResult.urls;
    }

    // Parse JSON fields
    const tags = req.body.tags ? JSON.parse(req.body.tags) : [];
    const prerequisites = req.body.prerequisites ? JSON.parse(req.body.prerequisites) : [];
    const learningOutcomes = req.body.learningOutcomes ? JSON.parse(req.body.learningOutcomes) : [];
    const componentIds = req.body.componentIds ? JSON.parse(req.body.componentIds) : [];
    const externalLinks = req.body.externalLinks ? JSON.parse(req.body.externalLinks) : [];

    // Prepare project data
    const projectData: any = {
      title: req.body.title,
      summary: req.body.summary || null,
      description: req.body.description,
      category: req.body.category as ProjectCategory,
      tags,
      difficulty: req.body.difficulty as DifficultyLevel,
      projectType: (req.body.projectType as ProjectType) || ProjectType.FEATURED,
      learningOutcomes,
      prerequisites,
      isFeatured: req.body.isFeatured === 'true',
      isPublic: req.body.isPublic !== 'false', // Default to true
      componentIds,
    };

    // Add optional fields only if they have values
    if (req.body.slug) projectData.slug = req.body.slug;
    if (req.body.estimatedCostCents) projectData.estimatedCostCents = parseInt(req.body.estimatedCostCents);
    if (req.body.estimatedBuildTimeMinutes) projectData.estimatedBuildTimeMinutes = parseInt(req.body.estimatedBuildTimeMinutes);
    if (req.body.preBuiltAvailable === 'true') projectData.preBuiltAvailable = true;
    if (req.body.preBuiltStock) projectData.preBuiltStock = parseInt(req.body.preBuiltStock);
    if (req.body.preBuiltPriceCents) projectData.preBuiltPriceCents = parseInt(req.body.preBuiltPriceCents);
    if (imageUrls.length > 0) projectData.preBuiltImages = imageUrls;
    if (thumbnailUrl) projectData.thumbnailUrl = thumbnailUrl;
    if (req.body.youtubeUrl) projectData.youtubeUrl = req.body.youtubeUrl;

    // Create project
    const project = await createProject(projectData, userId);

    // Return success response with uploaded URLs
    res.status(201).json({
      success: true,
      data: {
        project,
        uploads: {
          thumbnailUrl,
          imageUrls,
          pdfUrls,
          externalLinks,
        },
      },
      message: 'Project created successfully with uploads',
    });
  } catch (error: any) {
    console.error('Error creating project with uploads:', error);

    if (error.message.includes('already exists')) {
      res.status(409).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create project with uploads',
      details: error.message,
    });
  }
}

/**
 * PUT /api/projects/:id/upload
 * Update an existing project with additional file uploads (Admin only)
 * Multipart form data with same fields as create, plus option to add more files
 */
export async function handleUpdateProjectWithUploads(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
    const files = req.files as MulterFiles;

    if (!id) {
      res.status(400).json({
        success: false,
        error: 'Project ID is required',
      });
      return;
    }

    // Upload new files to Azure if provided
    let newThumbnailUrl: string | undefined;
    let newImageUrls: string[] = [];
    let newPdfUrls: string[] = [];

    // Upload new thumbnail
    if (files?.thumbnail && files.thumbnail.length > 0) {
      const thumbnailFile = files.thumbnail[0]!;
      const uploadResult = await uploadFileToAzure(
        thumbnailFile.buffer,
        thumbnailFile.originalname,
        thumbnailFile.mimetype,
        FileType.PROJECT_THUMBNAIL
      );

      if ('success' in uploadResult && !uploadResult.success) {
        res.status(400).json({
          success: false,
          error: `Thumbnail upload failed: ${uploadResult.error}`,
        });
        return;
      }

      newThumbnailUrl = (uploadResult as any).url;
    }

    // Upload new images
    if (files?.images && files.images.length > 0) {
      const imagesToUpload = files.images.map((file) => ({
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
      }));

      const uploadResult = await uploadMultipleFilesToAzure(
        imagesToUpload,
        FileType.PROJECT_IMAGE,
        UPLOAD_LIMITS.MAX_PROJECT_IMAGES
      );

      if (!uploadResult.success) {
        res.status(400).json({
          success: false,
          error: `Image upload failed: ${uploadResult.error}`,
        });
        return;
      }

      newImageUrls = uploadResult.urls;
    }

    // Upload new PDFs
    if (files?.pdfs && files.pdfs.length > 0) {
      const pdfsToUpload = files.pdfs.map((file) => ({
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
      }));

      const uploadResult = await uploadMultipleFilesToAzure(
        pdfsToUpload,
        FileType.PROJECT_PDF,
        UPLOAD_LIMITS.MAX_PROJECT_PDFS
      );

      if (!uploadResult.success) {
        res.status(400).json({
          success: false,
          error: `PDF upload failed: ${uploadResult.error}`,
        });
        return;
      }

      newPdfUrls = uploadResult.urls;
    }

    // Parse external links if provided
    let externalLinks: any[] = [];
    if (req.body.externalLinks) {
      try {
        externalLinks = JSON.parse(req.body.externalLinks);
      } catch (e) {
        res.status(400).json({
          success: false,
          error: 'Invalid externalLinks format. Must be a valid JSON array.',
        });
        return;
      }
    }

    // Parse existing arrays from request
    const parseArray = (field: string): string[] => {
      if (!req.body[field]) return [];
      try {
        return JSON.parse(req.body[field]);
      } catch (e) {
        return [];
      }
    };

    // Get existing project data
    const { getProjectById } = await import('../services/project.service.js');
    const existingProject = await getProjectById(id);
    
    if (!existingProject) {
      res.status(404).json({
        success: false,
        error: 'Project not found',
      });
      return;
    }

    // Merge existing and new URLs
    const existingImageUrls = existingProject.imageUrls || [];
    const existingPdfUrls = existingProject.pdfUrls || [];
    const existingExternalLinks = existingProject.externalLinks || [];

    const mergedImageUrls = req.body.replaceImages === 'true' 
      ? newImageUrls 
      : [...existingImageUrls, ...newImageUrls].slice(0, UPLOAD_LIMITS.MAX_PROJECT_IMAGES);

    const mergedPdfUrls = req.body.replacePdfs === 'true'
      ? newPdfUrls
      : [...existingPdfUrls, ...newPdfUrls].slice(0, UPLOAD_LIMITS.MAX_PROJECT_PDFS);

    const mergedExternalLinks = req.body.replaceLinks === 'true'
      ? externalLinks
      : [...existingExternalLinks, ...externalLinks];

    // Build update data
    const updateData: any = {};
    
    // Update fields only if provided
    if (req.body.title) updateData.title = req.body.title;
    if (req.body.summary) updateData.summary = req.body.summary;
    if (req.body.description) updateData.description = req.body.description;
    if (req.body.category) updateData.category = req.body.category as ProjectCategory;
    if (req.body.difficulty) updateData.difficulty = req.body.difficulty as DifficultyLevel;
    if (req.body.tags) updateData.tags = parseArray('tags');
    if (req.body.prerequisites) updateData.prerequisites = parseArray('prerequisites');
    if (req.body.learningOutcomes) updateData.learningOutcomes = parseArray('learningOutcomes');
    if (req.body.estimatedCostCents) updateData.estimatedCostCents = parseInt(req.body.estimatedCostCents);
    if (req.body.estimatedBuildTimeMinutes) updateData.estimatedBuildTimeMinutes = parseInt(req.body.estimatedBuildTimeMinutes);
    if (req.body.youtubeUrl !== undefined) updateData.youtubeUrl = req.body.youtubeUrl || null;
    if (req.body.isFeatured !== undefined) updateData.isFeatured = req.body.isFeatured === 'true';
    if (req.body.isPublic !== undefined) updateData.isPublic = req.body.isPublic === 'true';
    
    // Update media fields
    if (newThumbnailUrl) updateData.thumbnailUrl = newThumbnailUrl;
    if (newImageUrls.length > 0 || req.body.replaceImages === 'true') updateData.imageUrls = mergedImageUrls;
    if (newPdfUrls.length > 0 || req.body.replacePdfs === 'true') updateData.pdfUrls = mergedPdfUrls;
    if (externalLinks.length > 0 || req.body.replaceLinks === 'true') updateData.externalLinks = mergedExternalLinks;

    // Update component IDs if provided
    if (req.body.componentIds) {
      const componentIds = parseArray('componentIds');
      updateData.components = componentIds.map((componentId: string) => ({
        componentId,
        quantity: 1, // Default quantity
      }));
    }

    // Update project
    const { updateProject } = await import('../services/project.service.js');
    const updatedProject = await updateProject(id, updateData);

    res.status(200).json({
      success: true,
      data: {
        project: updatedProject,
        uploads: {
          newThumbnailUrl,
          newImageUrls,
          newPdfUrls,
          mergedImageUrls,
          mergedPdfUrls,
          mergedExternalLinks,
        },
      },
      message: 'Project updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating project with uploads:', error);

    res.status(500).json({
      success: false,
      error: 'Failed to update project',
      details: error.message,
    });
  }
}

export default {
  handleCreateProjectWithUploads,
  handleUpdateProjectWithUploads,
};
