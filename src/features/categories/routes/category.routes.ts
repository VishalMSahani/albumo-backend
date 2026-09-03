import { Router } from "express";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import * as categoryController from "../controllers/category.controller.js";

const router: Router = Router();

// Public route to fetch all categories
router.get("/", categoryController.getAllCategoriesHandler);

// Admin only routes
router.use(authenticate, authorize("ADMIN", "SUPER_ADMIN"));

router.post("/", categoryController.createCategoryHandler);
router.patch("/:id", categoryController.updateCategoryHandler);
router.delete("/:id", categoryController.deleteCategoryHandler);

router.post("/:id/subcategories", categoryController.createSubcategoryHandler);
router.patch("/:id/subcategories/:subId", categoryController.updateSubcategoryHandler);
router.delete("/:id/subcategories/:subId", categoryController.deleteSubcategoryHandler);

export default router;
