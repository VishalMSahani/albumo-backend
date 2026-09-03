import { type Request, type Response } from "express";
import { prisma } from "../../../lib/prisma.js";
import { sendEmail } from "../../../services/email.service.js";
import { uploadFileToAzure, FileType } from "../../../services/azure-storage.service.js";
import { createBulkOrderSchema } from "../validators/bulk-order.validator.js";
import { ValidationError } from "../../../utils/types.js";

/**
 * Submit a new bulk order quote request
 */
export async function createBulkOrder(req: Request, res: Response): Promise<void> {
  try {
    // 1. Validate body
    const bodyValidation = createBulkOrderSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      res.status(400).json({
        success: false,
        error: bodyValidation.error.issues[0]?.message || "Validation failed",
      });
      return;
    }

    const { name, email, phone, companyName, notes } = bodyValidation.data;

    // 2. Handle file upload if present
    let csvFileUrl: string | undefined;
    let attachments: Array<{ filename: string; content: Buffer; contentType: string }> | undefined;

    if (req.file) {
      // Upload to Azure Storage
      const uploadRes = await uploadFileToAzure(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        FileType.BULK_ORDER_CSV
      );

      if ('success' in uploadRes && !uploadRes.success) {
        res.status(400).json({
          success: false,
          error: uploadRes.error || "Failed to upload CSV file",
        });
        return;
      }

      if ('url' in uploadRes) {
        csvFileUrl = uploadRes.url;
      }

      // Prepare attachment for email
      attachments = [{
        filename: req.file.originalname,
        content: req.file.buffer,
        contentType: req.file.mimetype,
      }];
    }

    // 3. Save to database
    const bulkOrder = await prisma.bulkOrderRequest.create({
      data: {
        userId: req.user?.userId || null,
        name,
        email,
        phone,
        companyName: companyName || null,
        csvFileUrl: csvFileUrl || null,
        notes: notes || null,
      },
    });

    // 4. Send email to admin
    const adminEmail = process.env.SMTP_USER || process.env.FROM_EMAIL || "admin@roboroot.in";
    const subject = `[Bulk Order Quote Request] New Request from ${name}`;
    
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e4e4e7; border-radius: 8px;">
        <h2 style="color: #000; border-bottom: 2px solid #000; padding-bottom: 10px; margin-top: 0;">New Bulk Order Quote Request</h2>
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold; width: 150px; color: #71717a;">Name:</td>
            <td style="padding: 8px 0; color: #09090b; font-weight: bold;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Email:</td>
            <td style="padding: 8px 0; color: #09090b;">${email}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Phone:</td>
            <td style="padding: 8px 0; color: #09090b; font-weight: bold; font-size: 15px;">${phone} (WhatsApp/Call)</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Company:</td>
            <td style="padding: 8px 0; color: #09090b;">${companyName || "N/A"}</td>
          </tr>
          ${csvFileUrl ? `
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #71717a;">CSV File Link:</td>
            <td style="padding: 8px 0; color: #09090b;"><a href="${csvFileUrl}" style="color: #1CA2D1; font-weight: bold;">Download CSV</a></td>
          </tr>
          ` : ""}
        </table>
        
        <div style="margin-top: 20px; padding: 15px; background: #f4f4f5; border-radius: 6px;">
          <h4 style="margin-top: 0; margin-bottom: 8px; color: #000;">Notes / Requirements:</h4>
          <p style="margin: 0; color: #27272a; white-space: pre-wrap; font-size: 14px; line-height: 1.5;">${notes || "No notes provided"}</p>
        </div>
        
        <p style="font-size: 12px; color: #a1a1aa; margin-top: 30px; text-align: center; border-top: 1px solid #e4e4e7; padding-top: 15px;">
          This request was submitted via roboroot.in. Request ID: ${bulkOrder.id}
        </p>
      </div>
    `;

    const textContent = `
      New Bulk Order Quote Request
      
      Name: ${name}
      Email: ${email}
      Phone: ${phone}
      Company: ${companyName || "N/A"}
      ${csvFileUrl ? `CSV File: ${csvFileUrl}` : ""}
      
      Notes:
      ${notes || "No notes provided"}
      
      Request ID: ${bulkOrder.id}
    `;

    // Send email asynchronously so user gets instant response
    sendEmail(adminEmail, subject, htmlContent, textContent, attachments).catch((err) => {
      console.error("Failed to send bulk order notification email:", err);
    });

    res.status(201).json({
      success: true,
      message: "Bulk order quote request submitted successfully",
      data: bulkOrder,
    });
  } catch (error) {
    console.error("Create bulk order error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}

/**
 * Get all bulk order requests (Admin only)
 */
export async function getBulkOrders(req: Request, res: Response): Promise<void> {
  try {
    // Double check admin role
    if (req.user?.role !== "ADMIN" && req.user?.role !== "SUPER_ADMIN") {
      res.status(403).json({
        success: false,
        error: "Unauthorized access",
      });
      return;
    }

    const { status } = req.query;

    const bulkOrders = await prisma.bulkOrderRequest.findMany({
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
      data: bulkOrders,
    });
  } catch (error) {
    console.error("Get bulk orders error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}

/**
 * Update status of a bulk order request (Admin only)
 */
export async function updateBulkOrderStatus(req: Request, res: Response): Promise<void> {
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
        error: "Request ID is required",
      });
      return;
    }
    const { status, adminNotes } = req.body;

    const updated = await prisma.bulkOrderRequest.update({
      where: { id },
      data: {
        status: status || undefined,
        adminNotes: adminNotes !== undefined ? adminNotes : undefined,
      },
    });

    res.status(200).json({
      success: true,
      message: "Bulk order status updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Update bulk order status error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}
