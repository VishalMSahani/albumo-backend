import { wrapTemplate, type EmailTemplate } from "./base.js";

type VerificationEmailData = {
  user: { name: string };
  verificationCode?: string;
  verificationLink?: string;
  verifyUrl?: string;
  expiresIn?: string;
};

export function emailVerificationTemplate(
  data: VerificationEmailData,
): EmailTemplate {
  const name = data.user.name || "there";
  if (data.verificationCode) {
    const expiresIn = data.expiresIn || "10 minutes";
    const content = `
      <h1>Verify your email address</h1>
      <p>Hi ${name},</p>
      <p>Enter this one-time code on Albumo to verify your email address:</p>
      <p class="text-center" style="font-size: 34px; line-height: 1.2; letter-spacing: 0.28em; font-weight: 700; color: #203c2e; margin: 28px 0;">${data.verificationCode}</p>
      <div class="info-box">
        <p><strong>This code expires in ${expiresIn}.</strong></p>
        <p>Never share this code. Albumo support will never ask for it.</p>
      </div>
      <p>If you did not create this account, you can safely ignore this email.</p>
      <p>Best regards,<br>The Albumo Team</p>
    `;
    return {
      subject: `${data.verificationCode} is your Albumo verification code`,
      html: wrapTemplate(content),
      text: `Your Albumo email verification code is ${data.verificationCode}. It expires in ${expiresIn}. Never share this code.`,
    };
  }

  // Render already-queued links during the short migration window; new requests never use this branch.
  const legacyLink = data.verificationLink || data.verifyUrl;
  if (!legacyLink) throw new Error("Email verification code is required");
  return {
    subject: "Verify your Albumo email address",
    html: wrapTemplate(
      `<h1>Verify your email address</h1><p>Hi ${name},</p><p class="text-center"><a href="${legacyLink}" class="button">Verify email address</a></p><p>This link expires in ${data.expiresIn || "24 hours"}.</p>`,
    ),
    text: `Verify your Albumo email address: ${legacyLink}`,
  };
}
