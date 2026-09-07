import { createHmac, randomUUID } from "node:crypto";
import { BlobSASPermissions } from "@azure/storage-blob";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { getPrivateContainerClient } from "./azure-storage.service.js";

export const uploadPaths = [
  /^\/api\/3d-printing\/(preview-quote|files|files\/batch)$/,
  /^\/api\/components\/(upload|upload\/image|[^/]+\/media)$/,
  /^\/api\/admin\/products\/(bulk-import|media\/bulk-upload)$/,
  /^\/api\/reviews\/upload$/,
  /^\/api\/bulk-orders\/?$/,
];
export const publicUploadPaths = new Set(["/api/3d-printing/preview-quote", "/api/bulk-orders", "/api/bulk-orders/"]);
// Total multipart size, including boundaries; individual file limits still apply in Multer.
export const MAX_STAGED_UPLOAD_BYTES = 128 * 1024 * 1024;
export const uploadManifestSchema = z.object({
  path: z.string().max(200).refine(path => uploadPaths.some(pattern => pattern.test(path)), "Unsupported upload route"),
  contentType: z.string().max(200).regex(/^multipart\/form-data;\s*boundary=(?:[\w'-]+|"[\w'-]+")$/),
  size: z.number().int().positive().max(MAX_STAGED_UPLOAD_BYTES),
});
const ticketSchema = uploadManifestSchema.extend({
  key: z.string().regex(/^staging\/[a-f0-9-]+$/),
  owner: z.string().nullable(),
});

function signingKey() {
  const key = process.env.JWT_SECRET;
  if (!key) throw new Error("JWT_SECRET is required for direct uploads");
  // Upload tickets must never verify as access tokens, even in legacy JWT validators.
  return createHmac("sha256", key).update("roboroot:multipart-upload").digest("hex");
}

export function readUploadTicket(ticket: string) {
  return ticketSchema.parse(jwt.verify(ticket, signingKey(), {
    algorithms: ["HS256"], audience: "multipart-upload", issuer: "roboroot-api",
  }));
}

export async function createUploadTicket(input: z.infer<typeof uploadManifestSchema>, owner: string | null) {
  const container = await getPrivateContainerClient();
  const key = `staging/${randomUUID()}`;
  const blob = container.getBlockBlobClient(key);
  const expiresOn = new Date(Date.now() + 20 * 60_000);
  const uploadUrl = await blob.generateSasUrl({
    permissions: BlobSASPermissions.parse("c"),
    startsOn: new Date(Date.now() - 60_000), expiresOn,
  });
  const ticket = jwt.sign({ ...input, key, owner }, signingKey(), {
    algorithm: "HS256", expiresIn: "20m", audience: "multipart-upload", issuer: "roboroot-api",
  });
  return { uploadUrl, ticket };
}
