import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { privateDownloadUrl } from '../../services/r2-storage.service.js';
import { authorizeCollection, lockProject } from './collection.js';
import { StudioProjectError } from './error.js';

const photo = z.object({ assetId: z.uuid(), x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict();
const appearance = z.object({ margin:z.number().min(0).max(12), font:z.enum(['sans','serif','classic']), fontSize:z.number().min(8).max(48), align:z.enum(['left','center','right']) }).partial().strict();
export const documentSchema = z.object({
  version: z.literal(1), template: z.enum(['everyday','travel','celebration']),
  cover: z.object({ title: z.string().max(120), photo: photo.nullable(), appearance: appearance.optional() }).strict(),
  pages: z.array(z.object({ id: z.uuid(), layout: z.enum(['full','duo']), caption: z.string().max(300), appearance: appearance.optional(), photos: z.array(photo).max(2) }).strict()).min(4).max(200),
}).strict();
export const saveDesignSchema = z.object({ baseRevision: z.number().int().min(1), document: documentSchema }).strict();
export async function getDesign(projectId: string, ownerId: string) {
  const project = await authorizeCollection(prisma, projectId, { ownerId }, false);
  const photos = await prisma.studioAsset.findMany({ where: { projectId, status: 'READY', selected: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, previewKey: true, width: true, height: true, filename: true } });
  if (photos.length < project.minimumPhotos!) throw new StudioProjectError(409, 'MORE_PHOTOS_REQUIRED', `Add at least ${project.minimumPhotos} ready photos before designing.`);
  return { revision: project.revision, title: project.title, archived: !!project.archivedAt, configuration: project.configuration, pageCount: project.pageCount,
    document: project.document, photos: await Promise.all(photos.map(async ({ previewKey, ...photo }) => ({ ...photo, previewUrl: await privateDownloadUrl(previewKey!, 'photo.webp') }))) };
}
export async function saveDesign(projectId: string, ownerId: string, input: z.infer<typeof saveDesignSchema>) {
  return prisma.$transaction(async tx => {
    await lockProject(tx, projectId);
    const project = await authorizeCollection(tx, projectId, { ownerId });
    if (project.revision !== input.baseRevision) {
      // A lost response may replay exactly the last committed save. Compare canonical
      // parsed documents because JSONB does not preserve object key order.
      if (project.revision === input.baseRevision + 1 && project.document && JSON.stringify(documentSchema.parse(project.document)) === JSON.stringify(input.document)) return { revision: project.revision };
      throw new StudioProjectError(409, 'STUDIO_REVISION_CONFLICT', 'This album changed in another tab. Reload the saved design before editing again.');
    }
    const assets = await tx.studioAsset.findMany({ where: { projectId, status: 'READY', selected: true }, select: { id: true } });
    if (assets.length < project.minimumPhotos!) throw new StudioProjectError(409, 'MORE_PHOTOS_REQUIRED', 'Select enough ready photos before saving a design.');
    const allowed = new Set(assets.map(asset => asset.id));
    const doc = input.document;
    const references = [...(doc.cover.photo ? [doc.cover.photo] : []), ...doc.pages.flatMap(page => page.photos)];
    if (doc.pages.length !== project.pageCount || new Set(doc.pages.map(page => page.id)).size !== doc.pages.length ||
      doc.pages.some(page => page.photos.length > (page.layout === 'duo' ? 2 : 1)) || references.some(photo => !allowed.has(photo.assetId))) {
      throw new StudioProjectError(422, 'INVALID_DESIGN', 'The design must match your album page count and use photos selected in this album.');
    }
    const saved = await tx.studioProject.update({ where: { id: projectId }, data: { document: doc, revision: { increment: 1 } }, select: { revision: true } });
    return saved;
  });
}
