import { z } from 'zod';

export const createReviewSchema = z.object({
  componentId: z.string().trim().min(1).max(100),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().max(10000).optional(),
  imageUrl: z.string().url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol), 'Use an HTTP(S) image URL').optional(),
}).strict();
