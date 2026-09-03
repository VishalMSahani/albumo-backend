import { z } from "zod";

export const reindexCatalogItemSchema = z.object({
  sourceType: z.enum(["component", "project"]),
  sourceId: z.string().min(1),
  action: z.enum(["upsert", "delete"]).default("upsert"),
});
