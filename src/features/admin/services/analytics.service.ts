import { prisma } from "../../../lib/prisma.js";

function periodStart(period: string): Date {
  const days = period === "90d" ? 90 : period === "30d" ? 30 : 7;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getRevenueAnalytics(period: string) {
  const start = periodStart(period);

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] },
      createdAt: { gte: start },
    },
    select: { totalAmountCents: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Group by day
  const byDay: Record<string, number> = {};
  for (const o of orders) {
    const day = (o.createdAt.toISOString().split("T")[0]) as string;
    byDay[day] = (byDay[day] ?? 0) + o.totalAmountCents;
  }

  const data = Object.entries(byDay).map(([date, totalCents]) => ({ date, totalCents }));
  const totalRevenueCents = orders.reduce((s, o) => s + o.totalAmountCents, 0);

  return { data, totalRevenueCents, orderCount: orders.length };
}

export async function getOrderAnalytics(period: string) {
  const start = periodStart(period);

  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: start } },
    select: { status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const byDay: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const o of orders) {
    const day = (o.createdAt.toISOString().split("T")[0]) as string;
    const status = o.status as string;
    byDay[day] = (byDay[day] ?? 0) + 1;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  return {
    data: Object.entries(byDay).map(([date, count]) => ({ date, count })),
    byStatus,
    totalOrders: orders.length,
  };
}

export async function getTopProducts(limit: number) {
  const items = await prisma.orderItem.groupBy({
    by: ["componentId", "description"],
    _sum: { quantity: true, subtotalCents: true },
    _count: { id: true },
    orderBy: { _sum: { subtotalCents: "desc" } },
    take: limit,
    where: { componentId: { not: null } },
  });

  const componentIds = items.map((i) => i.componentId!);
  const components = await prisma.component.findMany({
    where: { id: { in: componentIds } },
    select: { id: true, name: true, imageUrl: true, sku: true, stockQuantity: true },
  });
  const compMap = new Map(components.map((c) => [c.id, c]));

  return items.map((item) => ({
    componentId: item.componentId,
    name: compMap.get(item.componentId!)?.name ?? item.description,
    imageUrl: compMap.get(item.componentId!)?.imageUrl ?? null,
    sku: compMap.get(item.componentId!)?.sku ?? null,
    stockQuantity: compMap.get(item.componentId!)?.stockQuantity ?? 0,
    totalUnitsSold: item._sum.quantity ?? 0,
    totalRevenueCents: item._sum.subtotalCents ?? 0,
    orderCount: item._count.id,
  }));
}

export async function getLowStockAlerts(threshold: number) {
  return prisma.component.findMany({
    where: { stockQuantity: { lte: threshold }, isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      stockQuantity: true,
      category: true,
      subcategory: true,
      imageUrl: true,
    },
    orderBy: { stockQuantity: "asc" },
  });
}

export async function getDashboardKpis() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [totalRevenue, totalOrders, newCustomers, pendingOrders, lowStock] = await Promise.all([
    prisma.order.aggregate({
      where: { status: { in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] } },
      _sum: { totalAmountCents: true },
    }),
    prisma.order.count(),
    prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.order.count({ where: { status: "PENDING_PAYMENT" } }),
    prisma.component.count({ where: { stockQuantity: { lte: 5 }, isActive: true } }),
  ]);

  return {
    totalRevenueCents: totalRevenue._sum.totalAmountCents ?? 0,
    totalOrders,
    newCustomersLast30Days: newCustomers,
    pendingOrders,
    lowStockAlerts: lowStock,
  };
}
