import { z } from "zod";

const partnerTypes = [
  "TRAVEL_AGENCY",
  "PHOTOGRAPHER",
  "WEDDING_PLANNER",
  "CORPORATE_EVENTS",
  "REAL_ESTATE",
  "OTHER",
] as const;
const inquiryStatuses = [
  "NEW",
  "CONTACTED",
  "IN_DISCUSSION",
  "ONBOARDED",
  "DECLINED",
] as const;
const website = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    // Blank websites are allowed in enquiries and drafts. Publication requires one.
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use a public http:// or https:// website address");

export const createPartnerInquirySchema = z.object({
  partnerType: z.enum(partnerTypes),
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z.string().trim().email("Enter a valid email address").max(254),
  phone: z
    .string()
    .trim()
    .min(6, "Enter a valid phone number")
    .max(30)
    .regex(/^[+\d\s().-]+$/, "Enter a valid phone number"),
  companyName: z.string().trim().min(2, "Enter your business name").max(150),
  website: website.optional(),
  city: z.string().trim().min(2, "Enter your city").max(100),
  message: z
    .string()
    .trim()
    .min(10, "Please provide at least 10 characters")
    .max(3000),
  expectedVolume: z.string().trim().max(100).optional(),
  contactConsent: z.literal(true, {
    error: "Please agree to be contacted about your enquiry",
  }),
  directoryConsent: z.boolean().default(false),
  companyFax: z.string().max(0, "Unable to submit this enquiry").optional(),
});

export const updatePartnerInquirySchema = z
  .object({
    status: z.enum(inquiryStatuses).optional(),
    adminNotes: z.string().trim().max(5000).nullable().optional(),
    publicName: z.string().trim().max(150).nullable().optional(),
    publicDescription: z.string().trim().max(500).nullable().optional(),
    publicCity: z.string().trim().max(100).nullable().optional(),
    publicWebsite: website.nullable().optional(),
    isPublished: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    "Provide an enquiry or profile update",
  );

export const partnerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  partnerType: z.enum(partnerTypes).optional(),
  status: z.enum(inquiryStatuses).optional(),
  search: z.string().trim().max(160).optional(),
});

export const partnerDirectoryQuerySchema = partnerQuerySchema.pick({
  page: true,
  partnerType: true,
  search: true,
});

export type CreatePartnerInquiryInput = z.infer<
  typeof createPartnerInquirySchema
>;
export type UpdatePartnerInquiryInput = z.infer<
  typeof updatePartnerInquirySchema
>;
export type PartnerQueryInput = z.infer<typeof partnerQuerySchema>;
export type PartnerDirectoryQueryInput = z.infer<
  typeof partnerDirectoryQuerySchema
>;
