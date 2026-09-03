import type { Request, Response } from "express";
import {
  createUserAddress,
  deleteUserAddress,
  listUserAddresses,
  setDefaultUserAddress,
  updateUserAddress,
  type AddressInput,
} from "../services/address.service.js";

function userIdFromRequest(req: Request) {
  const userId = req.user?.userId;

  if (!userId) {
    throw new Error("User is not authenticated");
  }

  return userId;
}

function addressInputFromBody(body: Record<string, unknown>): AddressInput {
  return {
    name: String(body.name || ""),
    phone: String(body.phone || ""),
    line1: String(body.line1 || ""),
    line2: body.line2 ? String(body.line2) : undefined,
    city: String(body.city || ""),
    state: String(body.state || ""),
    pincode: String(body.pincode || ""),
    country: body.country ? String(body.country) : undefined,
    isDefault: Boolean(body.isDefault),
  };
}

export async function listAddressesHandler(req: Request, res: Response) {
  const addresses = await listUserAddresses(userIdFromRequest(req));

  res.json({
    success: true,
    data: addresses,
  });
}

export async function createAddressHandler(req: Request, res: Response) {
  try {
    const address = await createUserAddress(userIdFromRequest(req), addressInputFromBody(req.body));

    res.status(201).json({
      success: true,
      data: address,
      message: "Address created",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create address",
    });
  }
}

export async function updateAddressHandler(req: Request, res: Response) {
  try {
    const addressId = req.params.id;

    if (!addressId) {
      res.status(400).json({
        success: false,
        error: "Address ID is required",
      });
      return;
    }

    const address = await updateUserAddress(userIdFromRequest(req), addressId, addressInputFromBody(req.body));

    res.json({
      success: true,
      data: address,
      message: "Address updated",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update address",
    });
  }
}

export async function setDefaultAddressHandler(req: Request, res: Response) {
  try {
    const addressId = req.params.id;

    if (!addressId) {
      res.status(400).json({
        success: false,
        error: "Address ID is required",
      });
      return;
    }

    const address = await setDefaultUserAddress(userIdFromRequest(req), addressId);

    res.json({
      success: true,
      data: address,
      message: "Default address updated",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update default address",
    });
  }
}

export async function deleteAddressHandler(req: Request, res: Response) {
  try {
    const addressId = req.params.id;

    if (!addressId) {
      res.status(400).json({
        success: false,
        error: "Address ID is required",
      });
      return;
    }

    await deleteUserAddress(userIdFromRequest(req), addressId);

    res.json({
      success: true,
      message: "Address deleted",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete address",
    });
  }
}
