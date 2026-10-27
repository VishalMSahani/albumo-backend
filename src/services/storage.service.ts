import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  deleteR2Object,
  privateDownloadUrl,
  publicKeyFromUrl,
  publicObjectUrl,
  putR2Object,
} from "./r2-storage.service.js";
import {
  getPrivateFileAccess as legacyPrivateAccess,
  type PrivateFileAccess,
} from "./azure-storage.service.js";

export const UPLOAD_LIMITS = {
  MAX_PROJECT_IMAGES: 5,
  MAX_PROJECT_PDFS: 5,
  MAX_IMAGE_SIZE: 7 * 1024 * 1024,
  MAX_PDF_SIZE: 10 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/avif",
  ],
  ALLOWED_PDF_TYPE: "application/pdf",
};
export enum FileType {
  PROJECT_IMAGE = "project-images",
  PROJECT_PDF = "project-pdfs",
  COMPONENT_IMAGE = "component-images",
  PROJECT_THUMBNAIL = "project-thumbnails",
  BULK_ORDER_CSV = "bulk-orders",
}
export type PrivateStorageProvider = "R2" | "AZURE" | "LOCAL";
export type PrivateUploadResult = {
  storageProvider: PrivateStorageProvider;
  storageKey: string;
  size: number;
  contentType: string;
};
type UploadResult = {
  url: string;
  filename: string;
  size: number;
  contentType: string;
};
type UploadError = { success: false; error: string };
const extensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "application/pdf": ".pdf",
};

export async function uploadFile(
  buffer: Buffer,
  _originalFilename: string,
  mimeType: string,
  fileType: FileType,
): Promise<UploadResult | UploadError> {
  const image = [
    FileType.PROJECT_IMAGE,
    FileType.COMPONENT_IMAGE,
    FileType.PROJECT_THUMBNAIL,
  ].includes(fileType);
  if (fileType === FileType.BULK_ORDER_CSV)
    return {
      success: false,
      error: "Customer documents must use private storage",
    };
  if (
    !(image
      ? UPLOAD_LIMITS.ALLOWED_IMAGE_TYPES.includes(mimeType)
      : mimeType === UPLOAD_LIMITS.ALLOWED_PDF_TYPE)
  )
    return { success: false, error: "Unsupported file type" };
  if (
    !buffer.length ||
    buffer.length >
      (image ? UPLOAD_LIMITS.MAX_IMAGE_SIZE : UPLOAD_LIMITS.MAX_PDF_SIZE)
  )
    return { success: false, error: "File exceeds the upload size limit" };
  const filename =
    "media/" + fileType + "/" + randomUUID() + extensions[mimeType];
  try {
    // No transformations here: the dedicated processing repo owns image processing.
    await putR2Object(
      filename,
      buffer,
      mimeType === "image/jpg" ? "image/jpeg" : mimeType,
      "public",
    );
    return {
      url: publicObjectUrl(filename),
      filename,
      size: buffer.length,
      contentType: mimeType,
    };
  } catch {
    return {
      success: false,
      error:
        "Image storage is temporarily unavailable. Please retry the upload.",
    };
  }
}

export async function uploadMultipleFiles(
  files: Array<{ buffer: Buffer; filename: string; mimeType: string }>,
  fileType: FileType,
  maxFiles: number,
): Promise<{ success: true; urls: string[] } | UploadError> {
  if (files.length > maxFiles)
    return { success: false, error: "Maximum " + maxFiles + " files allowed" };
  const urls: string[] = [];
  for (const file of files) {
    const result = await uploadFile(
      file.buffer,
      file.filename,
      file.mimeType,
      fileType,
    );
    if ("error" in result) {
      await Promise.all(urls.map(deleteFile));
      return result;
    }
    urls.push(result.url);
  }
  return { success: true, urls };
}

export async function deleteFile(url: string): Promise<boolean> {
  try {
    const key = publicKeyFromUrl(url);
    if (!key.startsWith("media/"))
      throw new Error("Only uploaded media can be deleted by this service");
    await deleteR2Object(key, "public");
    return true;
  } catch {
    return false;
  }
}

export async function deleteMultipleFiles(urls: string[]) {
  return (await Promise.all(urls.map(deleteFile))).every(Boolean);
}

export async function uploadPrivateFile(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  folder = "3d-models",
): Promise<PrivateUploadResult> {
  if (!/^[a-z0-9-]+$/.test(folder))
    throw new Error("Invalid private upload folder");
  const extension = path
    .extname(originalFilename)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");
  const storageKey = folder + "/" + randomUUID() + extension;
  await putR2Object(storageKey, buffer, mimeType, "private");
  return {
    storageProvider: "R2",
    storageKey,
    size: buffer.length,
    contentType: mimeType,
  };
}

export async function getPrivateFileAccess(
  provider: PrivateStorageProvider,
  key: string,
  downloadName: string,
): Promise<PrivateFileAccess> {
  if (provider === "R2")
    return {
      type: "redirect",
      url: await privateDownloadUrl(key, downloadName),
    };
  // Only historical records use the old provider; new uploads always go to R2.
  return legacyPrivateAccess(provider, key, downloadName);
}

export type { PrivateFileAccess };
