import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { uploadFile, FileType } from "../services/storage.service.js";
import {
  createComponent,
  updateComponent,
} from "../features/components/services/component.service.js";
import { prepareProductImportRow } from "../features/components/services/product-import.service.js";
import { cacheInvalidate } from "../lib/redis.js";
import {
  parseProductCsv,
  productsToCsv,
  productTemplateCsv,
} from "../features/components/validators/product-csv.js";

export async function bulkImportController(
  req: Request,
  res: Response,
): Promise<void> {
  let rows: ReturnType<typeof parseProductCsv>;
  try {
    const text =
      req.file?.buffer?.toString("utf-8") ||
      (typeof req.body === "string"
        ? req.body
        : typeof req.body?.csv === "string"
          ? req.body.csv
          : "");
    if (Buffer.byteLength(text, "utf8") > 5 * 1024 * 1024)
      throw new Error("CSV must be 5 MB or smaller");
    rows = parseProductCsv(text);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Invalid CSV",
    });
    return;
  }
  const dryRun = req.query.dryRun === "true";
  let createdCount = 0,
    updatedCount = 0;
  const errors: { row: number; name: string; error: string }[] = [];
  const previews: {
    row: number;
    action: string;
    category: string;
    optionGroups: number;
    isActive: boolean;
  }[] = [];
  const targets = new Set<string>();
  for (const row of rows) {
    try {
      const prepared = await prepareProductImportRow(row);
      const { existing, data } = prepared;
      const key = existing?.id ?? data.sku!;
      if (targets.has(key))
        throw new Error(
          "This file targets the same product more than once; keep one row per product",
        );
      targets.add(key);
      previews.push({
        row: row.rowNumber,
        action: existing ? "Update" : "Create",
        category: data.category + " / " + data.subcategory,
        optionGroups: data.configuration.groups.length,
        isActive: data.isActive ?? existing?.isActive ?? false,
      });
      if (dryRun) continue;
      if (existing) {
        await updateComponent(existing.id, data);
        updatedCount++;
      } else {
        await createComponent(data);
        createdCount++;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save this row";
      errors.push({
        row: row.rowNumber,
        name: row.data.name,
        error: /prisma|invocation|database/i.test(message)
          ? "Could not save this row; check duplicate SKU/slug or retry"
          : message,
      });
    }
  }
  if (createdCount || updatedCount)
    await Promise.all([
      cacheInvalidate("http:/api/components*"),
      cacheInvalidate("http:/api/projects*"),
    ]);
  res.status(200).json({
    success: errors.length === 0,
    message: dryRun
      ? "Checked " +
        rows.length +
        " products. " +
        errors.length +
        " need correction. Nothing has been saved."
      : "Created " +
        createdCount +
        ", updated " +
        updatedCount +
        ", failed " +
        errors.length +
        ". Successful rows have been saved.",
    data: { createdCount, updatedCount, errors, previews, dryRun },
  });
}

export async function productTemplateController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const categoryId =
      typeof req.query.subcategoryId === "string"
        ? req.query.subcategoryId
        : undefined;
    const categories = await prisma.subcategory.findMany({
      where: categoryId ? { id: categoryId } : {},
      include: { category: true },
      orderBy: [{ categoryId: "asc" }, { name: "asc" }],
    });
    if (!categories.length) {
      res.status(400).json({
        error:
          "Create or select an existing category before downloading a template",
      });
      return;
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="albumo-product-template.csv"',
    );
    res.status(200).send(productTemplateCsv(categories));
  } catch {
    res.status(500).json({
      success: false,
      error: "Failed to generate the category template",
    });
  }
}

export async function bulkExportController(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const products = await prisma.component.findMany({
      orderBy: { name: "asc" },
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="albumo-catalogue-export.csv"',
    );
    res.status(200).send(productsToCsv(products));
  } catch {
    res
      .status(500)
      .json({ success: false, error: "Failed to export catalogue" });
  }
}

/**
 * POST /api/admin/products/ai-generate
 * Generates product details using DeepSeek or Claude
 */
export async function aiGenerateProductController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { name } = req.body;
    if (!name) {
      res
        .status(400)
        .json({ success: false, error: "Product name is required" });
      return;
    }

    const systemPrompt = `You are a helpful AI assistant for RoboRoot, an Indian e-commerce marketplace for electronics components, robotics, course kits, and drones.
Analyze the product name: "${name}".
Generate product information in JSON format with the following fields:
- description: A detailed description of the product (2-3 sentences), highlighting its features and what it's used for.
- typicalUseCase: 1 sentence describing a typical project or use case.
- category: Choose the most appropriate category (e.g. "Semiconductors", "Sensors", "Development Boards", "Motors & Actuators", "Power & Batteries", "Drones & Aerospace", "Tools & Prototyping").
- subcategory: Choose or create a specific subcategory (e.g. "Microcontrollers", "Gas Sensors", "BLDC Motors", "LiPo Batteries", "Soldering Tools").
- brand: Suggest the manufacturer or brand (e.g. "Arduino", "Espressif", "Raspberry Pi", "Generic").
- tags: An array of 3-5 keywords.
- suggestedPriceINR: A suggested retail price in Rupees as a number.

Respond ONLY with a valid, parsable JSON object. No markdown wrapping, no explanation.`;

    let responseText = "";

    const nvidiaApiKey = process.env.NVIDIA_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    if (nvidiaApiKey) {
      // Call DeepSeek/Nvidia API
      const baseUrl =
        process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
      const model =
        process.env.NVIDIA_CHAT_MODEL || "deepseek-ai/deepseek-v4-pro";

      const apiResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nvidiaApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant that returns JSON.",
            },
            { role: "user", content: systemPrompt },
          ],
          temperature: 0.2,
          max_tokens: 1000,
        }),
      });

      if (!apiResponse.ok) {
        throw new Error(`NVIDIA API returned status ${apiResponse.status}`);
      }

      const json = (await apiResponse.json()) as any;
      responseText = json.choices?.[0]?.message?.content || "";
    } else if (anthropicApiKey) {
      // Call Anthropic API
      const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
      const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          messages: [{ role: "user", content: systemPrompt }],
        }),
      });

      if (!apiResponse.ok) {
        throw new Error(`Anthropic API returned status ${apiResponse.status}`);
      }

      const json = (await apiResponse.json()) as any;
      responseText = json.content?.[0]?.text || "";
    } else {
      // Fallback if no LLM configured
      res.status(200).json({
        success: true,
        data: {
          description: `High quality ${name} for robotics, IoT, and DIY projects.`,
          typicalUseCase: `Used in various electronics and smart automation projects.`,
          category: "Development Boards",
          subcategory: "General",
          brand: "Generic",
          tags: ["electronics", "diy"],
          suggestedPriceINR: 299,
        },
      });
      return;
    }

    // Clean response text if it contains markdown code blocks
    let cleanJson = responseText.trim();
    if (cleanJson.startsWith("```json")) {
      cleanJson = cleanJson.substring(7);
    }
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.substring(3);
    }
    if (cleanJson.endsWith("```")) {
      cleanJson = cleanJson.substring(0, cleanJson.length - 3);
    }
    cleanJson = cleanJson.trim();

    const data = JSON.parse(cleanJson);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("AI Generate error:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to generate product details",
    });
  }
}

/**
 * POST /api/admin/products/media/bulk-upload
 * Uploads multiple images to Cloudflare R2 and saves them in the Media Library
 */
export async function bulkUploadMediaController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ success: false, error: "No files uploaded" });
      return;
    }

    const uploadedItems = [];
    const errors = [];

    for (const file of files) {
      try {
        const result = await uploadFile(
          file.buffer,
          file.originalname,
          file.mimetype,
          FileType.COMPONENT_IMAGE,
        );

        if ("error" in result) {
          errors.push({ filename: file.originalname, error: result.error });
        } else {
          // Save in MediaLibrary database table
          const mediaItem = await prisma.mediaLibrary.create({
            data: {
              url: result.url,
              filename: file.originalname,
              mimeType: file.mimetype,
              sizeBytes: file.size,
            },
          });
          uploadedItems.push(mediaItem);
        }
      } catch (err) {
        errors.push({
          filename: file.originalname,
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Uploaded ${uploadedItems.length} files successfully. ${errors.length} errors.`,
      data: { uploadedItems, errors },
    });
  } catch (error) {
    console.error("Bulk upload error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during bulk upload",
    });
  }
}

/**
 * GET /api/admin/products/media
 * Fetches all items in the Media Library
 */
export async function getMediaLibraryController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.mediaLibrary.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.mediaLibrary.count(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Fetch media library error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch media library" });
  }
}

/**
 * DELETE /api/admin/products/media/:id
 * Deletes an item from the Media Library list
 */
export async function deleteMediaLibraryController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, error: "Media ID is required" });
      return;
    }
    await prisma.mediaLibrary.delete({ where: { id } });
    res
      .status(200)
      .json({ success: true, message: "Media deleted from library" });
  } catch (error) {
    console.error("Delete media error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete media item" });
  }
}
