import multer from "multer";
import { PassThrough, Transform, type Readable } from "node:stream";
import type { Request, RequestHandler } from "express";
import {
  readUploadTicket,
  stagedUploadStore,
} from "../services/upload-transport.service.js";

/** Existing Multer validation runs on the private R2 stream, after claiming its one-use ticket. */
export function withStagedUpload(
  handler: RequestHandler,
  store = stagedUploadStore,
): RequestHandler {
  return async (req, res, next) => {
    const ticket = req.get("x-upload-ticket");
    if (!ticket) {
      handler(req, res, next);
      return;
    }
    let manifest: ReturnType<typeof readUploadTicket>;
    try {
      manifest = readUploadTicket(ticket);
      const expectedMethod = /^\/api\/projects\/[^/]+\/upload$/.test(
        manifest.path,
      )
        ? "PUT"
        : "POST";
      if (
        req.method !== expectedMethod ||
        manifest.path.replace(/\/+$/, "") !==
          (req.baseUrl + req.path).replace(/\/+$/, "") ||
        manifest.owner !== (req.user?.userId ?? null)
      )
        throw new Error("Upload ticket does not belong to this request");
    } catch {
      res
        .status(400)
        .json({ success: false, error: "Invalid or expired upload ticket" });
      return;
    }
    try {
      await store.claim(manifest);
      try {
        const body = await store.open(manifest.key, manifest.size);
        if (!("pipe" in body)) throw new Error("Upload stream is unavailable");
        const source = body as Readable;
        let bytes = 0;
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            callback(
              bytes > manifest.size
                ? new Error("Uploaded data exceeds the ticket size")
                : null,
              chunk,
            );
          },
          flush(callback) {
            callback(
              bytes === manifest.size ? null : new Error("Incomplete upload"),
            );
          },
        });
        const stream = new PassThrough();
        const stagedRequest = Object.assign(stream, {
          headers: {
            ...req.headers,
            "content-type": manifest.contentType,
            "content-length": String(manifest.size),
          },
          method: req.method,
          url: req.url,
          user: req.user,
        }) as unknown as Request;
        delete stagedRequest.headers["transfer-encoding"];
        try {
          await new Promise<void>((resolve, reject) => {
            stream.on("error", reject);
            source.on("error", reject);
            limiter.on("error", reject);
            handler(stagedRequest, res, (error) =>
              error ? reject(error) : resolve(),
            );
            source.pipe(limiter).pipe(stream);
          });
          req.body = stagedRequest.body;
          if (stagedRequest.file) req.file = stagedRequest.file;
          if (stagedRequest.files) req.files = stagedRequest.files;
        } finally {
          source.destroy();
          limiter.destroy();
          stream.destroy();
        }
      } finally {
        // A cleanup failure is retried by the scheduled job; never replay the route's work.
        await store.remove(manifest.key).catch(() => undefined);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
function createUpload(options?: multer.Options): multer.Multer {
  const upload = multer(options);
  return {
    single: (name) => withStagedUpload(upload.single(name)),
    array: (name, count) => withStagedUpload(upload.array(name, count)),
    fields: (fields) => withStagedUpload(upload.fields(fields)),
    none: () => withStagedUpload(upload.none()),
    any: () => withStagedUpload(upload.any()),
  };
}
export default Object.assign(createUpload, {
  memoryStorage: multer.memoryStorage,
  diskStorage: multer.diskStorage,
});
