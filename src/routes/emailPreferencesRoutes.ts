import { Router } from "express";
import { applyEmailUnsubscribe } from "../services/email-marketing.service.js";
import { readNewsletterToken } from "../services/email-tokens.js";
import { escapeEmail } from "../services/email-config.js";
import { wrapTemplate } from "../utils/emailTemplates/base.js";
export const emailPreferencesRoutes: Router = Router();
emailPreferencesRoutes.get("/unsubscribe", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  try {
    readNewsletterToken(token);
    res
      .type("html")
      .send(
        wrapTemplate(
          '<h1>Leave Albumo updates?</h1><p>Order and support emails will continue when needed.</p><form method="post"><input type="hidden" name="token" value="' +
            escapeEmail(token) +
            '"><button type="submit">Unsubscribe</button></form>',
        ),
      );
  } catch {
    res
      .status(400)
      .type("html")
      .send(
        wrapTemplate(
          "<h1>This link is invalid</h1><p>Request a new unsubscribe link from the Albumo newsletter page.</p>",
        ),
      );
  }
});
emailPreferencesRoutes.post("/unsubscribe", async (req, res) => {
  const token =
    typeof req.query.token === "string"
      ? req.query.token
      : typeof req.body?.token === "string"
        ? req.body.token
        : "";
  res.setHeader("Cache-Control", "no-store");
  try {
    const changed = await applyEmailUnsubscribe(token);
    if (!changed) {
      res
        .status(400)
        .send("This preference link no longer matches your subscription.");
      return;
    }
    if (req.body?.["List-Unsubscribe"] === "One-Click") {
      res.status(200).end();
      return;
    }
    res
      .type("html")
      .send(
        wrapTemplate(
          "<h1>You're unsubscribed</h1><p>You will no longer receive Albumo marketing emails.</p>",
        ),
      );
  } catch {
    res.status(400).send("Invalid preference link");
  }
});
