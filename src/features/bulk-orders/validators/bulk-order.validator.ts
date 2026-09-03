import { z } from "zod";

export const createBulkOrderSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  companyName: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateBulkOrderInput = z.infer<typeof createBulkOrderSchema>;
