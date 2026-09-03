import type { ToolActorRole, ToolName } from "./types.js";

export const TOOL_PERMISSIONS: Record<ToolName, ToolActorRole[]> = {
  search_products: ["guest", "user", "admin"],
  get_product_details: ["guest", "user", "admin"],
  place_order: ["user", "admin"],
  initiate_payment: ["user", "admin"],
  get_invoice: ["user", "admin"],
  track_order: ["user", "admin"],
  get_order_history: ["user", "admin"],
  cancel_order: ["user", "admin"],
  get_cart: ["user", "admin"],
  list_addresses: ["user", "admin"],
  checkout_cart: ["user", "admin"],
  compare_prices: ["guest", "user", "admin"],
  get_user_profile: ["user", "admin"],
  compose_bom: ["user", "admin"],
  fetch_competitor_price: ["user", "admin"],
  bulk_order: ["user", "admin"],
  confirm_bulk_order: ["user", "admin"],
};

export function canUseTool(tool: ToolName, role: ToolActorRole): boolean {
  return TOOL_PERMISSIONS[tool].includes(role);
}
