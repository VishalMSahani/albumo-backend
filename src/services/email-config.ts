export function emailConfig() {
  const from = process.env.EMAIL_FROM?.trim() || "noreply@mail.albumo.in";
  // Empty means no Reply-To header for automated transactional messages.
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || "";
  return {
    from,
    name: process.env.EMAIL_FROM_NAME?.trim() || "Albumo",
    accountFrom:
      process.env.ACCOUNT_EMAIL_FROM?.trim() || "account@mail.albumo.in",
    accountReplyTo:
      process.env.ACCOUNT_EMAIL_REPLY_TO?.trim() || "support@albumo.in",
    marketingFrom:
      process.env.MARKETING_EMAIL_FROM?.trim() || "update@alert.albumo.in",
    marketingReplyTo:
      process.env.MARKETING_EMAIL_REPLY_TO?.trim() || "hello@albumo.in",
    replyTo,
    admin: process.env.ADMIN_ALERT_EMAIL?.trim() || "vishal.sahani@albumo.in",
    support: process.env.SUPPORT_EMAIL?.trim() || "support@albumo.in",
    siteUrl: (
      process.env.EMAIL_SITE_URL ||
      process.env.FRONTEND_URL ||
      "https://albumo.in"
    ).replace(/\/$/, ""),
    adminUrl: (
      process.env.EMAIL_ADMIN_URL ||
      process.env.ADMIN_FRONTEND_URL ||
      "https://admin.albumo.in"
    ).replace(/\/$/, ""),
    apiUrl: (process.env.EMAIL_API_URL || "https://api.albumo.in").replace(
      /\/$/,
      "",
    ),
    inboundDomain:
      process.env.EMAIL_INBOUND_DOMAIN?.trim().toLowerCase() ||
      "inbox.albumo.in",
    inboundEnabled: process.env.EMAIL_INBOUND_ENABLED === "true",
    marketingEnabled: process.env.EMAIL_MARKETING_ENABLED === "true",
    signingSecret: process.env.EMAIL_SIGNING_SECRET || "",
  };
}

/** Snapshot sender routing when queueing; retries reuse the same provider payload. */
export function emailIdentity(eventType: string, channel = "TRANSACTIONAL") {
  const config = emailConfig();
  const resolvedChannel =
    channel === "TRANSACTIONAL" && eventType === "USER_SIGNUP"
      ? "ACCOUNT"
      : channel;
  const from =
    resolvedChannel === "MARKETING"
      ? config.marketingFrom
      : resolvedChannel === "ACCOUNT"
        ? config.accountFrom
        : config.from;
  const replyTo =
    resolvedChannel === "MARKETING"
      ? config.marketingReplyTo
      : resolvedChannel === "ACCOUNT"
        ? config.accountReplyTo
        : config.replyTo;
  return {
    channel: resolvedChannel,
    fromAddress: `${config.name} <${from}>`,
    replyTo,
  };
}
export function escapeEmail(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export function plainEmailHtml(text: string) {
  return text
    .split(/\n\n+/)
    .map(
      (paragraph) =>
        "<p>" + escapeEmail(paragraph).replace(/\n/g, "<br>") + "</p>",
    )
    .join("");
}
