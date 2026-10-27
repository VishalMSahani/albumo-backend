import { z } from "zod";
import { catalogueImageSchema } from "../features/components/validators/catalogue-images.js";
import { escapeEmail, plainEmailHtml } from "./email-config.js";
import { wrapTemplate } from "../utils/emailTemplates/base.js";

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use a complete HTTPS link");

export const campaignDesignSchema = z
  .object({
    template: z.enum(["STORY", "COLLECTION", "OFFER"]).default("STORY"),
    preheader: z.string().trim().max(160).default(""),
    eyebrow: z.string().trim().max(60).default(""),
    heading: z.string().trim().max(160).default(""),
    imageUrl: z.union([z.literal(""), catalogueImageSchema]).default(""),
    imageAlt: z.string().trim().max(180).default(""),
    buttonLabel: z.string().trim().max(60).default(""),
    buttonUrl: httpsUrl.default(""),
    accent: z.enum(["BERRY", "ROSE", "CHARCOAL"]).default("BERRY"),
    alignment: z.enum(["left", "center"]).default("left"),
    offerCode: z.string().trim().max(40).default(""),
  })
  .strict()
  .superRefine((design, context) => {
    if (Boolean(design.buttonLabel) !== Boolean(design.buttonUrl)) {
      context.addIssue({
        code: "custom",
        path: ["buttonUrl"],
        message: "Provide both the button label and link, or leave both empty",
      });
    }
    if (design.imageUrl && !design.imageAlt) {
      context.addIssue({
        code: "custom",
        path: ["imageAlt"],
        message: "Describe the image for readers who cannot see it",
      });
    }
  });
export type CampaignDesign = z.infer<typeof campaignDesignSchema>;
export const campaignSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    subject: z
      .string()
      .trim()
      .min(3)
      .max(160)
      .refine((value) => !/[\r\n]/.test(value)),
    body: z.string().trim().min(10).max(20000),
    design: campaignDesignSchema.default(() => campaignDesignSchema.parse({})),
  })
  .strict();

/** Shared by previews, admin tests and subscriber delivery. */
export function renderCampaign(
  subject: string,
  body: string,
  designInput: unknown = {},
  unsubscribeUrl?: string,
) {
  const design = campaignDesignSchema.parse(designInput ?? {});
  const accent = { BERRY: "#a73056", ROSE: "#a22d66", CHARCOAL: "#3a2e2a" }[
    design.accent
  ];
  const heading = design.heading || subject;
  const image = design.imageUrl
    ? `<img src="${escapeEmail(design.imageUrl)}" alt="${escapeEmail(design.imageAlt)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px;margin:24px 0">`
    : "";
  const offer =
    design.template === "OFFER" && design.offerCode
      ? `<div style="padding:24px;background:#f6f1ec;text-align:center;margin:24px 0;border:1px dashed ${accent}"><p style="margin:0 0 8px">Your offer code</p><strong style="font-size:24px;letter-spacing:2px;color:${accent}">${escapeEmail(design.offerCode)}</strong></div>`
      : "";
  const button = design.buttonUrl
    ? `<table role="presentation" style="margin:24px ${design.alignment === "center" ? "auto" : "0"};border-collapse:collapse"><tr><td bgcolor="${accent}" style="border-radius:6px"><a href="${escapeEmail(design.buttonUrl)}" style="display:inline-block;padding:14px 24px;color:#fff;font-weight:bold;text-decoration:none">${escapeEmail(design.buttonLabel)}</a></td></tr></table>`
    : "";
  const footer = unsubscribeUrl
    ? `<p style="font-size:13px">You subscribed to Albumo updates. <a href="${escapeEmail(unsubscribeUrl)}">Unsubscribe</a> at any time.</p>`
    : '<p style="font-size:13px">Preview only. Each subscriber receives a personal unsubscribe link.</p>';
  const content = `<div style="text-align:${design.alignment}">
    ${design.eyebrow ? `<p style="color:${accent};font-size:13px;letter-spacing:2px;font-weight:bold">${escapeEmail(design.eyebrow)}</p>` : ""}
    ${design.template === "COLLECTION" ? image : ""}
    <h1 style="font-size:30px;line-height:1.25;margin:16px 0;color:#3a2e2a">${escapeEmail(heading)}</h1>
    ${design.template === "STORY" ? image : ""}
    ${plainEmailHtml(body)}${offer}
    ${design.template === "OFFER" ? image : ""}${button}
    </div><hr style="border:0;border-top:1px solid #eee">${footer}`;
  return {
    html: wrapTemplate(content, design.preheader),
    text: [
      design.preheader,
      design.eyebrow,
      heading,
      body,
      design.template === "OFFER" && design.offerCode
        ? "Offer code: " + design.offerCode
        : "",
      design.buttonUrl ? design.buttonLabel + ": " + design.buttonUrl : "",
      unsubscribeUrl
        ? "You subscribed to Albumo updates. Unsubscribe: " + unsubscribeUrl
        : "Preview only. Each subscriber receives a personal unsubscribe link.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
