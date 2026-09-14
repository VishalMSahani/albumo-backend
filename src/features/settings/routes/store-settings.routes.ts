import { Router, type Router as RouterType } from "express";
import { getDeliverySettingsHandler, getProductSettingsHandler } from "../controllers/store-settings.controller.js";
import { asyncHandler } from '../../../utils/async-handler.js';

const router: RouterType = Router();

router.get("/delivery", getDeliverySettingsHandler);
router.get('/products', asyncHandler(getProductSettingsHandler));

export default router;
