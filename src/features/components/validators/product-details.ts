import { z } from 'zod';

export const productSpecificationsSchema = z.array(z.object({
  label: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(2000),
}).strict()).max(100).superRefine((rows, context) => {
  const labels = new Set<string>();
  rows.forEach((row, index) => {
    const key = row.label.toLowerCase();
    if (labels.has(key)) context.addIssue({ code: 'custom', path: [index, 'label'], message: 'Specification labels must be unique' });
    labels.add(key);
  });
});

// JSON requests use an array; multipart and CSV transport it as a JSON cell.
// Invalid JSON must fail safeParse, not throw outside the validator.
export const specificationsInputSchema = z.preprocess(value => {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return [];
  try { return JSON.parse(value); } catch { return value; }
}, productSpecificationsSchema);

export const productDetailsSchema = z.object({
  specifications: specificationsInputSchema.optional(),
  countryOfOrigin: z.string().trim().max(100).nullable().optional(),
  warranty: z.string().trim().max(10000).nullable().optional(),
});

/** Omitted fields preserve existing data; explicit blanks clear it. */
export function parseProductDetails(value: unknown) {
  const fields = productDetailsSchema.parse(value);
  return {
    ...(fields.specifications !== undefined ? { specifications: fields.specifications } : {}),
    ...(fields.countryOfOrigin !== undefined ? { countryOfOrigin: fields.countryOfOrigin || null } : {}),
    ...(fields.warranty !== undefined ? { warranty: fields.warranty || null } : {}),
  };
}
