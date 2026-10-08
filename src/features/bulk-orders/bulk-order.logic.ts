import { bulkItemsSchema, type QuoteInput } from "./validators/bulk-order.validator.js";
import { parseCsv } from "../components/validators/product-csv.js";

export class BulkWorkflowError extends Error {
  constructor(public kind: "INVALID" | "NOT_FOUND" | "CONFLICT", message: string) { super(message); }
}
export function quoteTotals(input: Pick<QuoteInput, "items" | "shippingCents">) {
  const subtotalCents = input.items.reduce((sum, row) => sum + row.quantity * row.unitPriceCents, 0);
  const taxCents = input.items.reduce((sum, row) => sum + Math.round(row.quantity * row.unitPriceCents * row.taxBasisPoints / 10000), 0);
  const totalCents = subtotalCents + taxCents + input.shippingCents;
  if (!Number.isSafeInteger(totalCents) || totalCents < 1 || totalCents > 2000000000) throw new BulkWorkflowError("INVALID", "Quote total must be greater than zero and within the supported limit.");
  return { subtotalCents, taxCents, totalCents };
}
export function assertTransition(current: string, next: string) {
  const allowed: Record<string, string[]> = {
    SUBMITTED: ["REVIEWING", "CANCELLED"], REVIEWING: ["CANCELLED"],
    QUOTED: ["REVIEWING", "CANCELLED"], DECLINED: ["REVIEWING", "CANCELLED"],
    ACCEPTED: ["IN_FULFILLMENT", "CANCELLED"], IN_FULFILLMENT: ["COMPLETED", "CANCELLED"],
  };
  if (current !== next && !allowed[current]?.includes(next)) throw new BulkWorkflowError("CONFLICT", `Cannot change ${current} to ${next}. Refresh the request and follow its workflow.`);
}
export function assertQuoteDecision(status: string, latestQuoteId: string | undefined, inputQuoteId: string, validUntil: Date, now = new Date()) {
  if (status !== "QUOTED" || latestQuoteId !== inputQuoteId) throw new BulkWorkflowError("CONFLICT", "This quote is no longer current. Refresh to review the latest version.");
  if (validUntil <= now) throw new BulkWorkflowError("CONFLICT", "This quote has expired. Send a message asking for a revised quote.");
}
export function parseBulkCsv(csv: string) {
  if (csv.length > 250000) throw new BulkWorkflowError("INVALID", "CSV must be smaller than 250 KB.");
  try {
    const [header, ...rows] = parseCsv(csv);
    if (!header || !rows.length || rows.length > 100) throw new Error("Include headers and between 1 and 100 item rows.");
    const aliases: Record<string, string> = { componentname: "name", name: "name", sku: "sku", quantity: "quantity", targetpriceinr: "price", notes: "notes" };
    const columns = header.map(value => aliases[value.toLowerCase().replace(/[^a-z0-9]/g, "")]);
    if (columns.some(value => !value) || new Set(columns).size !== columns.length || !columns.includes("name") || !columns.includes("quantity")) throw new Error("Use the template headers: Component Name, SKU, Quantity, Target Price (INR), Notes.");
    return bulkItemsSchema.parse(rows.map((values, index) => {
      if (values.length !== columns.length) throw new Error(`Row ${index + 2}: column count does not match the header.`);
      const row = Object.fromEntries(columns.map((key, col) => [key!, values[col]!.trim()]));
      if (!/^\d+$/.test(row.quantity!) || (row.price && !/^\d+(?:\.\d{1,2})?$/.test(row.price))) throw new Error(`Row ${index + 2}: use a whole quantity and an INR target price with up to two decimals.`);
      return { name: row.name, sku: row.sku || "", quantity: Number(row.quantity), targetPriceCents: row.price ? Math.round(Number(row.price) * 100) : null, notes: row.notes || "" };
    }));
  } catch (error) { throw new BulkWorkflowError("INVALID", error instanceof Error ? error.message : "Invalid CSV"); }
}
