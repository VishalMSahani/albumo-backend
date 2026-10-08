import { wrapTemplate, type EmailTemplate } from "./base.js";
export type BulkEmailData = { reference: string; message: string; url: string };
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export function bulkOrderTemplate(data: BulkEmailData): EmailTemplate {
  return {
    subject: `Bulk request update — ${data.reference}`,
    html: wrapTemplate(`<h1>Bulk request ${escape(data.reference)}</h1><p>${escape(data.message)}</p><p><a class="button" href="${escape(data.url)}">View bulk request</a></p><p>Quote acceptance is not payment or a stock reservation. Follow the agreed payment and delivery terms.</p>`),
    text: `${data.reference}\n\n${data.message}\n\n${data.url}\n\nQuote acceptance is not payment or a stock reservation.`,
  };
}
