/**
 * File Upload Middleware
 * Handles multipart/form-data file uploads using Multer
 */

import multer, { type FileFilterCallback, type Multer } from 'multer';
import type { Request, RequestHandler } from 'express';
import { UPLOAD_LIMITS } from '../services/azure-storage.service.js';

// Type for upload middleware collections
interface UploadMiddlewares {
  uploadProjectFiles: RequestHandler;
  uploadComponentImages: RequestHandler;
  uploadSingleImage: RequestHandler;
  uploadMultipleImages: (maxCount?: number) => RequestHandler;
  uploadPDFs: (maxCount?: number) => RequestHandler;
  uploadThreeDModel: RequestHandler;
  uploadThreeDModels: RequestHandler;
}

// Configure multer to use memory storage
const storage = multer.memoryStorage();

// File filter for images
const imageFileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  if (UPLOAD_LIMITS.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid image type. Allowed: ${UPLOAD_LIMITS.ALLOWED_IMAGE_TYPES.join(', ')}`));
  }
};

// File filter for PDFs
const pdfFileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  if (file.mimetype === UPLOAD_LIMITS.ALLOWED_PDF_TYPE) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF files are allowed'));
  }
};

// Combined file filter for images and PDFs
const combinedFileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const isImage = UPLOAD_LIMITS.ALLOWED_IMAGE_TYPES.includes(file.mimetype);
  const isPdf = file.mimetype === UPLOAD_LIMITS.ALLOWED_PDF_TYPE;

  if (isImage || isPdf) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images (JPEG, PNG, WebP) and PDF files are allowed'));
  }
};

const threeDModelFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) => {
  const extension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf("."));
  if (extension === ".stl" || extension === ".obj") {
    cb(null, true);
    return;
  }
  cb(new Error("Invalid model type. Only STL and OBJ files are supported"));
};

export const uploadThreeDModel: RequestHandler = multer({
  storage,
  fileFilter: threeDModelFileFilter,
  limits: {
    fileSize: Math.max(1, Number(process.env.MAX_3D_MODEL_FILE_SIZE_MB) || 100) * 1024 * 1024,
    files: 1,
  },
}).single("model");

export const uploadThreeDModels: RequestHandler = multer({
  storage,
  fileFilter: threeDModelFileFilter,
  limits: {
    fileSize: Math.max(1, Number(process.env.MAX_3D_MODEL_FILE_SIZE_MB) || 100) * 1024 * 1024,
    files: 10,
  },
}).fields([
  { name: "models", maxCount: 10 },
  { name: "model", maxCount: 1 },
]);

/**
 * Upload middleware for project creation
 * Handles multiple images and PDFs
 */
export const uploadProjectFiles: RequestHandler = multer({
  storage,
  fileFilter: combinedFileFilter,
  limits: {
    fileSize: UPLOAD_LIMITS.MAX_PDF_SIZE, // 10MB per file (max for PDFs)
    files: UPLOAD_LIMITS.MAX_PROJECT_IMAGES + UPLOAD_LIMITS.MAX_PROJECT_PDFS + 1, // 5 images + 5 PDFs + 1 thumbnail
    fieldSize: UPLOAD_LIMITS.MAX_PDF_SIZE, // Max field size
  },
}).fields([
  { name: 'images', maxCount: UPLOAD_LIMITS.MAX_PROJECT_IMAGES },
  { name: 'pdfs', maxCount: UPLOAD_LIMITS.MAX_PROJECT_PDFS },
  { name: 'thumbnail', maxCount: 1 },
]);

/**
 * Upload middleware for single image
 */
export const uploadSingleImage: RequestHandler = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: UPLOAD_LIMITS.MAX_IMAGE_SIZE, // 5MB per file
    files: 1,
    fieldSize: UPLOAD_LIMITS.MAX_IMAGE_SIZE,
  },
}).single('image');

/**
 * Upload middleware for a single product media image
 */
export const uploadProductMedia: RequestHandler = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: UPLOAD_LIMITS.MAX_IMAGE_SIZE,
    files: 1,
  },
}).single("file");

/**
 * Upload middleware for multiple images
 */
export const uploadMultipleImages = (maxCount: number = 5): RequestHandler => {
  return multer({
    storage,
    fileFilter: imageFileFilter,
    limits: {
      fileSize: UPLOAD_LIMITS.MAX_IMAGE_SIZE, // 5MB per file
      files: maxCount,
      fieldSize: UPLOAD_LIMITS.MAX_IMAGE_SIZE,
    },
  }).array('images', maxCount);
};

/**
 * Upload middleware for PDFs
 */
export const uploadPDFs = (maxCount: number = 5): RequestHandler => {
  return multer({
    storage,
    fileFilter: pdfFileFilter,
    limits: {
      fileSize: UPLOAD_LIMITS.MAX_PDF_SIZE, // 10MB per file
      files: maxCount,
      fieldSize: UPLOAD_LIMITS.MAX_PDF_SIZE,
    },
  }).array('pdfs', maxCount);
};

/**
 * Upload middleware for component creation
 * Handles multiple images and optional thumbnail
 */
export const uploadComponentImages: RequestHandler = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: UPLOAD_LIMITS.MAX_IMAGE_SIZE, // 5MB per file
    files: UPLOAD_LIMITS.MAX_PROJECT_IMAGES + 1, // 5 images + 1 thumbnail
    fieldSize: UPLOAD_LIMITS.MAX_IMAGE_SIZE, // Max field size
  },
}).fields([
  { name: 'images', maxCount: UPLOAD_LIMITS.MAX_PROJECT_IMAGES },
  { name: 'thumbnail', maxCount: 1 },
]);

const uploadMiddlewares: UploadMiddlewares = {
  uploadProjectFiles,
  uploadComponentImages,
  uploadSingleImage,
  uploadMultipleImages,
  uploadPDFs,
  uploadThreeDModel,
  uploadThreeDModels,
};

export default uploadMiddlewares;
