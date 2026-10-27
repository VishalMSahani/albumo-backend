import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const PRIVATE_CACHE_CONTROL = "private, no-store";

export function publicCdnOrigin(value = process.env.R2_PUBLIC_DOMAIN): string {
  if (!value?.trim()) throw new Error("R2_PUBLIC_DOMAIN is required");
  const url = new URL(value.includes("://") ? value : "https://" + value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    url.hostname.endsWith(".r2.dev") ||
    url.hostname.endsWith(".r2.cloudflarestorage.com")
  ) {
    throw new Error("R2_PUBLIC_DOMAIN must be the HTTPS custom CDN domain");
  }
  return url.origin;
}

export function r2Bucket(visibility: "public" | "private"): string {
  const bucket =
    process.env[
      visibility === "public" ? "R2_BUCKET_NAME" : "R2_PRIVATE_BUCKET_NAME"
    ]?.trim();
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error("Configure a valid R2 " + visibility + " bucket");
  if (visibility === "private" && bucket === process.env.R2_BUCKET_NAME?.trim())
    throw new Error("Private files require a separate R2 bucket");
  return bucket;
}

export function validateStorageKey(key: string): string {
  if (
    !key ||
    key.startsWith("/") ||
    /[\\\x00-\x1f\x7f]/.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid storage key");
  }
  return key;
}

export function publicObjectUrl(key: string): string {
  return (
    publicCdnOrigin() +
    "/" +
    validateStorageKey(key).split("/").map(encodeURIComponent).join("/")
  );
}

export function publicKeyFromUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== publicCdnOrigin() || url.search || url.hash)
    throw new Error("Only Albumo CDN objects can be deleted");
  return validateStorageKey(decodeURIComponent(url.pathname.slice(1)));
}

let client: S3Client | undefined;
export function getR2Client(): S3Client {
  if (!client) {
    const account = process.env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    if (
      !account ||
      !/^[a-f0-9]{32}$/.test(account) ||
      !accessKeyId ||
      !secretAccessKey
    )
      throw new Error("R2 credentials are not configured");
    client = new S3Client({
      region: "auto",
      endpoint: "https://" + account + ".r2.cloudflarestorage.com",
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 3,
    });
  }
  return client;
}

let clockCheckedAt = 0;
let checkingClock: Promise<void> | undefined;
async function signingDate() {
  const client = getR2Client();
  if (Date.now() - clockCheckedAt > 5 * 60_000) {
    // SDK requests correct detected server clock skew; the presigner does not
    // apply that offset by itself. Coalesce checks across a whole photo library.
    checkingClock ??= client.send(new HeadBucketCommand({ Bucket: r2Bucket('private') }), { abortSignal: AbortSignal.timeout(20_000) })
      .then(() => { clockCheckedAt = Date.now(); }).finally(() => { checkingClock = undefined; });
    await checkingClock;
  }
  return new Date(Date.now() + (client.config.systemClockOffset || 0));
}

export async function putR2Object(
  key: string,
  body: Buffer,
  contentType: string,
  visibility: "public" | "private",
  signal?: AbortSignal,
) {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: r2Bucket(visibility),
      Key: validateStorageKey(key),
      Body: body,
      ContentType: contentType,
      CacheControl:
        visibility === "public" ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL,
      ...(visibility === "private" ? { ContentDisposition: "attachment" } : {}),
      IfNoneMatch: "*",
    }),
    signal ? { abortSignal: signal } : {},
  );
}

export async function deleteR2Object(
  key: string,
  visibility: "public" | "private",
) {
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: r2Bucket(visibility),
      Key: validateStorageKey(key),
    }),
  );
}

export async function privateDownloadUrl(key: string, downloadName: string) {
  const name = downloadName
    .replace(/[\r\n"\\]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_");
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: r2Bucket("private"),
      Key: validateStorageKey(key),
      ResponseCacheControl: PRIVATE_CACHE_CONTROL,
      ResponseContentDisposition: 'attachment; filename="' + name + '"',
    }),
    { expiresIn: 600, signingDate: await signingDate() },
  );
}

export async function prepareStagedPut(key: string, size: number) {
  const headers = {
    "Content-Type": "application/octet-stream",
    "If-None-Match": "*",
    "Cache-Control": PRIVATE_CACHE_CONTROL,
  };
  const uploadUrl = await getSignedUrl(
    getR2Client(),
    new PutObjectCommand({
      Bucket: r2Bucket("private"),
      Key: validateStorageKey(key),
      ContentType: headers["Content-Type"],
      ContentLength: size,
      IfNoneMatch: "*",
      CacheControl: PRIVATE_CACHE_CONTROL,
    }),
    {
      expiresIn: 1200,
      signingDate: await signingDate(),
      signableHeaders: new Set([
        "content-type",
        "content-length",
        "if-none-match",
      ]),
    },
  );
  return { uploadUrl, headers };
}

export async function openStagedObject(key: string, expectedSize: number, signal?: AbortSignal) {
  const input = { Bucket: r2Bucket("private"), Key: validateStorageKey(key) };
  const head = await getR2Client().send(new HeadObjectCommand(input), signal ? { abortSignal: signal } : {});
  if (head.ContentLength !== expectedSize)
    throw Object.assign(
      new Error("Uploaded size does not match the upload ticket"),
      { statusCode: 400 },
    );
  const object = await getR2Client().send(
    new GetObjectCommand({ ...input, IfMatch: head.ETag }),
    signal ? { abortSignal: signal } : {},
  );
  if (!object.Body) throw new Error("Upload stream is unavailable");
  return object.Body;
}
