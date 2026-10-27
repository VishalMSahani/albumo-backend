import nodemailer, { type Transporter } from "nodemailer";
import type { EmailTemplate } from "../utils/email-templates.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = "noreply@mail.albumo.in";

export type EmailAttachment = {
  filename: string;
  content: string | Buffer;
  contentType?: string;
};

export type EmailSendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  previewUrl?: string;
};

export type EmailSendOptions = {
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
};

let transporter: Transporter | null = null;
let transporterKey = "";

function sender(): string {
  const address =
    process.env.EMAIL_FROM?.trim() ||
    process.env.FROM_EMAIL?.trim() ||
    (process.env.RESEND_API_KEY?.trim()
      ? DEFAULT_FROM_EMAIL
      : process.env.SMTP_USER?.trim()) ||
    DEFAULT_FROM_EMAIL;
  const name =
    process.env.EMAIL_FROM_NAME?.trim() ||
    process.env.FROM_NAME?.trim() ||
    "Albumo";
  return `${name} <${address}>`;
}

export function emailDeliveryConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() ||
    (process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()),
  );
}

async function sendWithResend(
  apiKey: string,
  to: string,
  subject: string,
  html: string,
  text: string,
  attachments?: EmailAttachment[],
  options: EmailSendOptions = {},
): Promise<EmailSendResult> {
  const replyTo = (options.replyTo ?? process.env.EMAIL_REPLY_TO ?? "").trim();
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      from: options.from || sender(),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      to: [to],
      subject,
      html,
      text,
      ...(attachments?.length
        ? {
            attachments: attachments.map((attachment) => ({
              filename: attachment.filename,
              content: Buffer.isBuffer(attachment.content)
                ? attachment.content.toString("base64")
                : Buffer.from(attachment.content).toString("base64"),
              ...(attachment.contentType
                ? { content_type: attachment.contentType }
                : {}),
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const body = (await response.json().catch(() => null)) as {
    id?: string;
    message?: string;
    name?: string;
  } | null;
  if (!response.ok || !body?.id) {
    throw new Error(
      `Resend delivery failed (${response.status}): ${body?.message || body?.name || "Unknown provider error"}`,
    );
  }
  return { success: true, messageId: body.id };
}

async function getTransporter(): Promise<Transporter> {
  const host = process.env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const port = Number.parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";
  if (!user || !pass) {
    throw new Error(
      "Email is not configured. Set RESEND_API_KEY or SMTP_USER and SMTP_PASS.",
    );
  }

  const key = `${host}:${port}:${secure}:${user}`;
  if (transporter && transporterKey === key) return transporter;

  const next = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  await next.verify();
  transporter = next;
  transporterKey = key;
  return next;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  attachments?: EmailAttachment[],
  options: EmailSendOptions = {},
): Promise<EmailSendResult> {
  try {
    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    if (resendApiKey) {
      return await sendWithResend(
        resendApiKey,
        to,
        subject,
        html,
        text,
        attachments,
        options,
      );
    }

    const smtp = await getTransporter();
    const replyTo = (
      options.replyTo ??
      process.env.EMAIL_REPLY_TO ??
      ""
    ).trim();
    const info = await smtp.sendMail({
      from: options.from || sender(),
      ...(replyTo ? { replyTo } : {}),
      headers: options.headers,
      to,
      subject,
      text,
      html,
      attachments,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email delivery error";
    console.error("Email delivery failed:", message);
    return { success: false, error: message };
  }
}

export async function sendTemplateEmail(
  to: string,
  template: EmailTemplate,
): Promise<EmailSendResult> {
  return sendEmail(to, template.subject, template.html, template.text || "");
}

export async function sendBulkEmails(
  emails: Array<{ to: string; template: EmailTemplate }>,
  delayMs = 100,
): Promise<Array<{ to: string } & EmailSendResult>> {
  const results: Array<{ to: string } & EmailSendResult> = [];
  for (const email of emails) {
    results.push({
      to: email.to,
      ...(await sendTemplateEmail(email.to, email.template)),
    });
    if (delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return results;
}

export async function testEmailConfiguration(): Promise<{
  success: boolean;
  message: string;
}> {
  if (process.env.RESEND_API_KEY?.trim()) {
    return { success: true, message: "Resend email delivery is configured" };
  }
  try {
    await getTransporter();
    return { success: true, message: "SMTP email delivery is configured" };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unknown email configuration error",
    };
  }
}
