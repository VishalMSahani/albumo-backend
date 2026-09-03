export type ChatIntentType = "informational" | "action";
export type ActionType = "compose_bom" | "compare_live" | "checkout" | "track_order" | "bulk_order" | null;

export interface RouterResult {
  intent: ChatIntentType;
  action: ActionType;
}

export function classifyIntent(
  message: string,
  isAuthenticated: boolean,
  isCartEmpty: boolean
): RouterResult {
  const normalized = message.toLowerCase().trim();

  // 1. Checkout action check: require matched trigger phrase pattern AND cart non-empty AND session authenticated
  const checkoutRegex = /\b(order\s+(my\s+)?cart|checkout\s+(my\s+)?cart|place\s+(the\s+)?order|buy\s+(the\s+)?cart|complete\s+order)\b/i;
  if (checkoutRegex.test(normalized)) {
    if (isAuthenticated && !isCartEmpty) {
      return { intent: "action", action: "checkout" };
    }
  }

  // 2. compose_bom action check
  const bomRegex = /\b(parts\s+list|bill\s+of\s+materials|bom\s+for|what\s+do\s+i\s+need\s+to\s+build|list\s+parts\s+for|compose\s+bom)\b/i;
  if (bomRegex.test(normalized)) {
    return { intent: "action", action: "compose_bom" };
  }

  // 3. compare_live action check
  const compareLiveRegex = /\b(compare\s+competitor\s+price|compare\s+live|fetch\s+live\s+competitor|fetch\s+competitor\s+price|compare_live)\b/i;
  if (compareLiveRegex.test(normalized)) {
    return { intent: "action", action: "compare_live" };
  }

  // 4. track_order action check
  const trackOrderRegex = /\b(track\s+order|order\s+status|where\s+is\s+my\s+order|track\s+my\s+package)\b/i;
  if (trackOrderRegex.test(normalized)) {
    return { intent: "action", action: "track_order" };
  }

  // 5. bulk_order action check
  const bulkOrderRegex = /\b(bulk\s+order|import\s+excel|upload\s+csv\s+to\s+order|bulk\s+import|bulk\s+purchase)\b/i;
  if (bulkOrderRegex.test(normalized)) {
    return { intent: "action", action: "bulk_order" };
  }

  // Default to informational
  return { intent: "informational", action: null };
}
