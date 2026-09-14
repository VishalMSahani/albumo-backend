import type { Request, Response } from 'express';
import { uploadFileToAzure, uploadMultipleFilesToAzure, FileType, UPLOAD_LIMITS } from '../../../services/azure-storage.service.js';
import { createProject, updateProject, getProjectById } from '../services/project.service.js';
import { createProjectSchema, updateProjectSchema, parseProjectMultipart } from '../validators/project.schema.js';
import { cacheInvalidate } from '../../../lib/redis.js';
import { projectError } from './project-error.js';

interface MulterFiles { images?: Express.Multer.File[]; pdfs?: Express.Multer.File[]; thumbnail?: Express.Multer.File[] }

async function uploadMedia(files: MulterFiles) {
  let thumbnailUrl: string | undefined;
  if (files.thumbnail?.[0]) {
    const file = files.thumbnail[0];
    const result = await uploadFileToAzure(file.buffer, file.originalname, file.mimetype, FileType.PROJECT_THUMBNAIL);
    if ('error' in result) throw new Error(`Thumbnail upload failed: ${result.error}`);
    thumbnailUrl = result.url;
  }
  async function upload(list: Express.Multer.File[] | undefined, type: FileType, limit: number) {
    if (!list?.length) return [];
    const result = await uploadMultipleFilesToAzure(list.map(file => ({ buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype })), type, limit);
    if (!result.success) throw new Error(`Media upload failed: ${result.error}`);
    return result.urls;
  }
  return { thumbnailUrl, imageUrls: await upload(files.images, FileType.PROJECT_IMAGE, UPLOAD_LIMITS.MAX_PROJECT_IMAGES),
    pdfUrls: await upload(files.pdfs, FileType.PROJECT_PDF, UPLOAD_LIMITS.MAX_PROJECT_PDFS) };
}

function checkLimits(images: number, pdfs: number) {
  if (images > UPLOAD_LIMITS.MAX_PROJECT_IMAGES) throw new Error(`Maximum ${UPLOAD_LIMITS.MAX_PROJECT_IMAGES} gallery images allowed`);
  if (pdfs > UPLOAD_LIMITS.MAX_PROJECT_PDFS) throw new Error(`Maximum ${UPLOAD_LIMITS.MAX_PROJECT_PDFS} PDF resources allowed`);
}

export async function handleCreateProjectWithUploads(req: Request, res: Response): Promise<void> {
  try {
    if (!req.user?.userId) { res.status(401).json({ success: false, error: 'User not authenticated' }); return; }
    const data = createProjectSchema.parse(parseProjectMultipart(req.body));
    const files = (req.files ?? {}) as MulterFiles;
    checkLimits((data.imageUrls?.length ?? 0) + (files.images?.length ?? 0), (data.pdfUrls?.length ?? 0) + (files.pdfs?.length ?? 0));
    const media = await uploadMedia(files);
    const project = await createProject({
      ...data, ...(media.thumbnailUrl ? { thumbnailUrl: media.thumbnailUrl } : {}),
      imageUrls: [...(data.imageUrls ?? []), ...media.imageUrls], pdfUrls: [...(data.pdfUrls ?? []), ...media.pdfUrls],
    }, req.user.userId);
    void cacheInvalidate('http:/api/projects*');
    res.status(201).json({ success: true, data: { project, uploads: media }, message: 'Project created successfully' });
  } catch (error) { projectError(res, error); }
}

export async function handleUpdateProjectWithUploads(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id;
    if (!id) { res.status(400).json({ success: false, error: 'Project ID is required' }); return; }
    const existing = await getProjectById(id);
    if (!existing) { res.status(404).json({ success: false, error: 'Project not found' }); return; }
    const body = parseProjectMultipart(req.body);
    if (Array.isArray(body.componentIds) && body.components === undefined) {
      body.components = body.componentIds.map(componentId => ({ componentId, quantity: 1 }));
      delete body.componentIds;
    }
    // A files-only multipart request is valid even without text fields.
    const data = Object.keys(body).length ? updateProjectSchema.parse(body) : {};
    const files = (req.files ?? {}) as MulterFiles;
    const flag = (name: string) => {
      const value: unknown = req.body[name];
      if (value !== undefined && value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
      return value === 'true';
    };
    const images = data.imageUrls ?? (flag('replaceImages') ? [] : existing.imageUrls ?? []);
    const pdfs = data.pdfUrls ?? (flag('replacePdfs') ? [] : existing.pdfUrls ?? []);
    checkLimits(images.length + (files.images?.length ?? 0), pdfs.length + (files.pdfs?.length ?? 0));
    const links = flag('replaceLinks') ? data.externalLinks ?? [] : data.externalLinks ? [...(existing.externalLinks ?? []), ...data.externalLinks] : undefined;
    const update = {
      ...data,
      ...(files.images?.length || data.imageUrls !== undefined || flag('replaceImages') ? { imageUrls: images } : {}),
      ...(files.pdfs?.length || data.pdfUrls !== undefined || flag('replacePdfs') ? { pdfUrls: pdfs } : {}),
      ...(links !== undefined ? { externalLinks: links } : {}),
    };
    // Check merged ready-made state and resources before writing media.
    updateProjectSchema.parse({ ...update, preBuiltAvailable: data.preBuiltAvailable ?? existing.preBuiltAvailable,
      preBuiltPriceCents: data.preBuiltPriceCents === undefined ? existing.preBuiltPriceCents : data.preBuiltPriceCents });
    const media = await uploadMedia(files);
    const project = await updateProject(id, { ...update,
      ...(media.thumbnailUrl ? { thumbnailUrl: media.thumbnailUrl } : {}),
      ...(update.imageUrls ? { imageUrls: [...update.imageUrls, ...media.imageUrls] } : {}),
      ...(update.pdfUrls ? { pdfUrls: [...update.pdfUrls, ...media.pdfUrls] } : {}),
    });
    void cacheInvalidate('http:/api/projects*');
    res.json({ success: true, data: { project, uploads: media }, message: 'Project updated successfully' });
  } catch (error) { projectError(res, error); }
}
