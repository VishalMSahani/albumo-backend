import { z } from "zod";
import { catalogueImageSchema } from "./catalogue-images.js";
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, hyphens or underscores");
const choice = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    priceAdjustmentCents: z.number().int().min(0).max(100000000).default(0),
    width: z.number().positive().max(10000).optional(),
    height: z.number().positive().max(10000).optional(),
    unit: z.enum(["in", "cm", "mm"]).optional(),
    imageUrl: catalogueImageSchema.optional(),
  })
  .strict();
const group = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(100),
    kind: z.enum([
      "dimension",
      "cover",
      "paper",
      "finish",
      "binding",
      "pages",
      "design",
      "color",
      "frame",
      "extra",
    ]),
    required: z.boolean(),
    defaultOptionId: z.string().max(80).default(""),
    options: z.array(choice).min(1, "Add at least one choice").max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.options.map((item) => item.id)).size !== value.options.length)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choice IDs must be unique within a group",
      });
    if (
      value.defaultOptionId &&
      !value.options.some((item) => item.id === value.defaultOptionId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["defaultOptionId"],
        message: "Default must be an available choice",
      });
    value.options.forEach((item, i) => {
      if (value.kind === "dimension" && (!item.width || !item.height || !item.unit))
        ctx.addIssue({
          code: "custom",
          path: ["options", i],
          message: "Dimensions need width, height and a unit",
        });
    });
  });
export const configurationSchema = z
  .object({
    format: z.enum(["album", "book", "print", "gift"]),
    personalizationEnabled: z.boolean(),
    allowPhotoUpload: z.boolean(),
    allowText: z.boolean(),
    instructions: z.string().trim().max(2000),
    productionDays: z.number().int().min(1).max(365).nullable(),
    groups: z.array(group).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.groups.map((item) => item.id)).size !== value.groups.length)
      ctx.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Group IDs must be unique",
      });
    if (!value.personalizationEnabled && (value.allowPhotoUpload || value.allowText))
      ctx.addIssue({
        code: "custom",
        path: ["personalizationEnabled"],
        message: "Enable personalisation to offer photos or text",
      });
  });
export const catalogueFieldsSchema = z.object({
  subcategoryId: z.string().cuid().optional(),
  configuration: configurationSchema.optional(),
});

export function parseCatalogueFields(data: unknown) {
  const parsed = catalogueFieldsSchema.parse(data);
  const result: {
    subcategoryId?: string;
    configuration?: import("../types/catalogue.js").ProductConfiguration;
  } = {};
  if (parsed.subcategoryId !== undefined) result.subcategoryId = parsed.subcategoryId;
  if (parsed.configuration !== undefined)
    result.configuration =
      parsed.configuration as import("../types/catalogue.js").ProductConfiguration;
  return result;
}
