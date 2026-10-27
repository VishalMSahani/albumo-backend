/**
 * Email Templates Index
 * Centralized export for all email templates
 */

export { wrapTemplate, type EmailTemplate } from "./base.js";
export { userSignupTemplate } from "./userSignup.js";
export { emailVerificationTemplate } from "./emailVerification.js";
export { passwordResetTemplate } from "./passwordReset.js";
export { orderCreatedTemplate } from "./orderCreated.js";
export { orderPaidTemplate } from "./orderPaid.js";
export { orderShippedTemplate } from "./orderShipped.js";
export { mentorSessionBookedTemplate } from "./mentorSessionBooked.js";
export { aiProjectGeneratedTemplate } from "./aiProjectGenerated.js";
export { cartAbandonedTemplate } from "./cartAbandoned.js";
export { supportTicketTemplate } from "./supportTicket.js";

import { albumoOrderTemplate, albumoMessage } from "./albumo.js";
import { EmailEventType } from "../../generated/prisma/client.js";
import { bulkOrderTemplate } from "./bulkOrder.js";
import type { EmailTemplate } from "./base.js";
import { emailVerificationTemplate } from "./emailVerification.js";
import { passwordResetTemplate } from "./passwordReset.js";
import { mentorSessionBookedTemplate } from "./mentorSessionBooked.js";
import { aiProjectGeneratedTemplate } from "./aiProjectGenerated.js";
import { cartAbandonedTemplate } from "./cartAbandoned.js";
import { supportTicketTemplate } from "./supportTicket.js";

/**
 * Type for email template data
 */
export type EmailTemplateData = any;

/**
 * Get the appropriate email template based on event type
 */
export function getEmailTemplate(
  eventType: EmailEventType,
  data: EmailTemplateData,
): EmailTemplate {
  if (
    [
      "ORDER_CREATED",
      "ORDER_PAID",
      "ORDER_SHIPPED",
      "ORDER_DELIVERED",
      "ORDER_CANCELLED",
      "PAYMENT_FAILED",
    ].includes(eventType)
  )
    return albumoOrderTemplate(eventType, data);
  if (
    [
      "ADMIN_NOTIFICATION",
      "CUSTOM_EMAIL",
      "NEWSLETTER_WELCOME",
      "MARKETING_CAMPAIGN",
    ].includes(eventType)
  )
    return albumoMessage(
      data.subject || "A note from Albumo",
      data.message || "",
    );
  switch (eventType) {
    case EmailEventType.BULK_ORDER_UPDATED:
      return bulkOrderTemplate(data);
    case EmailEventType.USER_SIGNUP:
      return albumoMessage(
        "Welcome to Albumo",
        "Hi " +
          (data.user?.name || "there") +
          ",\n\nYour Albumo account is ready. Keep your favourite moments in photo books, wall art and thoughtful gifts.",
      );

    case EmailEventType.USER_EMAIL_VERIFICATION:
      return emailVerificationTemplate(data);

    case EmailEventType.PASSWORD_RESET:
      return passwordResetTemplate(data);

    case EmailEventType.MENTOR_SESSION_BOOKED:
      return mentorSessionBookedTemplate(data);

    case EmailEventType.MENTOR_SESSION_REMINDER:
      return {
        subject: `Reminder: Mentor Session Tomorrow with ${data.session?.mentorName}`,
        html: `<h1>Session Reminder</h1><p>Your mentor session is tomorrow at ${data.session?.time}.</p>`,
        text: `Session Reminder: Your mentor session is tomorrow at ${data.session?.time}.`,
      };

    case EmailEventType.AI_PROJECT_GENERATED:
      return aiProjectGeneratedTemplate(data);

    case EmailEventType.PROJECT_APPROVED:
      return {
        subject: `Your Project "${data.project?.title}" Has Been Approved!`,
        html: `<h1>Project Approved!</h1><p>Your project has been approved and is now live.</p>`,
        text: "Project Approved! Your project has been approved and is now live.",
      };

    case EmailEventType.LOW_STOCK_ALERT:
      return {
        subject: `${data.component?.name} is Running Low!`,
        html: albumoMessage(
          "Low stock",
          String(data.component?.name || "A product") +
            " needs an inventory review.",
        ).html,
        text: `${data.component?.name} needs an inventory review.`,
      };

    case EmailEventType.CART_ABANDONED:
      return cartAbandonedTemplate(data);

    case EmailEventType.SUPPORT_TICKET_CREATED:
      return supportTicketTemplate(data, "CREATED");

    case EmailEventType.SUPPORT_TICKET_UPDATED:
      return supportTicketTemplate(data, "UPDATED");

    case EmailEventType.SUPPORT_TICKET_REPLY:
      return supportTicketTemplate(data, "REPLY");

    default:
      return {
        subject: "Albumo Notification",
        html: "<p>You have a new notification from Albumo.</p>",
        text: "You have a new notification from Albumo.",
      };
  }
}
