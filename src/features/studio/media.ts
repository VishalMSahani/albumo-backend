import sharp from 'sharp';
import { createHash } from 'node:crypto';

sharp.concurrency(1);
sharp.cache({ memory: 24, files: 0, items: 20 });
export async function processPhoto(bytes: Buffer, mimeType: string) {
  const options = { limitInputPixels: 40_000_000, failOn: 'warning' as const, animated: false };
  const metadata = await sharp(bytes, options).metadata();
  const format = ({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[mimeType];
  if (!format || metadata.format !== format || (metadata.pages || 1) > 1 || !metadata.width || !metadata.height) throw new Error('INVALID_PHOTO');
  // Decode the complete image, apply orientation and strip EXIF/GPS from previews.
  const preview = await sharp(bytes, options).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).timeout({ seconds: 30 }).toBuffer();
  const swapped = [5, 6, 7, 8].includes(metadata.orientation || 1);
  return { preview, width: swapped ? metadata.height : metadata.width, height: swapped ? metadata.width : metadata.height,
    checksum: createHash('sha256').update(bytes).digest('hex') };
}
