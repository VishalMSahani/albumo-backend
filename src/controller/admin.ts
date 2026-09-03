/**
 * Admin Management Controller
 * Endpoints for admin-only operations
 */

import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../utils/types.js";
import { UserRole } from "../generated/prisma/client.js";

/**
 * Promote a user to admin role
 * POST /api/admin/promote
 * Access: Admin only
 */
export async function promoteToAdminController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      throw new ValidationError("Email is required");
    }

    // Find the user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (user.role === UserRole.ADMIN) {
      throw new ValidationError("User is already an admin");
    }

    // Update user role to ADMIN
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.ADMIN },
    });

    console.log(`✅ User promoted to admin: ${updatedUser.email} by ${req.user?.email}`);

    res.status(200).json({
      success: true,
      message: "User promoted to admin successfully",
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ForbiddenError
    ) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
      });
      return;
    }

    console.error("Promote to admin error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to promote user to admin",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * Demote an admin to student role
 * POST /api/admin/demote
 * Access: Admin only
 */
export async function demoteFromAdminController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      throw new ValidationError("Email is required");
    }

    // Prevent self-demotion
    if (req.user?.email === email.toLowerCase().trim()) {
      throw new ForbiddenError("You cannot demote yourself");
    }

    // Find the user
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (user.role !== UserRole.ADMIN) {
      throw new ValidationError("User is not an admin");
    }

    // Update user role to STUDENT
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.STUDENT },
    });

    console.log(`✅ Admin demoted: ${updatedUser.email} by ${req.user?.email}`);

    res.status(200).json({
      success: true,
      message: "Admin demoted to student successfully",
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ForbiddenError
    ) {
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
      });
      return;
    }

    console.error("Demote admin error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to demote admin",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * List all admin users
 * GET /api/admin/list
 * Access: Admin only
 */
export async function listAdminsController(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        college: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      data: admins,
      count: admins.length,
    });
  } catch (error) {
    console.error("List admins error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to list admins",
      code: "INTERNAL_ERROR",
    });
  }
}
