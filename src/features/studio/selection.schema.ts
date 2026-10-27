import { z } from 'zod';
export const selectionSchema = z.object({
  productId: z.string().cuid(),
  choices: z.record(z.string().min(1).max(80), z.string().max(80)).refine(value => Object.keys(value).length <= 20),
  quantity: z.number().int().min(1).max(99).default(1),
  personalText: z.string().trim().max(300).default(''),
}).strict();
export type StudioSelection = z.infer<typeof selectionSchema>;
