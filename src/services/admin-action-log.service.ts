import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";

export type AdminActionType =
  | "CREATE_PRODUCT" | "UPDATE_PRODUCT" | "DELETE_PRODUCT" | "ARCHIVE_PRODUCT"
  | "CREATE_PROJECT" | "UPDATE_PROJECT" | "DELETE_PROJECT"
  | "UPDATE_ORDER_STATUS" | "CANCEL_ORDER" | "REFUND_ORDER"
  | "CREATE_COUPON" | "UPDATE_COUPON" | "DELETE_COUPON"
  | "UPDATE_STOCK" | "UPDATE_CATEGORY"
  | "UPDATE_USER_ROLE" | "DEACTIVATE_USER"
  | "PROCESS_PCB_REQUEST" | "UPDATE_STORE_SETTINGS"
  | "UPDATE_SUPPORT_TICKET" | "REPLY_SUPPORT_TICKET"
  | "CREATE_KNOWLEDGE_ARTICLE" | "UPDATE_KNOWLEDGE_ARTICLE" | "DELETE_KNOWLEDGE_ARTICLE";

export type AdminTargetType = "PRODUCT" | "PROJECT" | "ORDER" | "COUPON" | "USER" | "CATEGORY" | "PCB_REQUEST" | "STORE_SETTING" | "SUPPORT_TICKET" | "KNOWLEDGE_ARTICLE";

export async function logAdminAction(
  adminId: string,
  actionType: AdminActionType,
  targetType?: AdminTargetType,
  targetId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await prisma.adminActionLog.create({
    data: {
      adminId,
      actionType,
      targetType: targetType ?? null,
      targetId: targetId ?? null,
      details: details !== undefined ? (details as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  }).catch((err: unknown) => {
    console.error("[AdminLog] Failed to write action log:", err);
  });
}
