import nodemailer, { type Transporter } from "nodemailer";
import type { EmailTemplate } from "../utils/email-templates.js";

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;
const FROM_NAME = process.env.FROM_NAME || "RoboRoot";
const IS_DEV = process.env.NODE_ENV !== "production";

let transporter: Transporter | null = null;
let transporterVerified = false;

async function buildTransporter(): Promise<Transporter> {
  // If we have SMTP credentials, try them first
  if (SMTP_USER && SMTP_PASS) {
    const t = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    try {
      await t.verify();
      transporterVerified = true;
      console.log("✅ SMTP transporter ready");
      return t;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (IS_DEV) {
        console.warn(`⚠️  SMTP credentials invalid (${msg.split("\n")[0]})`);
        console.warn("📧 Falling back to Ethereal test account for development");
      } else {
        // In production, fail hard so the operator knows immediately
        throw new Error(`SMTP configuration error: ${msg}`);
      }
    }
  }

  // Dev fallback: Ethereal
  if (IS_DEV) {
    const testAccount = await nodemailer.createTestAccount();
    const t = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    transporterVerified = true;
    console.log("📧 Ethereal test account ready — preview emails at https://ethereal.email");
    console.log(`   User: ${testAccount.user}  Pass: ${testAccount.pass}`);
    return t;
  }

  throw new Error("Email not configured. Set SMTP_USER and SMTP_PASS in .env");
}

async function getTransporter(): Promise<Transporter> {
  if (!transporter || !transporterVerified) {
    transporter = await buildTransporter();
  }
  return transporter;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  attachments?: Array<{ filename: string; content: any; contentType?: string }>
): Promise<{ success: boolean; messageId?: string; error?: string; previewUrl?: string }> {
  try {
    const t = await getTransporter();

    const info = await t.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      text,
      html,
      attachments,
    });

    console.log(`✅ Email sent: ${info.messageId}`);

    const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
    if (previewUrl) console.log(`📧 Preview: ${previewUrl}`);

    const successResult: { success: boolean; messageId?: string; error?: string; previewUrl?: string } = { success: true, messageId: info.messageId };
    if (previewUrl) successResult.previewUrl = previewUrl;
    return successResult;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Email send failed:", msg);
    return { success: false, error: msg };
  }
}

export async function sendTemplateEmail(
  to: string,
  template: EmailTemplate
): Promise<{ success: boolean; messageId?: string; error?: string; previewUrl?: string }> {
  return sendEmail(to, template.subject, template.html, template.text || "");
}

export async function sendBulkEmails(
  emails: Array<{ to: string; template: EmailTemplate }>,
  delayMs = 100
): Promise<Array<{ to: string; success: boolean; messageId?: string; error?: string }>> {
  const results: Array<{ to: string; success: boolean; messageId?: string; error?: string }> = [];

  for (const email of emails) {
    const result = await sendTemplateEmail(email.to, email.template);
    results.push({ to: email.to, ...result });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  return results;
}

export async function testEmailConfiguration(): Promise<{ success: boolean; message: string }> {
  try {
    await getTransporter();
    return { success: true, message: "Email configuration is valid" };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Unknown error" };
  }
}
