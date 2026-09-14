import { z } from 'zod';
import { ProjectCategory, DifficultyLevel, ProjectType } from '../../../generated/prisma/enums.js';

const id = z.string().regex(/^(?:c[a-z0-9]{24,32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i, 'Use a valid catalogue ID');
const url = z.string().url().refine(value => /^https?:\/\//i.test(value), 'Use an http or https URL');
const optionalUrl = z.union([url, z.literal('').transform(() => null)]).nullable().optional();
const amount = z.number().int().min(0).max(2_147_483_647).nullable().optional();
const lines = z.array(z.string().trim().min(1).max(2000)).max(100);
const component = z.object({
  componentId: id,
  quantity: z.number().int().min(1).max(10000),
  isOptional: z.boolean().optional(),
  note: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});
export const projectSectionSchema = z.object({
  sectionKey: z.enum(['components', 'wiring', 'code', 'troubleshooting']),
  heading: z.string().trim().min(1).max(200),
  body: z.string().max(50000),
  sortOrder: z.number().int().min(0).max(100).optional(),
  diagramUrl: optionalUrl,
  code: z.string().max(200000).nullable().optional(),
  repoUrl: optionalUrl,
  steps: z.array(z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10000) })).max(100).optional(),
  faqs: z.array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(10000) })).max(100).optional(),
});

const fields = z.object({
  title: z.string().trim().min(3).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  summary: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().min(1).max(100000),
  category: z.enum(ProjectCategory),
  difficulty: z.enum(DifficultyLevel),
  projectType: z.enum(ProjectType).optional(),
  tags: lines.optional(), learningOutcomes: lines.optional(), prerequisites: lines.optional(),
  estimatedCostCents: amount, costEstimateMinCents: amount, costEstimateMaxCents: amount,
  estimatedBuildTimeMinutes: z.number().int().min(0).max(525600).nullable().optional(),
  preBuiltAvailable: z.boolean().optional(),
  preBuiltPriceCents: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  preBuiltStock: z.number().int().min(0).max(2_147_483_647).optional(),
  thumbnailUrl: optionalUrl, heroImageUrl: optionalUrl, heroVideoUrl: optionalUrl,
  youtubeUrl: optionalUrl.refine(value => {
    if (!value) return true;
    try { return /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)$/.test(new URL(value).hostname); }
    catch { return false; }
  }, 'Use a YouTube video URL'),
  imageUrls: z.array(url).max(5).optional(), pdfUrls: z.array(url).max(5).optional(), preBuiltImages: z.array(url).max(5).optional(),
  externalLinks: z.array(z.object({ title: z.string().trim().min(1).max(200), url })).max(30).optional(),
  isFeatured: z.boolean().optional(), isPublic: z.boolean().optional(), defaultMentorId: id.nullable().optional(),
  componentIds: z.array(id).max(100).optional(), components: z.array(component).max(100).optional(),
  contentSections: z.array(projectSectionSchema).max(4).optional(),
}).strict();

type PartialProjectFields = { [K in keyof z.infer<typeof fields>]?: z.infer<typeof fields>[K] | undefined };
function refineProject(data: PartialProjectFields, context: z.RefinementCtx) {
  if (data.preBuiltAvailable && !(data.preBuiltPriceCents != null && data.preBuiltPriceCents > 0)) {
    context.addIssue({ code: 'custom', path: ['preBuiltPriceCents'], message: 'A positive ready-made price is required when available' });
  }
  if (data.costEstimateMinCents != null && data.costEstimateMaxCents != null && data.costEstimateMinCents > data.costEstimateMaxCents) {
    context.addIssue({ code: 'custom', path: ['costEstimateMaxCents'], message: 'Maximum cost must be at least the minimum cost' });
  }
  if (data.componentIds && data.components) context.addIssue({ code: 'custom', path: ['components'], message: 'Use components or componentIds, not both' });
  for (const [field, values] of [
    ['components', data.components?.map(row => row.componentId)],
    ['componentIds', data.componentIds],
    ['contentSections', data.contentSections?.map(section => section.sectionKey)],
  ] as const) {
    if (values && new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [field], message: 'Duplicate entries are not allowed' });
  }
}

export const createProjectSchema = fields.superRefine(refineProject);
export const updateProjectSchema = fields.omit({ componentIds: true }).partial().superRefine((data, context) => {
  if (!Object.keys(data).length) context.addIssue({ code: 'custom', message: 'Provide at least one field' });
  refineProject(data, context);
});

/** Convert multipart text fields without truncating invalid numbers or silently swallowing JSON errors. */
export function parseProjectMultipart(body: Record<string, unknown>): Record<string, unknown> {
  const jsonFields = new Set(['tags', 'learningOutcomes', 'prerequisites', 'imageUrls', 'pdfUrls', 'preBuiltImages', 'externalLinks', 'components', 'componentIds', 'contentSections']);
  const numbers = new Set(['estimatedCostCents', 'costEstimateMinCents', 'costEstimateMaxCents', 'estimatedBuildTimeMinutes', 'preBuiltPriceCents', 'preBuiltStock']);
  const flags = new Set(['isFeatured', 'isPublic', 'preBuiltAvailable']);
  return Object.fromEntries(Object.entries(body).filter(([key]) => !['replaceImages', 'replacePdfs', 'replaceLinks'].includes(key)).map(([key, value]) => {
    if (jsonFields.has(key) && typeof value === 'string') {
      try { return [key, value.trim() ? JSON.parse(value) : []]; }
      catch { throw new Error(`${key}: invalid JSON`); }
    }
    if (numbers.has(key) && typeof value === 'string') return [key, value.trim() ? Number(value) : key === 'preBuiltStock' ? 0 : null];
    if (flags.has(key) && typeof value === 'string') return [key, value === 'true' ? true : value === 'false' ? false : value];
    return [key, value];
  }));
}
const queryFlag = z.enum(['true', 'false']).transform(value => value === 'true').optional();
const queryNumber = z.coerce.number().finite().min(0).max(21474836.47).optional();
export const projectFiltersSchema = z.object({
  componentId: id.optional(),
  category: z.union([z.enum(ProjectCategory), z.array(z.enum(ProjectCategory))]).optional(),
  difficulty: z.union([z.enum(DifficultyLevel), z.array(z.enum(DifficultyLevel))]).optional(),
  projectType: z.enum(ProjectType).optional(), tags: z.union([z.string(), z.array(z.string())]).optional(),
  isFeatured: queryFlag, isPublic: queryFlag, isAIGenerated: queryFlag, preBuiltAvailable: queryFlag,
  minCost: queryNumber, maxCost: queryNumber, minBuildTime: queryNumber, maxBuildTime: queryNumber,
  search: z.string().max(200).optional(), page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'viewCount', 'buildCount', 'averageRating', 'estimatedCostCents']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
}).superRefine((data, context) => {
  if (data.minCost != null && data.maxCost != null && data.minCost > data.maxCost) context.addIssue({ code: 'custom', message: 'Minimum cost exceeds maximum cost' });
  if (data.minBuildTime != null && data.maxBuildTime != null && data.minBuildTime > data.maxBuildTime) context.addIssue({ code: 'custom', message: 'Minimum time exceeds maximum time' });
});
export const projectIdParamsSchema = z.object({ id });
