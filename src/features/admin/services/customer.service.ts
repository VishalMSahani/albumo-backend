import { prisma } from "../../../lib/prisma.js";

export interface CustomerListItem {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  _count: { orders: number };
  totalSpentCents: number;
}

export async function listCustomers(page: number, limit: number, search?: string) {
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        _count: { select: { orders: true } },
        orders: {
          select: { totalAmountCents: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  const customers: CustomerListItem[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
    _count: u._count,
    totalSpentCents: u.orders.reduce((s, o) => s + o.totalAmountCents, 0),
  }));

  return { customers, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getCustomerDetail(customerId: string) {
  const user = await prisma.user.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      college: true,
      avatarUrl: true,
      createdAt: true,
      addresses: {
        orderBy: { createdAt: "desc" },
      },
      orders: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          totalAmountCents: true,
          createdAt: true,
          orderType: true,
          trackingAwb: true,
          trackingUrl: true,
          items: { select: { description: true, quantity: true, subtotalCents: true }, take: 3 },
        },
      },
    },
  });

  if (!user) throw Object.assign(new Error("Customer not found"), { statusCode: 404 });

  return {
    ...user,
    totalSpentCents: user.orders.reduce((s, o) => s + o.totalAmountCents, 0),
    totalOrders: user.orders.length,
  };
}

export async function updateCustomerStatus(customerId: string, isActive: boolean) {
  const user = await prisma.user.findUnique({ where: { id: customerId }, select: { role: true } });
  if (!user) throw Object.assign(new Error("Customer not found"), { statusCode: 404 });
  if (["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    throw Object.assign(new Error("Cannot suspend an admin account"), { statusCode: 403 });
  }

  return prisma.user.update({ where: { id: customerId }, data: { isActive } });
}
