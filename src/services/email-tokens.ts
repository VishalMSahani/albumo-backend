import { createHmac, timingSafeEqual } from "node:crypto";
import { emailConfig } from "./email-config.js";
function signature(value: string) {
  const secret = emailConfig().signingSecret;
  if (secret.length < 32)
    throw new Error(
      "Set EMAIL_SIGNING_SECRET to at least 32 random characters",
    );
  return createHmac("sha256", secret).update(value).digest("hex");
}
function same(left: string, right: string) {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function newsletterToken(subscriber: {
  id: string;
  email: string;
  consentAt: Date;
}) {
  const payload = Buffer.from(
    JSON.stringify({
      id: subscriber.id,
      consent: subscriber.consentAt.toISOString(),
    }),
  ).toString("base64url");
  return payload + "." + signature("newsletter:" + payload);
}
export function readNewsletterToken(token: string) {
  if (token.length > 2000) throw new Error("Invalid preference link");
  const [payload, mac, ...extra] = token.split(".");
  if (
    !payload ||
    !mac ||
    extra.length ||
    !same(signature("newsletter:" + payload), mac)
  )
    throw new Error("Invalid preference link");
  const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    id: string;
    consent: string;
  };
  if (
    typeof value.id !== "string" ||
    !Number.isFinite(Date.parse(value.consent))
  )
    throw new Error("Invalid preference link");
  return value;
}
export function supportReplyAddress(ticketId: string) {
  const config = emailConfig();
  return config.inboundEnabled
    ? "reply+" +
        ticketId +
        "." +
        signature("ticket:" + ticketId).slice(0, 24) +
        "@" +
        config.inboundDomain
    : config.support;
}
export function ticketFromReplyAddress(address: string) {
  const config = emailConfig();
  const match = address
    .toLowerCase()
    .match(/^reply\+([a-z0-9]+)\.([a-f0-9]{24})@(.+)$/);
  if (!match || match[3] !== config.inboundDomain) return null;
  return same(signature("ticket:" + match[1]).slice(0, 24), match[2]!)
    ? match[1]!
    : null;
}
