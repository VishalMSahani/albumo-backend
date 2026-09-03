import { type Request, type Response } from "express";
import { prisma } from "../../../lib/prisma.js";
import { sendEmail } from "../../../services/email.service.js";
import { createCareerApplicationSchema, updateCareerApplicationSchema } from "../validators/career.validator.js";

/**
 * Submit a new career application
 */
export async function createCareerApplication(req: Request, res: Response): Promise<void> {
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

    const { name, email, phone, portfolioUrl, coverLetter } = bodyValidation.data;

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

    // 3. Send Notification Email to Admin
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_USER || process.env.FROM_EMAIL || "hiring@roboroot.in";
    const adminSubject = `[Career Application] New Speculative Application from ${name}`;

    const adminHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e4e4e7; border-radius: 8px;">
        <h2 style="color: #222; border-bottom: 2px solid #1CA2D1; padding-bottom: 10px; margin-top: 0;">New Career Application Received</h2>
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold; width: 140px; color: #71717a;">Full Name:</td>
            <td style="padding: 8px 0; color: #09090b; font-weight: bold;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Email:</td>
            <td style="padding: 8px 0; color: #09090b;"><a href="mailto:${email}" style="color: #1CA2D1;">${email}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Phone:</td>
            <td style="padding: 8px 0; color: #09090b; font-weight: bold;">${phone}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Portfolio / Links:</td>
            <td style="padding: 8px 0; color: #09090b;"><a href="${portfolioUrl}" target="_blank" style="color: #1CA2D1; font-weight: bold;">${portfolioUrl}</a></td>
          </tr>
        </table>
        
        <div style="margin-top: 20px; padding: 15px; background: #f4f4f5; border-radius: 6px;">
          <h4 style="margin-top: 0; margin-bottom: 8px; color: #222;">Cover Letter & Pitch Summary:</h4>
          <p style="margin: 0; color: #27272a; white-space: pre-wrap; font-size: 14px; line-height: 1.5;">${coverLetter}</p>
        </div>
        
        <p style="font-size: 12px; color: #a1a1aa; margin-top: 30px; text-align: center; border-top: 1px solid #e4e4e7; padding-top: 15px;">
          Submitted via roboroot.in. Application ID: ${application.id}
        </p>
      </div>
    `;

    const adminText = `
      New Career Application Received
      
      Full Name: ${name}
      Email: ${email}
      Phone: ${phone}
      Portfolio / GitHub / LinkedIn: ${portfolioUrl}
      
      Cover Letter & Pitch:
      ${coverLetter}
      
      Application ID: ${application.id}
    `;

    // 4. Candidate Email Templates
    const candidateSubject = `We've received your application to join RoboRoot`;

    const candidateHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e4e4e7; border-radius: 8px;">
        <h2 style="color: #222; margin-top: 0;">Hi ${name},</h2>
        <p style="font-size: 14px; line-height: 1.6; color: #3f3f46;">
          Thank you for your interest in joining the <strong>RoboRoot</strong> engineering and sourcing labs!
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #3f3f46;">
          We have successfully received your application. Our engineering team and lab builders review incoming profiles regularly. If your skills match our current hardware or software projects, we'll reach out to schedule an interview.
        </p>
        
        <div style="margin-top: 25px; padding: 15px; background: #f8fafc; border-left: 4px solid #1CA2D1; border-radius: 4px;">
          <p style="margin: 0; font-size: 13px; color: #475569;">
            <strong>Application Reference:</strong> ${application.id}
          </p>
        </div>

        <p style="font-size: 14px; line-height: 1.6; color: #3f3f46; margin-top: 30px;">
          Best regards,<br />
          <strong>RoboRoot Sourcing & Engineering Team</strong><br />
          <a href="https://roboroot.in" style="color: #1CA2D1;">roboroot.in</a>
        </p>
      </div>
    `;

    const candidateText = `
      Hi ${name},
      
      Thank you for your interest in joining the RoboRoot engineering and sourcing labs!
      We have successfully received your application. Our engineering team reviews incoming profiles regularly and will reach out if your background fits our current lab directions.
      
      Application Reference: ${application.id}
      
      Best regards,
      RoboRoot Engineering Team
      roboroot.in
    `;

    // Dispatch emails to Admin and Candidate
    sendEmail(adminEmail, adminSubject, adminHtml, adminText)
      .then((res) => console.log(`📧 Admin notification email sent for application ${application.id}:`, res.messageId || res))
      .catch((err) => console.error("Failed to send career application admin email:", err));

    sendEmail(email, candidateSubject, candidateHtml, candidateText)
      .then((res) => console.log(`📧 Candidate confirmation email sent to ${email}:`, res.messageId || res))
      .catch((err) => console.error("Failed to send candidate confirmation email:", err));

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
export async function getCareerApplications(req: Request, res: Response): Promise<void> {
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
export async function updateCareerApplicationStatus(req: Request, res: Response): Promise<void> {
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
