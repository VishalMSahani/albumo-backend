import multer from "multer";
import { PassThrough } from "node:stream";
import type { Request, RequestHandler } from "express";
import { readUploadTicket } from "../services/upload-transport.service.js";
import { getPrivateContainerClient } from "../services/azure-storage.service.js";

/** Run the route's existing file filters and limits on a staged multipart stream. */
export function withStagedUpload(handler: RequestHandler, openContainer = getPrivateContainerClient): RequestHandler {
  return async (req, res, next) => {
    const ticket = req.get("x-upload-ticket");
    if (!ticket) { handler(req, res, next); return; }
    let manifest: ReturnType<typeof readUploadTicket>;
    try {
      manifest = readUploadTicket(ticket);
      if (req.method !== "POST" || manifest.path.replace(/\/+$/, "") !== `${req.baseUrl}${req.path}`.replace(/\/+$/, "") ||
          manifest.owner !== (req.user?.userId ?? null)) {
        throw new Error("Upload ticket does not belong to this request");
      }
    } catch {
      res.status(400).json({ success: false, error: "Invalid or expired upload ticket" });
      return;
    }
    try {
      const container = await openContainer();
      const blob = container.getBlockBlobClient(manifest.key);
      const lease = blob.getBlobLeaseClient();
      await lease.acquireLease(60);
      try {
        const properties = await blob.getProperties({ conditions: { leaseId: lease.leaseId } });
        if (properties.contentLength !== manifest.size) {
          throw Object.assign(new Error("Uploaded size does not match the upload ticket"), { statusCode: 400 });
        }
        const download = await blob.download(0, manifest.size, {
          conditions: { ifMatch: properties.etag!, leaseId: lease.leaseId },
        });
        if (!download.readableStreamBody) throw new Error("Upload stream is unavailable");
        const stream = new PassThrough();
        const stagedRequest = Object.assign(stream, {
          headers: { ...req.headers, "content-type": manifest.contentType, "content-length": String(manifest.size) },
          method: req.method, url: req.url, user: req.user,
        }) as unknown as Request;
        delete stagedRequest.headers["transfer-encoding"];
        try {
          await new Promise<void>((resolve, reject) => {
            stream.on("error", reject);
            download.readableStreamBody!.on("error", reject);
            handler(stagedRequest, res, error => error ? reject(error) : resolve());
            download.readableStreamBody!.pipe(stream);
          });
          req.body = stagedRequest.body;
          if (stagedRequest.file) req.file = stagedRequest.file;
          if (stagedRequest.files) req.files = stagedRequest.files;
        } finally {
          download.readableStreamBody.unpipe(stream);
          stream.destroy();
          // Fully drain or close the Azure response even when a file filter rejects it.
          if ("destroy" in download.readableStreamBody) {
            (download.readableStreamBody as PassThrough).destroy();
          }
        }
      } finally {
        await blob.deleteIfExists({ conditions: { leaseId: lease.leaseId } });
      }
      next();
    } catch (error) { next(error); }
  };
}

function createUpload(options?: multer.Options): multer.Multer {
  const upload = multer(options);
  return {
    single: name => withStagedUpload(upload.single(name)),
    array: (name, count) => withStagedUpload(upload.array(name, count)),
    fields: fields => withStagedUpload(upload.fields(fields)),
    none: () => withStagedUpload(upload.none()),
    any: () => withStagedUpload(upload.any()),
  };
}
export default Object.assign(createUpload, { memoryStorage: multer.memoryStorage, diskStorage: multer.diskStorage });
