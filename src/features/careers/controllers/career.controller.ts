import { type Request, type Response } from "express";
import { prisma } from "../../../lib/prisma.js";
import {
  queueAdminNotice,
  queueRawEmail,
} from "../../../services/email-notification.service.js";
import { albumoMessage } from "../../../utils/emailTemplates/albumo.js";
import {
  createCareerApplicationSchema,
  updateCareerApplicationSchema,
} from "../validators/career.validator.js";

/**
 * Submit a new career application
 */
export async function createCareerApplication(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    // 1. Validate request body
    const bodyValidation = createCareerApplicationSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      res.status(400).json({
        success: false,
        error: bodyValidation.error.issues[0]?.message || "Validation failed",
      });
      return;
    }

    const { name, email, phone, portfolioUrl, coverLetter } =
      bodyValidation.data;

    // 2. Save application to database
    const application = await prisma.careerApplication.create({
      data: {
        userId: req.user?.userId || null,
        name,
        email,
        phone,
        portfolioUrl,
        coverLetter,
      },
    });

    // Persist acknowledgements in the same delivery history as other Albumo emails.
    const acknowledgement = albumoMessage(
      "We've received your application",
      "Hi " +
        name +
        ",\n\nThank you for your interest in Albumo. Our team will review your application and get in touch if there is a suitable opportunity.",
    );
    await Promise.all([
      queueAdminNotice(
        "New Albumo career application",
        name +
          "\n" +
          email +
          "\n" +
          phone +
          "\nPortfolio: " +
          portfolioUrl +
          "\n\n" +
          coverLetter,
        "career-admin:" + application.id,
      ),
      queueRawEmail({
        email,
        eventType: "CUSTOM_EMAIL",
        subject: acknowledgement.subject,
        html: acknowledgement.html,
        text: acknowledgement.text || "",
        dedupeKey: "career-customer:" + application.id,
      }),
    ]).catch(() =>
      console.error("[Careers] Could not queue application notifications"),
    );

    res.status(201).json({
      success: true,
      message: "Career application submitted successfully",
      data: application,
    });
  } catch (error) {
    console.error("Create career application error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}

/**
 * Get all career applications (Admin only)
 */
export async function getCareerApplications(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (req.user?.role !== "ADMIN" && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({
        success: false,
        error: "Unauthorized access",
      });
      return;
    }

    const { status } = req.query;

    const applications = await prisma.careerApplication.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      data: applications,
    });
  } catch (error) {
    console.error("Get career applications error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}

/**
 * Update career application status and admin notes (Admin only)
 */
export async function updateCareerApplicationStatus(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (req.user?.role !== "ADMIN" && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({
        success: false,
        error: "Unauthorized access",
      });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res.status(400).json({
        success: false,
        error: "Application ID is required",
      });
      return;
    }

    const bodyValidation = updateCareerApplicationSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      res.status(400).json({
        success: false,
        error: bodyValidation.error.issues[0]?.message || "Invalid payload",
      });
      return;
    }

    const { status, adminNotes } = bodyValidation.data;

    const updateData: Record<string, any> = {};
    if (status !== undefined) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    const updated = await prisma.careerApplication.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: "Career application updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Update career application status error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}
