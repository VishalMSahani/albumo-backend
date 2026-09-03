import { Router, type Router as ExpressRouter } from "express";
import { authenticate } from "../../../middlewares/auth.middleware.js";
import {
  createAddressHandler,
  deleteAddressHandler,
  listAddressesHandler,
  setDefaultAddressHandler,
  updateAddressHandler,
} from "../controllers/address.controller.js";

const router: ExpressRouter = Router();

router.use(authenticate);

router.get("/", listAddressesHandler);
router.post("/", createAddressHandler);
router.patch("/:id", updateAddressHandler);
router.post("/:id/default", setDefaultAddressHandler);
router.delete("/:id", deleteAddressHandler);

export default router;
