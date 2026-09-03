import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { ComponentProductType } from "../generated/prisma/client.js";
import { uploadFileToAzure, FileType } from "../services/azure-storage.service.js";
import { generateUniqueSlug } from "../features/components/services/component.service.js";
import { cacheInvalidate } from "../lib/redis.js";

// A robust CSV line splitter that respects quotes
function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Simple robust CSV parser
function parseCSV(csvText: string): Record<string, string>[] {
  const lines: string[] = [];
  let currentLine = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentLine += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "\r") {
      // ignore
    } else if (char === "\n" && !inQuotes) {
      lines.push(currentLine);
      currentLine = "";
    } else {
      currentLine += char;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length === 0) return [];

  const headers = splitCSVLine(lines[0] || "");
  const result: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const values = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      let val = values[index] || "";
      // Strip outer quotes if any
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      }
      row[header] = val;
    });
    result.push(row);
  }

  return result;
}

function getRowValue(row: Record<string, string>, possibleKeys: string[]): string | undefined {
  const normalizedKeys = possibleKeys.map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const rowKey of Object.keys(row)) {
    const normRowKey = rowKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.includes(normRowKey)) {
      return row[rowKey]?.trim();
    }
  }
  return undefined;
}

/**
 * POST /api/admin/products/bulk-import
 * Accepts a CSV file in request body (or text field "csv")
 */
export async function bulkImportController(req: Request, res: Response): Promise<void> {
  try {
    let csvText = "";
    if (req.file?.buffer) {
      csvText = req.file.buffer.toString("utf-8");
    } else if (req.body && typeof req.body === "object" && "csv" in req.body && typeof req.body.csv === "string") {
      csvText = req.body.csv;
    } else if (typeof req.body === "string") {
      csvText = req.body;
    }

    if (!csvText) {
      res.status(400).json({ success: false, error: "No CSV content provided" });
      return;
    }

    const rows = parseCSV(csvText);
    if (rows.length === 0) {
      res.status(400).json({ success: false, error: "CSV is empty or missing headers" });
      return;
    }

    let createdCount = 0;
    let updatedCount = 0;

    // Process all rows sequentially to avoid transaction timeouts
    for (const row of rows) {
      const name = getRowValue(row, ["name", "title"]);
      if (!name) continue; // Skip rows without a name

      // Parse price (Rupees to Cents)
      const unitPrice = parseFloat(getRowValue(row, ["unitPrice", "price"]) || "0");
      const unitPriceCents = Math.round(unitPrice * 100);

      const discountedPriceVal = getRowValue(row, ["discountedPrice", "salePrice", "discounted_price"]);
      const discountedPriceCents = discountedPriceVal
        ? Math.round(parseFloat(discountedPriceVal) * 100)
        : null;

      const stockQuantity = parseInt(getRowValue(row, ["stockQuantity", "stock", "stock_quantity"]) || "0", 10);
      const sku = getRowValue(row, ["sku"]) || null;
      const description = getRowValue(row, ["description", "desc"]) || null;
      const typicalUseCase = getRowValue(row, ["typicalUseCase", "typical_use_case"]) || null;
      const vendorLink = getRowValue(row, ["vendorLink", "vendor_link"]) || null;
      const imageUrl = getRowValue(row, ["imageUrl", "image_url", "image"]) || null;
      const category = getRowValue(row, ["category"]) || "Electronics Components";
      const subcategory = getRowValue(row, ["subcategory"]) || "General";
      const brand = getRowValue(row, ["brand"]) || null;
      const slug = getRowValue(row, ["slug"]) || null;
      const productType = (getRowValue(row, ["productType", "product_type"]) || "ELECTRONICS_COMPONENT") as ComponentProductType;

      const tagsVal = getRowValue(row, ["tags"]);
      const tags = tagsVal
        ? tagsVal.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

      const isBestSellerVal = getRowValue(row, ["isBestSeller", "is_best_seller", "bestseller"]);
      const isBestSeller = isBestSellerVal === "true" || isBestSellerVal === "1";

      const isRobomaniacItemVal = getRowValue(row, ["isRobomaniacItem", "is_robomaniac_item", "robomaniac"]);
      const isRobomaniacItem = isRobomaniacItemVal === "true" || isRobomaniacItemVal === "1";

      const isSoftwareVal = getRowValue(row, ["isSoftware", "is_software", "software"]);
      const isSoftware = isSoftwareVal === "true" || isSoftwareVal === "1";

      const isActiveVal = getRowValue(row, ["isActive", "is_active", "active"]);
      const isActive = isActiveVal !== "false" && isActiveVal !== "0";

      console.log(`[CSV Import Row Debug] Parsed values for "${name}":`, {
        sku,
        description,
        typicalUseCase,
        imageUrl,
        tags,
      });

      // Try to match by SKU first (since SKU is a unique constraint field), then by ID
      const id = getRowValue(row, ["id"]) || null;
      let existing = null;

      if (sku) {
        existing = await prisma.component.findUnique({ where: { sku } });
      }
      if (!existing && id) {
        existing = await prisma.component.findUnique({ where: { id } });
      }

      if (existing) {
        const updateData: any = {
          name,
          sku,
          description,
          typicalUseCase,
          vendorLink,
          imageUrl,
          category,
          subcategory,
          brand,
          productType,
          tags,
          isBestSeller,
          isRobomaniacItem,
          isSoftware,
          unitPriceCents,
          discountedPriceCents,
          stockQuantity,
          isActive,
        };
        if (slug) {
          updateData.slug = await generateUniqueSlug(slug, existing.id);
        } else if (name !== existing.name) {
          updateData.slug = await generateUniqueSlug(name, existing.id);
        }
        await prisma.component.update({
          where: { id: existing.id },
          data: updateData,
        });
        updatedCount++;
      } else {
        const finalSlug = slug ? await generateUniqueSlug(slug) : await generateUniqueSlug(name);
        await prisma.component.create({
          data: {
            name,
            slug: finalSlug,
            sku,
            description,
            typicalUseCase,
            vendorLink,
            imageUrl,
            category,
            subcategory,
            brand,
            productType,
            tags,
            isBestSeller,
            isRobomaniacItem,
            isSoftware,
            unitPriceCents,
            discountedPriceCents,
            stockQuantity,
            isActive,
          },
        });
        createdCount++;
      }
    }

    // Invalidate components cache so updates reflect immediately
    await cacheInvalidate("http:/api/components*");

    res.status(200).json({
      success: true,
      message: `Bulk import completed successfully. Created ${createdCount} new products, updated ${updatedCount} existing products.`,
      data: { createdCount, updatedCount },
    });
  } catch (error) {
    console.error("Bulk import error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error during bulk import",
    });
  }
}

/**
 * GET /api/admin/products/export
 * Exports all products to a downloadable CSV
 */
export async function bulkExportController(req: Request, res: Response): Promise<void> {
  try {
    const products = await prisma.component.findMany({
      orderBy: { name: "asc" },
    });

    const headers = [
      "id",
      "name",
      "slug",
      "sku",
      "category",
      "subcategory",
      "brand",
      "productType",
      "unitPrice",
      "discountedPrice",
      "stockQuantity",
      "isBestSeller",
      "isRobomaniacItem",
      "isSoftware",
      "isActive",
      "tags",
      "imageUrl",
      "description",
      "typicalUseCase",
      "vendorLink",
    ];

    const csvRows = [headers.join(",")];

    for (const p of products) {
      const row = [
        p.id,
        `"${p.name.replace(/"/g, '""')}"`,
        p.slug ? `"${p.slug.replace(/"/g, '""')}"` : "",
        p.sku ? `"${p.sku.replace(/"/g, '""')}"` : "",
        `"${p.category.replace(/"/g, '""')}"`,
        `"${p.subcategory.replace(/"/g, '""')}"`,
        p.brand ? `"${p.brand.replace(/"/g, '""')}"` : "",
        p.productType,
        (p.unitPriceCents / 100).toFixed(2),
        p.discountedPriceCents ? (p.discountedPriceCents / 100).toFixed(2) : "",
        p.stockQuantity.toString(),
        p.isBestSeller ? "true" : "false",
        p.isRobomaniacItem ? "true" : "false",
        p.isSoftware ? "true" : "false",
        p.isActive ? "true" : "false",
        `"${p.tags.join(",").replace(/"/g, '""')}"`,
        p.imageUrl ? `"${p.imageUrl.replace(/"/g, '""')}"` : "",
        p.description ? `"${p.description.replace(/"/g, '""').replace(/\n/g, " ")}"` : "",
        p.typicalUseCase ? `"${p.typicalUseCase.replace(/"/g, '""').replace(/\n/g, " ")}"` : "",
        p.vendorLink ? `"${p.vendorLink.replace(/"/g, '""')}"` : "",
      ];
      csvRows.push(row.join(","));
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="roboroot-catalog-export.csv"');
    res.status(200).send(csvRows.join("\n"));
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ success: false, error: "Failed to export catalog" });
  }
}

/**
 * POST /api/admin/products/ai-generate
 * Generates product details using DeepSeek or Claude
 */
export async function aiGenerateProductController(req: Request, res: Response): Promise<void> {
  try {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ success: false, error: "Product name is required" });
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
      const baseUrl = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
      const model = process.env.NVIDIA_CHAT_MODEL || "deepseek-ai/deepseek-v4-pro";
      
      const apiResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nvidiaApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a helpful assistant that returns JSON." },
            { role: "user", content: systemPrompt },
          ],
          temperature: 0.2,
          max_tokens: 1000,
        }),
      });

      if (!apiResponse.ok) {
        throw new Error(`NVIDIA API returned status ${apiResponse.status}`);
      }

      const json = await apiResponse.json() as any;
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
          messages: [
            { role: "user", content: systemPrompt }
          ],
        }),
      });

      if (!apiResponse.ok) {
        throw new Error(`Anthropic API returned status ${apiResponse.status}`);
      }

      const json = await apiResponse.json() as any;
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
      error: error instanceof Error ? error.message : "Failed to generate product details",
    });
  }
}

/**
 * POST /api/admin/products/media/bulk-upload
 * Uploads multiple images to Azure Blob Storage and saves them in the Media Library
 */
export async function bulkUploadMediaController(req: Request, res: Response): Promise<void> {
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
        const result = await uploadFileToAzure(
          file.buffer,
          file.originalname,
          file.mimetype,
          FileType.COMPONENT_IMAGE
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
    res.status(500).json({ success: false, error: "Internal server error during bulk upload" });
  }
}

/**
 * GET /api/admin/products/media
 * Fetches all items in the Media Library
 */
export async function getMediaLibraryController(req: Request, res: Response): Promise<void> {
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
    res.status(500).json({ success: false, error: "Failed to fetch media library" });
  }
}

/**
 * DELETE /api/admin/products/media/:id
 * Deletes an item from the Media Library list
 */
export async function deleteMediaLibraryController(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ success: false, error: "Media ID is required" });
      return;
    }
    await prisma.mediaLibrary.delete({ where: { id } });
    res.status(200).json({ success: true, message: "Media deleted from library" });
  } catch (error) {
    console.error("Delete media error:", error);
    res.status(500).json({ success: false, error: "Failed to delete media item" });
  }
}

