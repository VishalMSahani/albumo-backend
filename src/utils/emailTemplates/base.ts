import { emailConfig, escapeEmail } from "../../services/email-config.js";
export interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}
/** Email clients require inline styles; the website/admin continue to use Tailwind. */
export function wrapTemplate(content: string, preheader = ""): string {
  const config = emailConfig();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Albumo</title></head>
<body style="margin:0;background:#f6f1ec;color:#3a2e2a;font-family:Arial,sans-serif">
${preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeEmail(preheader)}</div>` : ""}
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:32px 16px">
<div style="max-width:600px;margin:auto;background:#fff;border-radius:16px;overflow:hidden">
<div style="padding:28px 32px;border-bottom:1px solid #eee"><a href="${escapeEmail(config.siteUrl)}" style="font-size:28px;font-weight:bold;color:#c63f65;text-decoration:none">Albumo</a><p style="margin:8px 0 0;font-size:14px;color:#74675f">Your stories, beautifully kept.</p></div>
<div style="padding:32px;font-size:16px;line-height:1.7">${content}</div>
<div style="padding:24px 32px;background:#faf8f6;font-size:13px;line-height:1.7;color:#74675f">
<p>Albumo Studio Pvt Ltd</p><p>Need a hand? <a href="mailto:${escapeEmail(config.support)}" style="color:#c63f65">${escapeEmail(config.support)}</a></p><p>&copy; ${new Date().getFullYear()} Albumo</p>
</div></div></td></tr></table></body></html>`;
}
