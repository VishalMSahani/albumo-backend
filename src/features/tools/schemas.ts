import { z } from "zod";
import type { ToolName } from "./types.js";

const shippingAddressSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(6),
  line1: z.string().trim().min(1),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1),
  state: z.string().trim().min(1),
  pincode: z.string().trim().min(4),
  country: z.string().trim().optional(),
});

export const toolSchemas = {
  search_products: z.object({
    query: z.string().trim().min(1),
  }),
  place_order: z.object({
    items: z.array(z.object({
      componentId: z.string().trim().min(1),
      quantity: z.coerce.number().int().min(1),
    })).min(1),
    shippingAddress: shippingAddressSchema.optional(),
    shippingAddressId: z.string().trim().min(1).optional(),
    couponCode: z.string().trim().min(1).optional(),
    notes: z.string().trim().max(1000).optional(),
    paymentGateway: z.enum(["TEST", "RAZORPAY", "ZOHO"]).optional(),
  }),
  initiate_payment: z.object({
    orderId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
  }),
  get_invoice: z.object({
    orderId: z.string().trim().min(1),
  }),
  track_order: z.object({
    orderId: z.string().trim().min(1),
  }),
  get_order_history: z.object({
    limit: z.coerce.number().int().min(1).max(10).optional(),
  }),
  cancel_order: z.object({
    orderId: z.string().trim().min(1),
  }),
  get_product_details: z.object({
    componentId: z.string().trim().min(1),
  }),
  get_cart: z.object({}),
  list_addresses: z.object({}),
  checkout_cart: z.object({
    couponCode: z.string().trim().min(1).optional(),
    notes: z.string().trim().max(1000).optional(),
    paymentGateway: z.enum(["TEST", "RAZORPAY", "ZOHO"]).optional(),
  }),
  compare_prices: z.object({
    componentId: z.string().trim().min(1),
  }),
  get_user_profile: z.object({}),
  compose_bom: z.object({
    description: z.string().trim().min(1),
  }),
  fetch_competitor_price: z.object({
    componentId: z.string().trim().min(1),
    platforms: z.array(z.string().trim()).optional(),
  }),
  bulk_order: z.object({
    fileUrl: z.string().trim().min(1).optional(),
    csvContent: z.string().trim().min(1).optional(),
  }),
  confirm_bulk_order: z.object({
    items: z.array(z.object({
      componentId: z.string().trim().min(1),
      quantity: z.coerce.number().int().min(1),
    })).min(1),
  }),
} satisfies Record<ToolName, z.ZodType>;

export type SearchProductsParams = z.infer<typeof toolSchemas.search_products>;
export type PlaceOrderParams = z.infer<typeof toolSchemas.place_order>;
export type InitiatePaymentParams = z.infer<typeof toolSchemas.initiate_payment>;
export type GetInvoiceParams = z.infer<typeof toolSchemas.get_invoice>;
export type TrackOrderParams = z.infer<typeof toolSchemas.track_order>;
export type GetOrderHistoryParams = z.infer<typeof toolSchemas.get_order_history>;
export type CancelOrderParams = z.infer<typeof toolSchemas.cancel_order>;
export type GetProductDetailsParams = z.infer<typeof toolSchemas.get_product_details>;
export type GetCartParams = z.infer<typeof toolSchemas.get_cart>;
export type ListAddressesParams = z.infer<typeof toolSchemas.list_addresses>;
export type CheckoutCartParams = z.infer<typeof toolSchemas.checkout_cart>;
export type ComparePricesParams = z.infer<typeof toolSchemas.compare_prices>;
export type GetUserProfileParams = z.infer<typeof toolSchemas.get_user_profile>;
