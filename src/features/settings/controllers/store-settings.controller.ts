import type { Request, Response } from "express";
import { logAdminAction } from "../../../services/admin-action-log.service.js";
import {
  getDeliverySettings,
  updateDeliverySettings,
} from "../services/store-settings.service.js";

export async function getDeliverySettingsHandler(_req: Request, res: Response): Promise<void> {
  const settings = await getDeliverySettings();
  res.json({ success: true, data: settings });
}

export async function updateDeliverySettingsHandler(req: Request, res: Response): Promise<void> {
  const settings = await updateDeliverySettings({
    deliveryFeeEnabled: req.body.deliveryFeeEnabled,
    deliveryFeeCents: req.body.deliveryFeeCents,
    freeDeliveryThresholdCents: req.body.freeDeliveryThresholdCents,
    deliveryFeeRules: req.body.deliveryFeeRules,
  });

  void logAdminAction(
    req.user!.userId,
    "UPDATE_STORE_SETTINGS",
    "STORE_SETTING",
    "delivery",
    {
      deliveryFeeEnabled: settings.deliveryFeeEnabled,
      deliveryFeeCents: settings.deliveryFeeCents,
      freeDeliveryThresholdCents: settings.freeDeliveryThresholdCents,
      deliveryFeeRules: settings.deliveryFeeRules,
    },
  );

  res.json({
    success: true,
    data: settings,
    message: "Delivery settings updated",
  });
}
