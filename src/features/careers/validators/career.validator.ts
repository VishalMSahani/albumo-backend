import { z } from "zod";

export const createCareerApplicationSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  portfolioUrl: z.string().url("Invalid portfolio or LinkedIn/GitHub URL"),
  coverLetter: z.string().min(10, "Cover letter must be at least 10 characters"),
});

export type CreateCareerApplicationInput = z.infer<typeof createCareerApplicationSchema>;

export const updateCareerApplicationSchema = z.object({
  status: z.enum(["APPLIED", "UNDER_REVIEW", "SHORTLISTED", "REJECTED", "HIRED"]).optional(),
  adminNotes: z.string().optional(),
});

export type UpdateCareerApplicationInput = z.infer<typeof updateCareerApplicationSchema>;
