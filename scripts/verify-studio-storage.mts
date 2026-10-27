import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { prepareStagedPut, openStagedObject, putR2Object, privateDownloadUrl, deleteR2Object, getR2Client } from '../src/services/r2-storage.service.js';
import { processPhoto } from '../src/features/studio/media.js';
// Synthetic pixels only. Never reads customer objects or writes customer DB rows.
const prefix = `staging/studio-verification/${randomUUID()}`;
const staged = prefix + '/source'; const previewKey = prefix + '/preview.webp';
try {
  const bytes = await sharp({ create: { width: 32, height: 48, channels: 3, background: '#c73b65' } }).jpeg().toBuffer();
  const ticket = await prepareStagedPut(staged, bytes.length);
  const preflight = await fetch(ticket.uploadUrl, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3001', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,if-none-match,cache-control' }, signal: AbortSignal.timeout(20_000) });
  if (!preflight.ok || preflight.headers.get('access-control-allow-origin') !== 'http://localhost:3001') throw new Error('CORS_CHECK_FAILED');
  const upload = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: bytes, signal: AbortSignal.timeout(20_000) });
  if (!upload.ok) { const body = await upload.text(); throw new Error(`SIGNED_UPLOAD_FAILED HTTP ${upload.status}: ${/<Code>([^<]+)<\/Code>/.exec(body)?.[1] || 'unknown'}`); }
  const overwrite = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: bytes, signal: AbortSignal.timeout(20_000) });
  if (overwrite.status !== 412) throw new Error('IMMUTABLE_UPLOAD_CHECK_FAILED');
  const body = await openStagedObject(staged, bytes.length);
  const original = Buffer.from(await body.transformToByteArray());
  if (!original.equals(bytes)) throw new Error('SOURCE_CHECK_FAILED');
  const photo = await processPhoto(original, 'image/jpeg');
  await putR2Object(previewKey, photo.preview, 'image/webp', 'private');
  const preview = await fetch(await privateDownloadUrl(previewKey, 'photo.webp'), { signal: AbortSignal.timeout(20_000) });
  if (!preview.ok || !(await sharp(Buffer.from(await preview.arrayBuffer())).metadata()).width) throw new Error('PREVIEW_CHECK_FAILED');
  console.log('PASS private R2 CORS, signed upload, overwrite prevention, image processing and signed preview.');
} catch (error) { console.error('Studio storage verification failed:', error instanceof Error ? error.message : 'Unknown error'); process.exitCode = 1; }
finally {
  for (const key of [staged, previewKey]) {
    if (!key.startsWith(prefix + '/')) throw new Error('Unsafe verification cleanup');
    await deleteR2Object(key, 'private').catch(() => { console.error('Verification object cleanup failed; staging lifecycle will expire it.'); process.exitCode = 1; });
  }
  getR2Client().destroy();
}
