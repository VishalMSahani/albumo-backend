import { Router, type Router as RouterType } from "express";
import { getDeliverySettingsHandler } from "../controllers/store-settings.controller.js";

const router: RouterType = Router();

router.get("/delivery", getDeliverySettingsHandler);

export default router;
