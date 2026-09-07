import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { optionalAuthenticate } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { createUploadTicket, publicUploadPaths, uploadManifestSchema } from "../services/upload-transport.service.js";

const router: Router = Router();
router.get("/config", (_req, res) => {
  res.json({ success: true, data: { directUploads: Boolean(process.env.VERCEL) || process.env.DIRECT_UPLOADS_ENABLED === "true" } });
});
router.post("/prepare", rateLimit({ windowMs: 15 * 60_000, limit: 30 }),
  optionalAuthenticate, validate({ body: uploadManifestSchema }), async (req, res, next) => {
    try {
      const input = uploadManifestSchema.parse(req.body);
      if (!req.user && !publicUploadPaths.has(input.path)) {
        res.status(401).json({ success: false, error: "Sign in before uploading" });
        return;
      }
      const data = await createUploadTicket(input, req.user?.userId ?? null);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  });
export default router;
