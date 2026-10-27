import { createHmac, timingSafeEqual } from "node:crypto";
/** Svix v1: sign message-id.timestamp.raw-body with the base64 webhook secret. */
export function verifyResendWebhook(
  body: Buffer,
  headers: {
    id?: string | undefined;
    timestamp?: string | undefined;
    signature?: string | undefined;
  },
  secret: string,
  now = Date.now(),
) {
  if (
    !secret.startsWith("whsec_") ||
    !headers.id ||
    !headers.timestamp ||
    !headers.signature
  )
    throw new Error("Missing webhook signature");
  if (
    !/^\d+$/.test(headers.timestamp) ||
    Math.abs(now / 1000 - Number(headers.timestamp)) > 300
  )
    throw new Error("Expired webhook signature");
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(headers.id + "." + headers.timestamp + ".")
    .update(body)
    .digest();
  const valid = headers.signature.split(" ").some((value) => {
    const [version, encoded] = value.split(",");
    if (version !== "v1" || !encoded) return false;
    const actual = Buffer.from(encoded, "base64");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  });
  if (!valid) throw new Error("Invalid webhook signature");
  return JSON.parse(body.toString("utf8")) as {
    type: string;
    created_at: string;
    data: Record<string, unknown>;
  };
}
