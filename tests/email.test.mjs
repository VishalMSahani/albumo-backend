import { test, after } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  NODE_ENV: "test",
  RESEND_API_KEY: "re_test_never_real",
  EMAIL_FROM: "noreply@mail.albumo.in",
  EMAIL_REPLY_TO: "",
  EMAIL_FROM_NAME: "Albumo",
});

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://api.resend.com/emails");
  requests.push({
    headers: options.headers,
    payload: JSON.parse(options.body),
  });
  return new Response(JSON.stringify({ id: "resend-test-message" }), {
    status: 200,
  });
};

const { sendEmail, emailDeliveryConfigured } =
  await import("../dist/services/email.service.js");
const { getEmailTemplate } = await import("../dist/utils/email-templates.js");

after(() => {
  globalThis.fetch = originalFetch;
});

test("Resend delivery uses the configured Albumo sender and keeps the credential out of content", async () => {
  assert.equal(emailDeliveryConfigured(), true);
  const result = await sendEmail(
    "shopper@example.invalid",
    "Verify",
    "<p>Verify</p>",
    "Verify",
  );
  assert.equal(result.messageId, "resend-test-message");
  const request = requests.at(-1);
  assert.equal(request.payload.from, "Albumo <noreply@mail.albumo.in>");
  assert.equal(Object.hasOwn(request.payload, "reply_to"), false);
  assert.deepEqual(request.payload.to, ["shopper@example.invalid"]);
  assert.equal(request.headers.Authorization, "Bearer re_test_never_real");
  assert.equal(
    JSON.stringify(request.payload).includes("re_test_never_real"),
    false,
  );
});

test("an explicit empty Reply-To suppresses the environment fallback", async () => {
  process.env.EMAIL_REPLY_TO = "support@albumo.in";
  try {
    await sendEmail(
      "reader@example.com",
      "Order",
      "<p>Order</p>",
      "Order",
      undefined,
      { replyTo: "" },
    );
    assert.equal(Object.hasOwn(requests.at(-1).payload, "reply_to"), false);
  } finally {
    process.env.EMAIL_REPLY_TO = "";
  }
});

test("verification template renders a six-digit code without a verification link", () => {
  const template = getEmailTemplate("USER_EMAIL_VERIFICATION", {
    user: { name: "shopper@example.invalid" },
    verificationCode: "482913",
    expiresIn: "10 minutes",
  });
  assert(template.html.includes("482913"));
  assert(template.text.includes("482913"));
  assert(template.text.includes("10 minutes"));
  assert.equal(template.html.includes("/verify-email?token="), false);
});

test("Resend transport passes stable idempotency, reply routing and unsubscribe headers", async () => {
  await sendEmail(
    "reader@example.com",
    "October stories",
    "<p>Albumo</p>",
    "Albumo",
    undefined,
    {
      from: "Albumo <update@alert.albumo.in>",
      replyTo: "hello@albumo.in",
      idempotencyKey: "albumo-email/fixture",
      headers: {
        "List-Unsubscribe": "<https://api.albumo.in/preferences>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
  );
  const request = requests.at(-1);
  assert.equal(request.headers["Idempotency-Key"], "albumo-email/fixture");
  assert.equal(request.payload.reply_to, "hello@albumo.in");
  assert.equal(request.payload.from, "Albumo <update@alert.albumo.in>");
  assert.equal(
    request.payload.headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click",
  );
});

test("Albumo order email escapes customer content and rejects unsafe tracking links", () => {
  const template = getEmailTemplate("ORDER_SHIPPED", {
    user: { name: "<script>bad</script>" },
    order: {
      orderId: "AL-1",
      total: 999,
      trackingUrl: "javascript:alert(1)",
      items: [{ name: "<img src=x onerror=bad>", quantity: 1, price: 999 }],
    },
  });
  assert(!template.html.includes("<script>"));
  assert(!template.html.includes("<img src=x"));
  assert(!template.html.includes("javascript:"));
  assert(template.text.includes("INR 999.00"));
  assert(template.subject.includes("Albumo"));
});
