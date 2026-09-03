import { Router, type Router as RouterType } from "express";
import { authenticate } from "../../../middlewares/auth.middleware.js";
import * as cartController from "../controllers/cart.controller.js";

const router: RouterType = Router();

router.get("/", authenticate, cartController.getCartHandler);
router.put("/items", authenticate, cartController.upsertItemHandler);
router.delete("/items/:componentId", authenticate, cartController.removeItemHandler);
router.delete("/", authenticate, cartController.clearCartHandler);
router.post("/sync", authenticate, cartController.syncCartHandler);

export default router;
