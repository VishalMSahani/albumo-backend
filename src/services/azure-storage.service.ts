/**
 * Azure Blob Storage Configuration
 * Service for uploading images and PDFs to Azure Blob Storage
 */

import { 
  BlobServiceClient, 
  ContainerClient, 
  BlockBlobClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential
} from '@azure/storage-blob';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';

// Azure Blob Storage Configuration
const AZURE_STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const AZURE_STORAGE_CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME || 'robo-gig-uploads';
const AZURE_PRIVATE_STORAGE_CONTAINER_NAME =
  process.env.AZURE_PRIVATE_STORAGE_CONTAINER_NAME || 'roboroot-private';

// Extract account name and key from connection string for SAS token generation
function getStorageCredentials(): { accountName: string; accountKey: string } | null {
  const match = AZURE_STORAGE_CONNECTION_STRING.match(/AccountName=([^;]+);AccountKey=([^;]+)/);
  if (match && match[1] && match[2]) {
    return {
      accountName: match[1],
      accountKey: match[2]
    };
  }
  return null;
}

// File upload constraints
export const UPLOAD_LIMITS = {
  MAX_PROJECT_IMAGES: 5,
  MAX_PROJECT_PDFS: 5,
  MAX_IMAGE_SIZE: 7 * 1024 * 1024, // 7MB
  MAX_PDF_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  ALLOWED_PDF_TYPE: 'application/pdf',
};

// File type enum
export enum FileType {
  PROJECT_IMAGE = 'project-images',
  PROJECT_PDF = 'project-pdfs',
  COMPONENT_IMAGE = 'component-images',
  PROJECT_THUMBNAIL = 'project-thumbnails',
  BULK_ORDER_CSV = 'bulk-orders',
}

export type PrivateStorageProvider = 'AZURE' | 'LOCAL';

export type PrivateUploadResult = {
  storageProvider: PrivateStorageProvider;
  storageKey: string;
  size: number;
  contentType: string;
};

export type PrivateFileAccess =
  | { type: 'redirect'; url: string }
  | { type: 'local'; absolutePath: string };

interface UploadResult {
  url: string;
  filename: string;
  size: number;
  contentType: string;
}

interface UploadError {
  success: false;
  error: string;
}

/**
 * Get Azure Blob Service Client
 */
function getBlobServiceClient(): BlobServiceClient {
  if (!AZURE_STORAGE_CONNECTION_STRING) {
    throw new Error('Azure Storage connection string is not configured');
  }
  return BlobServiceClient.fromConnectionString(AZURE_STORAGE_CONNECTION_STRING);
}

/**
 * Get Container Client
 */
async function getContainerClient(): Promise<ContainerClient> {
  const blobServiceClient = getBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(AZURE_STORAGE_CONTAINER_NAME);

  // Create container if it doesn't exist (with private access)
  // Note: Public access must be enabled at Storage Account level in Azure Portal
  await containerClient.createIfNotExists({
    access: 'container', // Try container-level public access first
  }).catch(async () => {
    // If container-level access fails, create with private access
    await containerClient.createIfNotExists();
  });

  return containerClient;
}

async function getPrivateContainerClient(): Promise<ContainerClient> {
  const blobServiceClient = getBlobServiceClient();
  const containerClient = blobServiceClient.getContainerClient(
    AZURE_PRIVATE_STORAGE_CONTAINER_NAME,
  );
  await containerClient.createIfNotExists();
  return containerClient;
}

/**
 * Validate file type
 */
function validateFileType(mimeType: string, allowedTypes: string[]): boolean {
  return allowedTypes.includes(mimeType);
}

/**
 * Validate file size
 */
function validateFileSize(size: number, maxSize: number): boolean {
  return size <= maxSize;
}

/**
 * Generate unique filename
 */
function generateUniqueFilename(originalFilename: string, fileType: FileType): string {
  const ext = path.extname(originalFilename);
  const uniqueId = uuidv4();
  const timestamp = Date.now();
  return `${fileType}/${timestamp}-${uniqueId}${ext}`;
}

/**
 * Generate SAS URL for blob (valid for 10 years for public read access)
 * This allows public access even when storage account has public access disabled
 */
function generateBlobSASUrl(blobClient: BlockBlobClient): string {
  try {
    const credentials = getStorageCredentials();
    if (!credentials) {
      // If we can't extract credentials, return the blob URL as-is
      return blobClient.url;
    }

    const sharedKeyCredential = new StorageSharedKeyCredential(
      credentials.accountName,
      credentials.accountKey
    );

    // Set SAS token to expire in 10 years (long-lived for public content)
    const expiresOn = new Date();
    expiresOn.setFullYear(expiresOn.getFullYear() + 10);

    const sasToken = generateBlobSASQueryParameters({
      containerName: AZURE_STORAGE_CONTAINER_NAME,
      blobName: blobClient.name,
      permissions: BlobSASPermissions.parse('r'), // Read-only permission
      startsOn: new Date(),
      expiresOn: expiresOn,
    }, sharedKeyCredential).toString();

    return `${blobClient.url}?${sasToken}`;
  } catch (error) {
    console.error('Error generating SAS token:', error);
    return blobClient.url;
  }
}

/**
 * Upload file to Azure Blob Storage
 */
export async function uploadFileToAzure(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  fileType: FileType
): Promise<UploadResult | UploadError> {
  try {
    const isImage = fileType === FileType.PROJECT_IMAGE || 
                    fileType === FileType.COMPONENT_IMAGE || 
                    fileType === FileType.PROJECT_THUMBNAIL;
    const isPdf = fileType === FileType.PROJECT_PDF;
    const isCsv = fileType === FileType.BULK_ORDER_CSV;

    if (isImage && !validateFileType(mimeType, UPLOAD_LIMITS.ALLOWED_IMAGE_TYPES)) {
      return {
        success: false,
        error: `Invalid image type. Allowed types: ${UPLOAD_LIMITS.ALLOWED_IMAGE_TYPES.join(', ')}`,
      };
    }

    if (isPdf && mimeType !== UPLOAD_LIMITS.ALLOWED_PDF_TYPE) {
      return {
        success: false,
        error: 'Invalid file type. Only PDF files are allowed',
      };
    }

    if (isCsv && mimeType !== 'text/csv' && mimeType !== 'application/vnd.ms-excel' && mimeType !== 'application/octet-stream' && !originalFilename.endsWith('.csv')) {
      return {
        success: false,
        error: 'Invalid file type. Only CSV files are allowed',
      };
    }

    // Validate file size
    let maxSize = UPLOAD_LIMITS.MAX_PDF_SIZE;
    if (isImage) {
      maxSize = UPLOAD_LIMITS.MAX_IMAGE_SIZE;
    } else if (isCsv) {
      maxSize = 5 * 1024 * 1024; // 5MB limit for CSV
    }

    if (!validateFileSize(buffer.length, maxSize)) {
      const maxSizeMB = maxSize / (1024 * 1024);
      return {
        success: false,
        error: `File size exceeds ${maxSizeMB}MB limit`,
      };
    }

    // Generate unique filename
    const blobName = generateUniqueFilename(originalFilename, fileType);

    // Try to get container client. If it fails, fallback to local storage
    let containerClient: ContainerClient | null = null;
    try {
      containerClient = await getContainerClient();
    } catch (e: any) {
      console.warn("Azure config failed, falling back to local storage.", e.message);
    }

    if (containerClient) {
      try {
        const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.uploadData(buffer, {
          blobHTTPHeaders: { blobContentType: mimeType },
        });
        const url = generateBlobSASUrl(blockBlobClient);
        return { url, filename: blobName, size: buffer.length, contentType: mimeType };
      } catch (uploadErr: any) {
        console.warn("Azure upload failed, falling back to local storage.", uploadErr.message);
        containerClient = null; // trigger fallback
      }
    }

    if (!containerClient) {
      // Local fallback
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const uploadsDir = path.join(process.cwd(), "public", "uploads", fileType);
      await fs.mkdir(uploadsDir, { recursive: true });
      const localFilePath = path.join(process.cwd(), "public", "uploads", blobName);
      await fs.writeFile(localFilePath, buffer);
      return {
        url: `${API_BASE_URL}/uploads/${blobName}`,
        filename: blobName,
        size: buffer.length,
        contentType: mimeType,
      };
    }

    throw new Error("Upload completely failed");
  } catch (error: any) {
    console.error('Upload error:', error);
    return {
      success: false,
      error: error.message || 'Failed to upload file',
    };
  }
}

/**
 * Upload multiple files to Azure Blob Storage
 */
export async function uploadMultipleFilesToAzure(
  files: Array<{ buffer: Buffer; filename: string; mimeType: string }>,
  fileType: FileType,
  maxFiles: number
): Promise<{ success: true; urls: string[] } | UploadError> {
  try {
    // Validate number of files
    if (files.length > maxFiles) {
      return {
        success: false,
        error: `Maximum ${maxFiles} files allowed`,
      };
    }

    const uploadPromises = files.map((file) =>
      uploadFileToAzure(file.buffer, file.filename, file.mimeType, fileType)
    );

    const results = await Promise.all(uploadPromises);

    // Check for errors
    const errors = results.filter((r) => 'success' in r && !r.success) as UploadError[];
    if (errors.length > 0) {
      return {
        success: false,
        error: errors.map((e) => e.error).join(', '),
      };
    }

    // Extract URLs
    const urls = (results as UploadResult[]).map((r) => r.url);

    return {
      success: true,
      urls,
    };
  } catch (error: any) {
    console.error('Multiple upload error:', error);
    return {
      success: false,
      error: error.message || 'Failed to upload files',
    };
  }
}

export async function uploadPrivateFile(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  folder = '3d-models',
): Promise<PrivateUploadResult> {
  const extension = path.extname(originalFilename).toLowerCase();
  const storageKey = `${folder}/${Date.now()}-${uuidv4()}${extension}`;

  try {
    const containerClient = await getPrivateContainerClient();
    const blobClient = containerClient.getBlockBlobClient(storageKey);
    await blobClient.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: mimeType,
        blobContentDisposition: 'attachment',
      },
    });

    return {
      storageProvider: 'AZURE',
      storageKey,
      size: buffer.length,
      contentType: mimeType,
    };
  } catch (error) {
    console.warn('Private Azure upload failed, using protected local storage.', error);
    const privateRoot = path.resolve(process.cwd(), 'private', 'uploads');
    const absolutePath = path.resolve(privateRoot, storageKey);
    if (!absolutePath.startsWith(`${privateRoot}${path.sep}`)) {
      throw new Error('Invalid private storage path');
    }
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    return {
      storageProvider: 'LOCAL',
      storageKey,
      size: buffer.length,
      contentType: mimeType,
    };
  }
}

export async function getPrivateFileAccess(
  storageProvider: PrivateStorageProvider,
  storageKey: string,
  downloadName: string,
): Promise<PrivateFileAccess> {
  if (storageProvider === 'LOCAL') {
    const privateRoot = path.resolve(process.cwd(), 'private', 'uploads');
    const absolutePath = path.resolve(privateRoot, storageKey);
    if (!absolutePath.startsWith(`${privateRoot}${path.sep}`)) {
      throw new Error('Invalid private storage path');
    }
    await fs.access(absolutePath);
    return { type: 'local', absolutePath };
  }

  const credentials = getStorageCredentials();
  if (!credentials) {
    throw new Error('Azure credentials are required to download private files');
  }

  const containerClient = await getPrivateContainerClient();
  const blobClient = containerClient.getBlockBlobClient(storageKey);
  const sharedKeyCredential = new StorageSharedKeyCredential(
    credentials.accountName,
    credentials.accountKey,
  );
  const safeName = downloadName.replace(/[\r\n"]/g, '_');
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: AZURE_PRIVATE_STORAGE_CONTAINER_NAME,
      blobName: storageKey,
      permissions: BlobSASPermissions.parse('r'),
      startsOn: new Date(Date.now() - 60_000),
      expiresOn: new Date(Date.now() + 10 * 60_000),
      contentDisposition: `attachment; filename="${safeName}"`,
    },
    sharedKeyCredential,
  ).toString();

  return { type: 'redirect', url: `${blobClient.url}?${sasToken}` };
}

/**
 * Delete file from Azure Blob Storage
 */
export async function deleteFileFromAzure(fileUrl: string): Promise<boolean> {
  try {
    const containerClient = await getContainerClient();

    // Extract blob name from URL
    const url = new URL(fileUrl);
    const blobName = url.pathname.split('/').slice(2).join('/'); // Remove container name

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.deleteIfExists();

    return true;
  } catch (error: any) {
    console.error('Azure delete error:', error);
    return false;
  }
}

/**
 * Delete multiple files from Azure Blob Storage
 */
export async function deleteMultipleFilesFromAzure(fileUrls: string[]): Promise<boolean> {
  try {
    const deletePromises = fileUrls.map((url) => deleteFileFromAzure(url));
    await Promise.all(deletePromises);
    return true;
  } catch (error: any) {
    console.error('Multiple delete error:', error);
    return false;
  }
}

export default {
  uploadFileToAzure,
  uploadMultipleFilesToAzure,
  deleteFileFromAzure,
  deleteMultipleFilesFromAzure,
  uploadPrivateFile,
  getPrivateFileAccess,
  UPLOAD_LIMITS,
  FileType,
};
