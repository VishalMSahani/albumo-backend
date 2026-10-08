import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(254);
const optionalText = (max: number) => z.string().trim().max(max).default("");
export const enquirySchema = z.object({
  name: z.string().trim().min(2).max(100), email,
  intent: z.enum(["GENERAL", "CUSTOM_PROJECT"]),
  subject: z.string().trim().min(5).max(130),
  message: z.string().trim().min(20).max(4000),
  phone: optionalText(30), organization: optionalText(120),
  projectType: optionalText(80), budget: optionalText(100), timeline: optionalText(100),
  consent: z.literal(true), website: z.string().max(0).default(""),
});
export const contactSettingsSchema = z.object({
  email: z.union([email, z.literal("")]),
  phone: z.string().trim().max(30).regex(/^[+\d ()-]*$/),
  whatsapp: z.string().trim().regex(/^(?:[1-9]\d{7,14})?$/, "Use country code and digits only"),
  hours: z.string().trim().max(200), newsletterEnabled: z.boolean(),
});
export const subscribeSchema = z.object({
  email, consent: z.literal(true), source: z.enum(["FOOTER", "NEWSLETTER"]).default("NEWSLETTER"),
  website: z.string().max(0).default(""),
});
export const manageSchema = z.object({ email, website: z.string().max(0).default("") });
export const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
export const subscriberQuerySchema = z.object({
  search: z.string().trim().max(100).default(""),
  status: z.enum(["PENDING", "ACTIVE", "UNSUBSCRIBED"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export const idSchema = z.object({ id: z.string().min(1).max(100) });
export const emptySchema = z.object({});
export type EnquiryInput = z.infer<typeof enquirySchema>;
