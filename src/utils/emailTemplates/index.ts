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

import { EmailEventType } from "../../generated/prisma/client.js";
import type { EmailTemplate } from "./base.js";
import { userSignupTemplate } from "./userSignup.js";
import { emailVerificationTemplate } from "./emailVerification.js";
import { passwordResetTemplate } from "./passwordReset.js";
import { orderCreatedTemplate } from "./orderCreated.js";
import { orderPaidTemplate } from "./orderPaid.js";
import { orderShippedTemplate } from "./orderShipped.js";
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
  data: EmailTemplateData
): EmailTemplate {
  switch (eventType) {
    case EmailEventType.USER_SIGNUP:
      return userSignupTemplate(data);

    case EmailEventType.USER_EMAIL_VERIFICATION:
      return emailVerificationTemplate(data);

    case EmailEventType.PASSWORD_RESET:
      return passwordResetTemplate(data);

    case EmailEventType.ORDER_CREATED:
      return orderCreatedTemplate(data);

    case EmailEventType.ORDER_PAID:
      return orderPaidTemplate(data);

    case EmailEventType.ORDER_SHIPPED:
      return orderShippedTemplate(data);

    case EmailEventType.ORDER_DELIVERED:
      return {
        subject: `Your Order Has Been Delivered - ${data.order?.orderId}`,
        html: `<h1>Order Delivered!</h1><p>Your order has been successfully delivered.</p>`,
        text: "Order Delivered! Your order has been successfully delivered.",
      };

    case EmailEventType.ORDER_CANCELLED:
      return {
        subject: `Order Cancelled - ${data.order?.orderId}`,
        html: `<h1>Order Cancelled</h1><p>Your order has been cancelled as requested.</p>`,
        text: "Order Cancelled. Your order has been cancelled as requested.",
      };

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

    case EmailEventType.PAYMENT_FAILED:
      return {
        subject: `Payment Failed for Order ${data.order?.orderId}`,
        html: `<h1>Payment Failed</h1><p>We couldn't process your payment. Please try again.</p>`,
        text: "Payment Failed. We couldn't process your payment. Please try again.",
      };

    case EmailEventType.LOW_STOCK_ALERT:
      return {
        subject: `${data.component?.name} is Running Low!`,
        html: `<h1>Low Stock Alert</h1><p>${data.component?.name} is running low. Order now!</p>`,
        text: `${data.component?.name} is running low. Order now!`,
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
        subject: "RoboRoot Notification",
        html: "<p>You have a new notification from RoboRoot.</p>",
        text: "You have a new notification from RoboRoot.",
      };
  }
}
