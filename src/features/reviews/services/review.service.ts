import { prisma } from "../../../lib/prisma.js";

export async function createReview(
  userId: string,
  componentId: string,
  rating: number,
  title?: string,
  body?: string,
  imageUrl?: string,
) {
  if (rating < 1 || rating > 5) throw Object.assign(new Error("Rating must be between 1 and 5"), { statusCode: 400 });

  const component = await prisma.component.findUnique({ where: { id: componentId }, select: { id: true } });
  if (!component) throw Object.assign(new Error("Component not found"), { statusCode: 404 });

  // Check if user has purchased this component (for verified badge)
  const purchased = await prisma.orderItem.findFirst({
    where: {
      componentId,
      order: { userId, status: { in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] } },
    },
  });

  return prisma.review.upsert({
    where: { userId_componentId: { userId, componentId } },
    create: {
      userId,
      componentId,
      rating,
      title: title ?? null,
      body: body ?? null,
      imageUrl: imageUrl ?? null,
      isVerified: Boolean(purchased),
    },
    update: {
      rating,
      title: title ?? null,
      body: body ?? null,
      imageUrl: imageUrl ?? null,
    },
    include: { user: { select: { name: true, avatarUrl: true } } },
  });
}

export async function getComponentReviews(componentId: string, page: number, limit: number) {
  const [reviews, total, agg, starCounts] = await Promise.all([
    prisma.review.findMany({
      where: { componentId, isApproved: true },
      include: { user: { select: { name: true, avatarUrl: true } } },
      orderBy: [{ isVerified: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.review.count({ where: { componentId, isApproved: true } }),
    prisma.review.aggregate({
      where: { componentId, isApproved: true },
      _avg: { rating: true },
      _count: { id: true },
    }),
    prisma.review.groupBy({
      by: ["rating"],
      where: { componentId, isApproved: true },
      _count: { id: true },
    }),
  ]);

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  starCounts.forEach((group) => {
    const r = group.rating;
    if (r >= 1 && r <= 5) {
      breakdown[r as 1 | 2 | 3 | 4 | 5] = group._count.id;
    }
  });

  return {
    reviews,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    averageRating: agg._avg.rating ?? 0,
    reviewCount: agg._count.id,
    breakdown,
  };
}

export async function deleteReview(reviewId: string, userId: string, isAdmin: boolean) {
  const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { userId: true } });
  if (!review) throw Object.assign(new Error("Review not found"), { statusCode: 404 });
  if (!isAdmin && review.userId !== userId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  await prisma.review.delete({ where: { id: reviewId } });
}

export async function moderateReview(reviewId: string, isApproved: boolean) {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw Object.assign(new Error("Review not found"), { statusCode: 404 });
  return prisma.review.update({ where: { id: reviewId }, data: { isApproved } });
}
