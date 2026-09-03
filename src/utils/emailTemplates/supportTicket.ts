import { wrapTemplate, type EmailTemplate } from "./base.js";

type SupportTicketTemplateData = {
  audience?: "CUSTOMER" | "SUPPORT";
  ticket: {
    ticketNumber: string;
    requesterName: string;
    requesterEmail: string;
    subject: string;
    priority: string;
    status: string;
    trackingUrl: string;
    message?: string;
  };
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function label(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function supportTicketTemplate(
  data: SupportTicketTemplateData,
  kind: "CREATED" | "UPDATED" | "REPLY",
): EmailTemplate {
  const ticket = data.ticket;
  const number = escapeHtml(ticket.ticketNumber);
  const subject = escapeHtml(ticket.subject);
  const requester = escapeHtml(ticket.requesterName);
  const status = escapeHtml(label(ticket.status));
  const priority = escapeHtml(label(ticket.priority));
  const message = ticket.message ? escapeHtml(ticket.message).replace(/\n/g, "<br>") : "";
  const isSupport = data.audience === "SUPPORT";

  const heading = isSupport
    ? "New support request"
    : kind === "CREATED"
      ? "We received your request"
      : kind === "REPLY"
        ? "RoboRoot Support replied"
        : "Your ticket was updated";

  const intro = isSupport
    ? `${requester} submitted a new support request.`
    : kind === "CREATED"
      ? `Hi ${requester}, your request is now in our support queue.`
      : `Hi ${requester}, there is an update on your support request.`;

  const content = `
    <h1>${heading}</h1>
    <p>${intro}</p>
    <div class="info-box">
      <p><strong>Ticket:</strong> ${number}</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Priority:</strong> ${priority}</p>
      <p><strong>Status:</strong> ${status}</p>
      ${isSupport ? `<p><strong>Customer:</strong> ${escapeHtml(ticket.requesterEmail)}</p>` : ""}
    </div>
    ${message ? `<h2>Latest reply</h2><p>${message}</p>` : ""}
    <p class="text-center"><a href="${escapeHtml(ticket.trackingUrl)}" class="button">View ticket</a></p>
    <p>Reply from the ticket page so the complete conversation stays together.</p>
  `;

  return {
    subject: `${kind === "CREATED" ? "Ticket received" : kind === "REPLY" ? "New reply" : "Ticket updated"} - ${ticket.ticketNumber}`,
    html: wrapTemplate(content),
    text: `${heading}\n\nTicket: ${ticket.ticketNumber}\nSubject: ${ticket.subject}\nPriority: ${label(ticket.priority)}\nStatus: ${label(ticket.status)}${ticket.message ? `\n\nLatest reply:\n${ticket.message}` : ""}\n\nView ticket: ${ticket.trackingUrl}`,
  };
}
