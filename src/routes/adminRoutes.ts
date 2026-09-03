/**
 * Admin Routes
 * Routes for admin management operations
 */

import { Router, type Router as RouterType } from "express";
import {
  promoteToAdminController,
  demoteFromAdminController,
  listAdminsController,
} from "../controller/admin.js";
import {
  listCustomersHandler,
  getCustomerDetailHandler,
  updateCustomerStatusHandler,
} from "../features/admin/controllers/customer.controller.js";
import {
  revenueHandler,
  ordersHandler,
  topProductsHandler,
  lowStockHandler,
  dashboardKpisHandler,
} from "../features/admin/controllers/analytics.controller.js";
import {
  getDeliverySettingsHandler,
  updateDeliverySettingsHandler,
} from "../features/settings/controllers/store-settings.controller.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  adminCustomerIdParamsSchema,
  adminCustomerListQuerySchema,
  adminCustomerStatusBodySchema,
  adminDeliverySettingsBodySchema,
  adminRoleMutationBodySchema,
} from "../validators/admin.validator.js";

const router: RouterType = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(authorize("ADMIN"));

// Admin management routes
router.post("/promote", validate({ body: adminRoleMutationBodySchema }), promoteToAdminController);
router.post("/demote", validate({ body: adminRoleMutationBodySchema }), demoteFromAdminController);
router.get("/list", listAdminsController);

// Store settings
router.get("/settings/delivery", getDeliverySettingsHandler);
router.patch(
  "/settings/delivery",
  validate({ body: adminDeliverySettingsBodySchema }),
  updateDeliverySettingsHandler,
);

// Customer management
router.get("/customers", validate({ query: adminCustomerListQuerySchema }), listCustomersHandler);
router.get("/customers/:id", validate({ params: adminCustomerIdParamsSchema }), getCustomerDetailHandler);
router.patch(
  "/customers/:id/status",
  validate({
    params: adminCustomerIdParamsSchema,
    body: adminCustomerStatusBodySchema,
  }),
  updateCustomerStatusHandler
);

// Analytics
router.get("/analytics/kpis", dashboardKpisHandler);
router.get("/analytics/revenue", revenueHandler);
router.get("/analytics/orders", ordersHandler);
router.get("/analytics/top-products", topProductsHandler);
router.get("/analytics/low-stock", lowStockHandler);

export default router;
