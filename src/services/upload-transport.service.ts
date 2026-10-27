import { createHmac, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  deleteR2Object,
  openStagedObject,
  prepareStagedPut,
} from "./r2-storage.service.js";

export const uploadPaths = [
  /^\/api\/projects\/(upload|[^/]+\/upload)$/,
  /^\/api\/3d-printing\/(preview-quote|files|files\/batch)$/,
  /^\/api\/components\/(upload|upload\/image|[^/]+\/media)$/,
  /^\/api\/admin\/products\/(bulk-import|media\/bulk-upload)$/,
  /^\/api\/reviews\/upload$/,
  /^\/api\/bulk-orders\/?$/,
];
export const publicUploadPaths = new Set([
  "/api/3d-printing/preview-quote",
  "/api/bulk-orders",
  "/api/bulk-orders/",
]);
export const MAX_STAGED_UPLOAD_BYTES = 128 * 1024 * 1024;
export const uploadManifestSchema = z.object({
  path: z
    .string()
    .max(200)
    .refine(
      (path) => uploadPaths.some((pattern) => pattern.test(path)),
      "Unsupported upload route",
    ),
  contentType: z
    .string()
    .max(200)
    .regex(/^multipart\/form-data;\s*boundary=(?:[\w'-]+|"[\w'-]+")$/),
  size: z.number().int().positive().max(MAX_STAGED_UPLOAD_BYTES),
});
const ticketSchema = uploadManifestSchema.extend({
  key: z.string().regex(/^staging\/[a-f0-9-]+$/),
  owner: z.string().nullable(),
});
export type UploadTicket = z.infer<typeof ticketSchema>;

function signingKey() {
  const key = process.env.JWT_SECRET;
  if (!key) throw new Error("JWT_SECRET is required for direct uploads");
  return createHmac("sha256", key)
    .update("roboroot:multipart-upload")
    .digest("hex");
}
export function readUploadTicket(ticket: string) {
  return ticketSchema.parse(
    jwt.verify(ticket, signingKey(), {
      algorithms: ["HS256"],
      audience: "multipart-upload",
      issuer: "roboroot-api",
    }),
  );
}
export async function createUploadTicket(
  input: z.infer<typeof uploadManifestSchema>,
  owner: string | null,
) {
  const key = "staging/" + randomUUID();
  const prepared = await prepareStagedPut(key, input.size);
  await prisma.stagedUpload.create({
    data: {
      key,
      ownerId: owner,
      path: input.path,
      size: input.size,
      contentType: input.contentType,
      expiresAt: new Date(Date.now() + 20 * 60_000),
    },
  });
  const ticket = jwt.sign({ ...input, key, owner }, signingKey(), {
    algorithm: "HS256",
    expiresIn: "20m",
    audience: "multipart-upload",
    issuer: "roboroot-api",
  });
  return { ...prepared, ticket };
}
export const stagedUploadStore = {
  async claim(manifest: UploadTicket) {
    const result = await prisma.stagedUpload.updateMany({
      where: {
        key: manifest.key,
        ownerId: manifest.owner,
        path: manifest.path,
        size: manifest.size,
        contentType: manifest.contentType,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (result.count !== 1)
      throw Object.assign(new Error("Upload ticket expired or already used"), {
        statusCode: 409,
      });
  },
  open: openStagedObject,
  async remove(key: string) {
    await deleteR2Object(key, "private");
    await prisma.stagedUpload.deleteMany({
      where: { key, consumedAt: { not: null } },
    });
  },
};
export async function cleanupExpiredStagedUploads() {
  const records = await prisma.stagedUpload.findMany({
    where: { expiresAt: { lt: new Date() } },
    orderBy: { expiresAt: "asc" },
    take: 100,
  });
  for (const record of records) {
    await deleteR2Object(record.key, "private");
    await prisma.stagedUpload.delete({ where: { key: record.key } });
  }
}
