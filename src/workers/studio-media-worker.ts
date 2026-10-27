import { pruneRetainedExtras, workerPulse } from '../features/studio/maintenance.js';
import { purgeTrashedAlbums } from '../features/studio/trash.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { openStagedObject, putR2Object, deleteR2Object } from '../services/r2-storage.service.js';
import { processPhoto } from '../features/studio/media.js';
import { setTimeout as delay } from 'node:timers/promises';

async function immutablePut(key: string, bytes: Buffer, mime: string) {
  try { await putR2Object(key, bytes, mime, 'private', AbortSignal.timeout(45_000)); }
  catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error; }
}
export async function processNextPhoto() {
  const now = new Date();
  const candidate = await prisma.studioAsset.findFirst({ where: { project: { trashedAt: null, deletedAt: null }, status: 'PROCESSING', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, orderBy: { createdAt: 'asc' } });
  if (!candidate) return false;
  const leaseToken = randomUUID();
  const claimed = await prisma.studioAsset.updateMany({ where: { id: candidate.id, project: { trashedAt: null, deletedAt: null }, status: 'PROCESSING', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseToken, leaseUntil: new Date(Date.now() + 5 * 60_000), attempts: { increment: 1 } } });
  if (!claimed.count) return true;
  let outputKeys: string[] = [];
  try {
    const body = await openStagedObject(candidate.stagingKey, candidate.byteSize, AbortSignal.timeout(60_000));
    const stream = body as unknown as NodeJS.ReadableStream & { destroy(error?: Error): void };
    const timer = setTimeout(() => stream.destroy(new Error('UPLOAD_TIMEOUT')), 45_000);
    let bytes: Buffer;
    try {
      const chunks: Buffer[] = []; let total = 0;
      for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
        total += chunk.length;
        if (total > candidate.byteSize || total > 15 * 1024 * 1024) { stream.destroy(); throw new Error('INVALID_PHOTO'); }
        chunks.push(chunk);
      }
      if (total !== candidate.byteSize) throw new Error('INVALID_PHOTO');
      bytes = Buffer.concat(chunks, total);
    } finally { clearTimeout(timer); }
    const photo = await processPhoto(bytes, candidate.mimeType);
    const originalKey = `studio/${candidate.projectId}/${candidate.id}/${photo.checksum}/original`;
    const previewKey = `studio/${candidate.projectId}/${candidate.id}/${photo.checksum}/preview-v1.webp`;
    outputKeys = [originalKey, previewKey];
    // Persist keys before writing so failed transforms remain discoverable by Trash cleanup.
    const tracked = await prisma.studioAsset.updateMany({ where: { id: candidate.id, status: 'PROCESSING', leaseToken }, data: { originalKey, previewKey } });
    if (!tracked.count) throw new Error('LEASE_LOST');
    await immutablePut(originalKey, bytes, candidate.mimeType);
    await immutablePut(previewKey, photo.preview, 'image/webp');
    await prisma.studioAsset.updateMany({ where: { id: candidate.id, status: 'PROCESSING', leaseToken }, data: {
      status: 'READY', originalKey, previewKey, checksum: photo.checksum, width: photo.width, height: photo.height, leaseToken: null, leaseUntil: null, errorCode: null,
    } });
    await deleteR2Object(candidate.stagingKey, 'private').catch(() => {});
  } catch {
    const failed = candidate.attempts >= 2;
    const result = await prisma.studioAsset.updateMany({ where: { id: candidate.id, status: 'PROCESSING', leaseToken }, data: {
      status: failed ? 'FAILED' : 'PROCESSING', errorCode: failed ? 'PHOTO_PROCESSING_FAILED' : null,
      leaseToken: null, leaseUntil: failed ? null : new Date(Date.now() + 30_000),
    } });
    if (failed && result.count) {
      for (const key of [candidate.stagingKey, ...outputKeys]) await deleteR2Object(key, 'private').catch(() => {});
    }
  }
  return true;
}
export async function expireUploads() {
  await prisma.studioAsset.updateMany({ where: { status: 'UPLOADING', expiresAt: { lt: new Date() } }, data: { status: 'FAILED', errorCode: 'UPLOAD_EXPIRED' } });
  // The bucket's staging/ lifecycle removes abandoned bodies after one day.
}
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
async function main() {
  console.info('Studio media worker started (one photo at a time).');
  let cleanupAt = 0;
  while (!stopping) {
    try {
      if (Date.now() > cleanupAt) { await expireUploads(); await purgeTrashedAlbums(); await pruneRetainedExtras(); await workerPulse(null); cleanupAt = Date.now() + 60_000; }
      const worked = await processNextPhoto();
      if (process.argv.includes('--once')) break;
      if (!worked) await delay(2000);
    } catch { await workerPulse('SERVICE_UNAVAILABLE').catch(() => {}); console.error('Studio worker could not reach its services; retrying.'); await delay(5000); }
  }
  await prisma.$disconnect();
}
if (!process.env.STUDIO_WORKER_TEST) void main();
