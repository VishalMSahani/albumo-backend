export type ToolName =
  | "search_products"
  | "place_order"
  | "initiate_payment"
  | "get_invoice"
  | "track_order"
  | "get_order_history"
  | "cancel_order"
  | "get_product_details"
  | "get_cart"
  | "list_addresses"
  | "checkout_cart"
  | "compare_prices"
  | "get_user_profile"
  | "compose_bom"
  | "fetch_competitor_price"
  | "bulk_order"
  | "confirm_bulk_order";

export type ToolActorRole = "guest" | "user" | "admin";

export interface ToolContext {
  userId: string | null;
  role: ToolActorRole;
  email?: string;
}

export type ToolResult<T> = { data: T } | { error: string };

export interface ToolCallAuditRecord {
  tool: ToolName;
  userId: string | null;
  params: Record<string, unknown>;
  result: "success" | "error";
  durationMs: number;
  createdAt: string;
}
