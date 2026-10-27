import { z } from "zod";
import { selectionSchema } from "../selection.schema.js";

export const studioOccasion = z.enum([
  "EVERYDAY",
  "FAMILY",
  "TRAVEL",
  "CELEBRATION",
  "OTHER",
]);
const title = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Title cannot contain control characters",
  );
export const studioProjectParams = z.object({ id: z.uuid() }).strict();
export const createStudioProjectSchema = z
  .object({
    title,
    occasion: studioOccasion,
    requestId: z.uuid(),
    selection: selectionSchema.optional(),
  })
  .strict();
export const updateStudioProjectSchema = z
  .object({
    baseRevision: z.number().int().min(1).max(2147483646),
    title: title.optional(),
    occasion: studioOccasion.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.occasion !== undefined ||
      value.archived !== undefined,
    "Provide a change",
  );
export const listStudioProjectsSchema = z
  .object({
    archived: z.enum(["true", "false"]).default("false"),
    trash: z.enum(["true", "false"]).default("false"),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type CreateStudioProject = z.infer<typeof createStudioProjectSchema>;
export type UpdateStudioProject = z.infer<typeof updateStudioProjectSchema>;
export type ListStudioProjects = z.infer<typeof listStudioProjectsSchema>;

export const lifecycleSchema = z
  .object({
    baseRevision: z.number().int().min(1),
    action: z.enum(["trash", "restore", "delete"]),
  })
  .strict();

export const configureProjectSchema = z
  .object({ baseRevision: z.number().int().min(1), selection: selectionSchema })
  .strict();
export const copyProjectSchema = z
  .object({
    requestId: z.uuid(),
    baseRevision: z.number().int().min(1),
    mode: z.enum(["duplicate", "reorder"]),
  })
  .strict();
