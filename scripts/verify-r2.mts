import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { prisma } from "../src/lib/prisma.js";
import {
  createUploadTicket,
  readUploadTicket,
} from "../src/services/upload-transport.service.js";
import { withStagedUpload } from "../src/middlewares/upload-transport.middleware.js";
import {
  FileType,
  uploadFile,
  uploadPrivateFile,
} from "../src/services/storage.service.js";
import {
  deleteR2Object,
  privateDownloadUrl,
  getR2Client,
} from "../src/services/r2-storage.service.js";
import type { Request, Response as ExpressResponse } from "express";

let stagedKey: string | undefined,
  publicKey: string | undefined,
  privateKey: string | undefined;
try {
  const png = await readFile(
    fileURLToPath(
      new URL(
        "../../frontend_album/public/Albumo Text Logo.png",
        import.meta.url,
      ),
    ),
  );
  const form = new FormData();
  form.append("label", "albumo-storage-check");
  form.append(
    "image",
    new Blob([png], { type: "image/png" }),
    "storage-check.png",
  );
  const multipart = new Response(form);
  const body = await multipart.blob();
  const owner = "storage-verification-" + randomUUID();
  const prepared = await createUploadTicket(
    {
      path: "/api/components/upload/image",
      size: body.size,
      contentType: multipart.headers.get("content-type")!,
    },
    owner,
  );
  stagedKey = readUploadTicket(prepared.ticket).key;
  const preflight = await fetch(prepared.uploadUrl, {
    method: "OPTIONS",
    headers: {
      Origin: "https://admin.albumo.in",
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers":
        "content-type,if-none-match,cache-control",
    },
    signal: AbortSignal.timeout(15_000),
  });
  assert(preflight.ok, "Browser upload preflight failed");
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "https://admin.albumo.in",
  );
  const put = await fetch(prepared.uploadUrl, {
    method: "PUT",
    headers: prepared.headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(put.status, 200, "Signed private upload failed");
  const overwrite = await fetch(prepared.uploadUrl, {
    method: "PUT",
    headers: prepared.headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(
    overwrite.status,
    412,
    "A signed upload must not overwrite an existing object",
  );
  const unauthorized = await fetch(prepared.uploadUrl.split("?")[0], {
    signal: AbortSignal.timeout(15_000),
  });
  assert(
    [400, 401, 403].includes(unauthorized.status),
    "Private staging must reject unsigned reads",
  );
  assert.match(
    await unauthorized.text(),
    /<(?:Code)>(InvalidArgument|AccessDenied|Unauthorized)<\/Code>/,
  );
  const req = {
    method: "POST",
    baseUrl: "/api/components",
    path: "/upload/image",
    url: "/upload/image",
    headers: {},
    user: { userId: owner },
    get: () => prepared.ticket,
  } as unknown as Request;
  let status = 200;
  const res = {
    status(value: number) {
      status = value;
      return this;
    },
    json() {},
  } as unknown as ExpressResponse;
  let failure: unknown;
  const handler = withStagedUpload(
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 7 * 1024 * 1024 },
    }).single("image"),
  );
  await handler(req, res, (error) => {
    failure = error;
  });
  assert.equal(status, 200);
  assert.equal(failure, undefined);
  assert.deepEqual(req.file?.buffer, png);
  assert.equal(req.body.label, "albumo-storage-check");
  await handler(req, res, (error) => {
    failure = error;
  });
  assert.equal(
    (failure as { statusCode?: number })?.statusCode,
    409,
    "Upload tickets must be single use",
  );
  const published = await uploadFile(
    png,
    "storage-check.png",
    "image/png",
    FileType.COMPONENT_IMAGE,
  );
  assert(!("error" in published), "Public image upload failed");

  publicKey = published.filename;
  const rollback = new Error("storage-verification-rollback");
  try {
    await prisma.$transaction(async (tx) => {
      const category = await tx.category.create({
        data: { name: "storage-verification-" + randomUUID() },
      });
      await tx.subcategory.create({
        data: { name: "storage-verification", categoryId: category.id },
      });
      const product = await tx.component.create({
        data: {
          name: "storage-verification",
          unitPriceCents: 100,
          isActive: false,
        },
      });
      await tx.productMedia.create({
        data: { componentId: product.id, url: published.url },
      });
      await tx.mediaLibrary.create({
        data: {
          url: published.url,
          filename: published.filename,
          mimeType: "image/png",
          sizeBytes: png.length,
        },
      });
      assert.equal(
        await tx.productMedia.count({ where: { componentId: product.id } }),
        1,
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const image = await fetch(published.url, {
    headers: { Origin: "https://albumo.in" },
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(image.status, 200);
  assert.equal(
    image.headers.get("access-control-allow-origin"),
    "https://albumo.in",
  );
  assert(image.headers.get("cache-control")?.includes("immutable"));
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  const cached = await fetch(published.url, {
    headers: { Origin: "https://albumo.in" },
    signal: AbortSignal.timeout(20_000),
  });
  const cache = cached.headers.get("cf-cache-status");
  await cached.arrayBuffer();
  const original = await uploadPrivateFile(
    png,
    "original.png",
    "image/png",
    "verification",
  );
  privateKey = original.storageKey;
  const signed = await privateDownloadUrl(original.storageKey, "original.png");
  const privateResponse = await fetch(signed, {
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(privateResponse.status, 200);
  assert(privateResponse.headers.get("cache-control")?.includes("no-store"));
  assert.deepEqual(Buffer.from(await privateResponse.arrayBuffer()), png);
  console.log(
    JSON.stringify({
      passed: true,
      signedPut: true,
      overwriteBlocked: true,
      privateReadProtected: true,
      multipartPreserved: true,
      mediaPersistence: true,
      ticketReplayBlocked: true,
      publicCdnCors: true,
      privateDownload: true,
      cdnCacheStatus: cache,
    }),
  );
} catch (error) {
  console.error(
    "Storage verification failed:",
    error instanceof Error ? error.name : "Unknown error",
  );
  if (error instanceof assert.AssertionError)
    console.error(error.message.split("\n")[0]);
  process.exitCode = 1;
} finally {
  if (publicKey) await deleteR2Object(publicKey, "public");
  if (privateKey) await deleteR2Object(privateKey, "private");
  if (stagedKey) {
    await deleteR2Object(stagedKey, "private");
    await prisma.stagedUpload.deleteMany({ where: { key: stagedKey } });
  }
  await prisma.$disconnect();
  getR2Client().destroy();
}
