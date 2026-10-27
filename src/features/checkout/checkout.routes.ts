import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { AuthError } from "../../utils/types.js";
import { studioError } from "../studio/collection.routes.js";
import { getConsentAuditContext } from "../legal/legal.controller.js";
import {
  addAlbumSchema,
  checkoutSchema,
  quantity,
  quoteSchema,
} from "./checkout.schema.js";
import {
  addAlbumToCart,
  changeAlbumQuantity,
  getCheckoutCart,
} from "./cart.service.js";
import {
  createCheckoutOrder,
  checkoutAttempt,
  checkoutOrder,
  savedCartDesign,
  savedOrderDesign,
} from "./checkout.service.js";

const router = Router();
const id = z.object({ id: z.string().min(1).max(100) });
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
router.use(authenticate);
router.get("/cart", async (req, res) =>
  res.json({ success: true, data: await getCheckoutCart(req.user!.userId) }),
);
router.post("/quote", validate({ body: quoteSchema }), async (req, res) =>
  res.json({
    success: true,
    data: await getCheckoutCart(req.user!.userId, req.body.couponCode),
  }),
);
router.post(
  "/albums/:id",
  validate({ params: z.object({ id: z.uuid() }), body: addAlbumSchema }),
  async (req, res) =>
    res.json({
      success: true,
      data: await addAlbumToCart(
        req.user!.userId,
        String(req.params.id),
        req.body.baseRevision,
      ),
    }),
);
router.patch(
  "/albums/:id",
  validate({
    params: z.object({ id: z.uuid() }),
    body: z
      .object({
        version: z.number().int().min(1),
        quantity: quantity.nullable(),
      })
      .strict(),
  }),
  async (req, res) =>
    res.json({
      success: true,
      data: await changeAlbumQuantity(
        req.user!.userId,
        String(req.params.id),
        req.body.version,
        req.body.quantity,
      ),
    }),
);
router.get(
  "/albums/:id/design",
  validate({ params: z.object({ id: z.uuid() }) }),
  async (req, res) =>
    res.json({
      success: true,
      data: await savedCartDesign(req.user!.userId, String(req.params.id)),
    }),
);
router.post("/orders", validate({ body: checkoutSchema }), async (req, res) =>
  res
    .status(201)
    .json({
      success: true,
      data: await createCheckoutOrder(
        req.user!.userId,
        checkoutSchema.parse(req.body),
        getConsentAuditContext(req),
      ),
    }),
);
router.get(
  "/attempts/:id",
  validate({ params: z.object({ id: z.uuid() }) }),
  async (req, res) =>
    res.json({
      success: true,
      data: await checkoutAttempt(req.user!.userId, String(req.params.id)),
    }),
);
router.get("/orders/:id", validate({ params: id }), async (req, res) =>
  res.json({
    success: true,
    data: await checkoutOrder(req.user!.userId, String(req.params.id)),
  }),
);
router.get(
  "/orders/:id/items/:itemId/design",
  validate({ params: id.extend({ itemId: z.string().min(1).max(100) }) }),
  async (req, res) =>
    res.json({
      success: true,
      data: await savedOrderDesign(
        req.user!.userId,
        String(req.params.id),
        String(req.params.itemId),
      ),
    }),
);
router.use(
  (error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (error instanceof AuthError)
      res
        .status(error.statusCode)
        .json({ success: false, code: error.code, error: error.message });
    else studioError(error, req, res, next);
  },
);
export default router;
