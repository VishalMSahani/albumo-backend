import { z } from 'zod';

export const inventoryBodySchema = z.object({
  quantity: z.number().int().min(0).max(2147483647),
  operation: z.enum(['add', 'subtract', 'set']).default('set'),
  expectedStock: z.number().int().min(0).max(2147483647).optional(),
}).strict();
