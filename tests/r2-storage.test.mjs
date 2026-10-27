import assert from "node:assert/strict";
import { test, after } from "node:test";
import { Readable } from "node:stream";
import {
  getR2Client,
  r2Bucket,
  publicCdnOrigin,
  publicObjectUrl,
  publicKeyFromUrl,
  prepareStagedPut,
  privateDownloadUrl,
  openStagedObject,
} from "../src/services/r2-storage.service.ts";
import {
  uploadFile,
  uploadMultipleFiles,
  uploadPrivateFile,
  deleteFile,
  FileType,
} from "../src/services/storage.service.ts";

Object.assign(process.env, {
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_ACCESS_KEY_ID: "test-access",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_BUCKET_NAME: "public-assets",
  R2_PRIVATE_BUCKET_NAME: "private-assets",
  R2_PUBLIC_DOMAIN: "cdn.albumo.in",
});
const client = getR2Client();
const originalSend = client.send.bind(client);
let commands = [],
  rejectPut = 0,
  objectSize = 4;
client.send = async (command) => {
  commands.push(command);
  if (
    command.constructor.name === "PutObjectCommand" &&
    rejectPut > 0 &&
    --rejectPut === 0
  )
    throw new Error("fixture failure");
  if (command.constructor.name === "HeadObjectCommand")
    return { ContentLength: objectSize, ETag: "etag" };
  if (command.constructor.name === "GetObjectCommand")
    return { Body: Readable.from([Buffer.from("file")]) };
  return {};
};
after(() => {
  client.send = originalSend;
  client.destroy();
});

test('signed URLs respect the SDK clock correction', async () => {
  const previous = client.config.systemClockOffset;
  client.config.systemClockOffset = 5.5 * 3600_000;
  try {
    const url = new URL((await prepareStagedPut('staging/clock-check', 4)).uploadUrl);
    const date = url.searchParams.get('X-Amz-Date');
    const expected = new Date(Date.now() + 5.5 * 3600_000).toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 13);
    assert.equal(date.slice(0, 13), expected);
  } finally { client.config.systemClockOffset = previous; }
});

test("CDN URLs encode names, use the custom domain, and reject foreign deletion targets", () => {
  assert.equal(
    publicObjectUrl("static/hash/Albumo Text Logo.png"),
    "https://cdn.albumo.in/static/hash/Albumo%20Text%20Logo.png",
  );
  assert.equal(
    publicKeyFromUrl("https://cdn.albumo.in/media/photo.png"),
    "media/photo.png",
  );
  for (const url of [
    "https://evil.invalid/media/photo.png",
    "https://cdn.albumo.in/media/photo.png?token=secret",
  ])
    assert.throws(() => publicKeyFromUrl(url));
  for (const key of [
    "../private",
    "/absolute",
    "media/../secret",
    "media\\secret",
  ])
    assert.throws(() => publicObjectUrl(key));
  for (const host of [
    "http://cdn.albumo.in",
    "https://pub-example.r2.dev",
    "https://cdn.albumo.in/path",
    "https://user:pass@cdn.albumo.in",
  ])
    assert.throws(() => publicCdnOrigin(host));
});

test("private storage never falls back to the public bucket", () => {
  const saved = process.env.R2_PRIVATE_BUCKET_NAME;
  process.env.R2_PRIVATE_BUCKET_NAME = process.env.R2_BUCKET_NAME;
  assert.throws(() => r2Bucket("private"), /separate/);
  delete process.env.R2_PRIVATE_BUCKET_NAME;
  assert.throws(() => r2Bucket("private"));
  process.env.R2_PRIVATE_BUCKET_NAME = saved;
});

test("public image upload preserves the original bytes and returns only a CDN URL", async () => {
  commands = [];
  const body = Buffer.from("original-image-bytes");
  const result = await uploadFile(
    body,
    "customer-name.png",
    "image/png",
    FileType.COMPONENT_IMAGE,
  );
  assert(!("error" in result));
  assert.match(
    result.url,
    /^https:\/\/cdn\.albumo\.in\/media\/component-images\//,
  );
  assert(!result.url.includes("customer-name"));
  const request = commands[0].input;
  assert.equal(request.Body, body);
  assert.equal(request.Bucket, "public-assets");
  assert.equal(request.ContentType, "image/png");
  assert.match(request.CacheControl, /31536000, immutable/);
  assert.equal(request.IfNoneMatch, "*");
});

test("invalid image types, empty files, and customer CSVs never reach public storage", async () => {
  commands = [];
  for (const [body, mime, type] of [
    [Buffer.from("x"), "text/html", FileType.COMPONENT_IMAGE],
    [Buffer.alloc(0), "image/png", FileType.COMPONENT_IMAGE],
    [Buffer.from("private"), "text/csv", FileType.BULK_ORDER_CSV],
  ]) {
    assert("error" in (await uploadFile(body, "file", mime, type)));
  }
  assert.equal(commands.length, 0);
});

test("private files use the private bucket and are not publicly cached", async () => {
  commands = [];
  const result = await uploadPrivateFile(
    Buffer.from("private"),
    "original.png",
    "image/png",
    "originals",
  );
  assert.equal(result.storageProvider, "R2");
  assert.equal(result.url, undefined);
  assert.equal(commands[0].input.Bucket, "private-assets");
  assert.equal(commands[0].input.CacheControl, "private, no-store");
  const url = new URL(await privateDownloadUrl(result.storageKey, "photo.png"));
  assert.equal(
    url.hostname,
    "private-assets." + "a".repeat(32) + ".r2.cloudflarestorage.com",
  );
  assert.equal(url.searchParams.get("X-Amz-Expires"), "600");
});

test("signed staged uploads bind the type, size and overwrite prevention", async () => {
  const prepared = await prepareStagedPut("staging/test-key", 4);
  const url = new URL(prepared.uploadUrl);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "1200");
  for (const header of ["content-type", "content-length", "if-none-match"])
    assert(
      url.searchParams.get("X-Amz-SignedHeaders").split(";").includes(header),
    );
  assert.equal(prepared.headers["If-None-Match"], "*");
  assert.equal(prepared.headers["Cache-Control"], "private, no-store");
});

test("staged reads check size and pin the object ETag before consuming bytes", async () => {
  commands = [];
  await assert.rejects(openStagedObject("staging/key", 5), /size/);
  assert(
    !commands.some(
      (command) => command.constructor.name === "GetObjectCommand",
    ),
  );
  await openStagedObject("staging/key", objectSize);
  assert.equal(commands.at(-1).input.IfMatch, "etag");
});

test("failed batches clean their new objects and cannot delete static assets", async () => {
  commands = [];
  rejectPut = 2;
  const result = await uploadMultipleFiles(
    [1, 2].map(() => ({
      buffer: Buffer.from("image"),
      filename: "a.png",
      mimeType: "image/png",
    })),
    FileType.COMPONENT_IMAGE,
    5,
  );
  assert("error" in result);
  assert(
    commands.some(
      (command) => command.constructor.name === "DeleteObjectCommand",
    ),
  );
  commands = [];
  assert.equal(
    await deleteFile("https://cdn.albumo.in/static/hash/logo.png"),
    false,
  );
  assert.equal(await deleteFile("https://other.example/media/a.png"), false);
  assert.equal(commands.length, 0);
});
