/**
 * Component Upload Controller
 * Handles component creation with image uploads to Azure Blob Storage
 */

import type { Request, Response, NextFunction } from 'express';
import { uploadFileToAzure, FileType, UPLOAD_LIMITS } from '../../../services/azure-storage.service.js';
import * as componentService from '../services/component.service.js';

// Define multer file structure
interface MulterFiles {
  images?: Express.Multer.File[];
  thumbnail?: Express.Multer.File[];
}

/**
 * Create component with image uploads
 * POST /api/components/upload
 * Access: Admin only
 */
export async function handleCreateComponentWithUploads(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const files = req.files as MulterFiles;
    const {
      name,
      sku,
      description,
      typicalUseCase,
      vendorLink,
      category,
      subcategory,
      productType,
      brand,
      tags,
      isBestSeller,
      isRobomaniacItem,
      isSoftware,
      unitPriceCents,
      discountedPriceCents,
      stockQuantity,
      isActive,
    } = req.body;

    // Validate required fields
    if (!name) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: name',
      });
      return;
    }

    if (!unitPriceCents) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: unitPriceCents',
      });
      return;
    }

    // Validate file counts
    const imageFiles = files?.images || [];
    const thumbnailFile = files?.thumbnail?.[0];

    if (imageFiles.length > UPLOAD_LIMITS.MAX_PROJECT_IMAGES) {
      res.status(400).json({
        success: false,
        error: `Maximum ${UPLOAD_LIMITS.MAX_PROJECT_IMAGES} images allowed`,
      });
      return;
    }
    // Images are optional — admin can also use imageUrl from body

    // Upload thumbnail if provided
    let thumbnailUrl: string | null = null;
    if (thumbnailFile) {
      const thumbnailResult = await uploadFileToAzure(
        thumbnailFile.buffer,
        thumbnailFile.originalname,
        thumbnailFile.mimetype,
        FileType.COMPONENT_IMAGE
      );

      if ('error' in thumbnailResult) {
        res.status(500).json({
          success: false,
          error: `Thumbnail upload failed: ${thumbnailResult.error}`,
        });
        return;
      }

      thumbnailUrl = thumbnailResult.url;
    }

    // Upload component images if provided
    const imageUrls: string[] = [];
    if (imageFiles.length > 0) {
      for (const imageFile of imageFiles) {
        const imageResult = await uploadFileToAzure(
          imageFile.buffer,
          imageFile.originalname,
          imageFile.mimetype,
          FileType.COMPONENT_IMAGE
        );

        if ('error' in imageResult) {
          res.status(500).json({
            success: false,
            error: `Image upload failed: ${imageResult.error}`,
          });
          return;
        }

        imageUrls.push(imageResult.url);
      }
    }

    // Use thumbnail as primary imageUrl, or first image if no thumbnail
    const primaryImageUrl = thumbnailUrl || (imageUrls.length > 0 ? imageUrls[0] : null);

    // Build component data
    const componentData: Record<string, unknown> = {
      name,
      unitPriceCents: parseInt(unitPriceCents, 10),
    };

    // Attach image URL only when we actually uploaded something
    if (primaryImageUrl) componentData.imageUrl = primaryImageUrl;

    // Add optional fields
    if (sku) componentData.sku = sku;
    if (description) componentData.description = description;
    if (typicalUseCase) componentData.typicalUseCase = typicalUseCase;
    if (vendorLink) componentData.vendorLink = vendorLink;
    if (category) componentData.category = category;
    if (subcategory) componentData.subcategory = subcategory;
    if (productType) componentData.productType = productType;
    if (brand) componentData.brand = brand;
    if (tags) componentData.tags = typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : tags;
    if (isBestSeller !== undefined) {
      componentData.isBestSeller = isBestSeller === 'true' || isBestSeller === true;
    }
    if (isRobomaniacItem !== undefined) {
      componentData.isRobomaniacItem =
        isRobomaniacItem === 'true' || isRobomaniacItem === true;
    }
    if (isSoftware !== undefined) {
      componentData.isSoftware = isSoftware === 'true' || isSoftware === true;
    }
    if (stockQuantity !== undefined) componentData.stockQuantity = parseInt(stockQuantity, 10);
    if (isActive !== undefined) componentData.isActive = isActive === 'true' || isActive === true;
    if (discountedPriceCents !== undefined && discountedPriceCents !== '') {
      componentData.discountedPriceCents =
        discountedPriceCents === null ? null : parseInt(discountedPriceCents, 10);
    } else {
      componentData.discountedPriceCents = null;
    }

    // Create component in database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component = await componentService.createComponent(componentData as any);

    res.status(201).json({
      success: true,
      data: {
        component,
        uploads: {
          thumbnailUrl,
          imageUrls,
        },
      },
      message: 'Component created successfully with uploads',
    });
  } catch (error: any) {
    console.error('Component upload error:', error);

    if (error.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: 'Component with this SKU already exists',
      });
      return;
    }

    next(error);
  }
}

/**
 * Upload a single image and return its URL
 * POST /api/components/upload/image
 * Access: Admin only
 */
export async function handleSingleImageUpload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: 'No image file provided' });
      return;
    }

    const result = await uploadFileToAzure(
      file.buffer,
      file.originalname,
      file.mimetype,
      FileType.COMPONENT_IMAGE
    );

    if ('error' in result) {
      res.status(500).json({ success: false, error: result.error });
      return;
    }

    res.status(200).json({ success: true, url: result.url });
  } catch (error) {
    next(error);
  }
}
