import { prisma } from "../src/lib/prisma.js";
import { contactSettingsSchema } from "../src/features/contact/contact.validator.js";

// Initialize a fresh installation without overwriting settings already chosen in admin.
const input = contactSettingsSchema.parse({
  email: process.argv[2] || process.env.SUPPORT_EMAIL || "",
  phone: "", whatsapp: "", hours: "", newsletterEnabled: true,
});
try {
  const setting = await prisma.contactSetting.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: {} });
  process.stdout.write(`Contact settings ready. Public inbox ${setting.email ? "configured" : "not configured"}. Existing settings preserved.\n`);
} finally { await prisma.$disconnect(); }
