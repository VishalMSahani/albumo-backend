import { Router, type Router as RouterType } from "express";
import { authenticate } from "../../../middlewares/auth.middleware.js";
import * as wishlistController from "../controllers/wishlist.controller.js";

const router: RouterType = Router();

router.get("/", authenticate, wishlistController.getWishlistHandler);
router.post("/items", authenticate, wishlistController.addItemHandler);
router.get("/items/:componentId", authenticate, wishlistController.checkItemHandler);
router.delete("/items/:componentId", authenticate, wishlistController.removeItemHandler);
router.delete("/", authenticate, wishlistController.clearWishlistHandler);

export default router;
