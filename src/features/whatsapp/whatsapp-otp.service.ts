import { AuthError } from "../../utils/types.js";
import { authSecret } from "../../utils/auth-security.js";
import { logger } from "../../lib/logger.js";

function configuration() {
  const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneId,
    WHATSAPP_AUTH_TEMPLATE_NAME: template, WHATSAPP_API_VERSION: version } = process.env;
  if (process.env.WHATSAPP_OTP_ENABLED !== "true" || !token || !/^\d+$/.test(phoneId ?? "") ||
      !/^[a-z0-9_]+$/.test(template ?? "") || !/^v\d+\.\d+$/.test(version ?? "")) return null;
  try { authSecret("AUTH_OTP_SECRET"); } catch { return null; }
  return { token, phoneId, template, version, language: process.env.WHATSAPP_AUTH_TEMPLATE_LANGUAGE || "en_US" };
}

export const whatsappOtpAvailable = () => Boolean(configuration());

export async function sendWhatsAppOtp(phone: string, code: string): Promise<void> {
  const config = configuration();
  if (!config) throw new AuthError("WhatsApp sign-in is not available yet. Please use your password.", 503, "OTP_UNAVAILABLE");
  try {
    const response = await fetch(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        messaging_product: "whatsapp", to: phone.replace("+", ""), type: "template",
        template: { name: config.template, language: { code: config.language },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
          ],
        },
      }),
    });
    const data = await response.json() as { messages?: { id?: string }[]; error?: { code?: number } };
    if (!response.ok || !data.messages?.[0]?.id) {
      logger.warn("WhatsApp OTP request rejected", { status: response.status, providerCode: data.error?.code });
      throw new Error("Provider rejected request");
    }
  } catch {
    // No raw provider body, token, code or recipient is logged or returned.
    throw new AuthError("We could not send your WhatsApp code. Please try again shortly or use your password.", 503, "OTP_DELIVERY_FAILED");
  }
}
