import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createProjectSchema, updateProjectSchema, parseProjectMultipart, projectFiltersSchema } from '../src/features/projects/validators/project.schema.ts';

const base = { title: 'Contract test project', slug: 'contract-test-project', description: 'A tested maker project', category: 'IOT', difficulty: 'BEGINNER', isPublic: false };
const part = { componentId: 'c1234567890123456789012345', quantity: 2, isOptional: true, note: 'Input' };
const section = { sectionKey: 'wiring', heading: 'Wire safely', body: 'Power off first.', diagramUrl: 'https://example.invalid/diagram.png', code: 'void setup() {}', repoUrl: 'https://example.invalid/code', steps: [{ title: 'Connect', body: 'VCC to 3.3V.' }], faqs: [{ question: 'No response?', answer: 'Check the power.' }] };

test('ready-made requires a positive integer-paise price and nonnegative integer stock', () => {
  for (const preBuiltPriceCents of [undefined, null, 0, -1, 1.5, 2147483648]) assert.equal(createProjectSchema.safeParse({ ...base, preBuiltAvailable: true, preBuiltPriceCents }).success, false);
  assert(createProjectSchema.safeParse({ ...base, preBuiltAvailable: true, preBuiltPriceCents: 249999, preBuiltStock: 0 }).success);
  assert.equal(createProjectSchema.safeParse({ ...base, preBuiltStock: -1 }).success, false);
  assert.equal(createProjectSchema.safeParse({ ...base, preBuiltStock: 1.5 }).success, false);
});
test('invalid URLs and malformed JSON fail validation without crashing safeParse', () => {
  for (const youtubeUrl of ['not a URL', 'javascript:alert(1)', 'https://youtube.com.evil.invalid/watch', 'https://example.invalid/video']) assert.equal(createProjectSchema.safeParse({ ...base, youtubeUrl }).success, false);
  assert.throws(() => parseProjectMultipart({ contentSections: '{broken' }), /invalid JSON/);
  assert.equal(createProjectSchema.safeParse({ ...base, imageUrls: ['javascript:alert(1)'] }).success, false);
});
test('nested component and journey data enforce IDs, quantities, keys, and unique relationships', () => {
  assert(createProjectSchema.safeParse({ ...base, components: [part], contentSections: [section] }).success);
  for (const components of [[part, part], [{ ...part, componentId: 'sku-123' }], [{ ...part, quantity: 0 }]]) assert.equal(createProjectSchema.safeParse({ ...base, components }).success, false);
  for (const contentSections of [[section, section], [{ ...section, sectionKey: 'bad' }], [{ ...section, steps: [{ title: 'Missing instructions' }] }]]) assert.equal(createProjectSchema.safeParse({ ...base, contentSections }).success, false);
  assert.equal(createProjectSchema.safeParse({ ...base, components: [part], componentIds: [part.componentId] }).success, false);
});
test('multipart conversion retains ready-made, guide, BOM and media fields without truncating numbers', () => {
  const parsed = createProjectSchema.parse(parseProjectMultipart({ ...base, isPublic: 'false', preBuiltAvailable: 'true', preBuiltPriceCents: '249999', preBuiltStock: '2', preBuiltImages: '["https://example.invalid/ready.png"]', components: JSON.stringify([part]), contentSections: JSON.stringify([section]) }));
  assert.equal(parsed.preBuiltPriceCents, 249999); assert.equal(parsed.preBuiltStock, 2); assert.equal(parsed.isPublic, false);
  assert.deepEqual(parsed.components, [part]); assert.deepEqual(parsed.contentSections[0].steps, section.steps);
  assert.equal(createProjectSchema.safeParse(parseProjectMultipart({ ...base, preBuiltStock: '3.5' })).success, false);
  assert.equal(createProjectSchema.safeParse(parseProjectMultipart({ ...base, preBuiltAvailable: 'yes' })).success, false);
});
test('updates can clear relationships, reject empty/unknown fields and respect cost ranges', () => {
  assert(updateProjectSchema.safeParse({ components: [], contentSections: [], imageUrls: [], thumbnailUrl: null }).success);
  assert.equal(updateProjectSchema.safeParse({}).success, false);
  assert.equal(updateProjectSchema.safeParse({ prebuiltPrice: 20 }).success, false);
  assert.equal(updateProjectSchema.safeParse({ costEstimateMinCents: 200, costEstimateMaxCents: 100 }).success, false);
  assert.equal(projectFiltersSchema.safeParse({ page: '1.5' }).success, false);
  assert.equal(projectFiltersSchema.safeParse({ limit: '101' }).success, false);
});

async function bundle(contents, plugins = []) {
  const result = await build({ stdin: { contents, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, plugins });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const admin = await bundle("export * from '../admin-frontend/lib/project-form.ts'; export * from '../admin-frontend/lib/project-import.ts';");
test('downloadable admin templates satisfy the actual backend create/update schemas', () => {
  for (const row of admin.normalizeImportRows(admin.templateRows)) {
    const body = admin.importRowBody(row);
    assert(createProjectSchema.safeParse(body).success);
    assert(updateProjectSchema.safeParse(body).success);
    assert.deepEqual(createProjectSchema.parse(body).contentSections, body.contentSections);
    assert.equal(body.isPublic, false);
  }
});

// Contract harness: no database or external services are contacted.
const mock = {};
globalThis.__projectTestPrisma = mock;
const stubs = { name: 'isolated-project-contract', setup(builder) {
  builder.onResolve({ filter: /lib\/prisma\.js$/ }, () => ({ path: 'prisma', namespace: 'project-test' }));
  builder.onResolve({ filter: /lib\/redis\.js$/ }, () => ({ path: 'redis', namespace: 'project-test' }));
  builder.onResolve({ filter: /project-error\.js$/ }, () => ({ path: 'error', namespace: 'project-test' }));
  builder.onLoad({ filter: /.*/, namespace: 'project-test' }, ({ path }) => ({ contents: path === 'prisma' ? 'export const prisma = globalThis.__projectTestPrisma;' : path === 'redis' ? 'export async function cacheInvalidate() {}' : 'export function projectError(res, error) { res.status(500).json({ error: error.message }); }', loader: 'js' }));
} };
const service = await bundle("export * from './src/features/projects/services/project.service.ts';", [stubs]);
const controller = await bundle("export * from './src/features/projects/controllers/project.controller.ts';", [stubs]);
const dbRow = overrides => ({ ...base, id: 'project-id', preBuiltAvailable: false, preBuiltStock: 0, preBuiltPriceCents: null, costEstimateMinCents: null, costEstimateMaxCents: null, projectComponents: [], contentSections: [], ...overrides });
let calls = [], transactionCount = 0;
function reset(row = dbRow({})) {
  calls = []; transactionCount = 0;
  mock.$transaction = async action => { transactionCount++; return action(mock); };
  mock.project = {
    findUnique: async () => null, findFirst: async () => row,
    findMany: async query => { calls.push(query); return []; }, count: async () => 0,
    create: async query => {
      calls.push(query);
      return dbRow({ ...query.data, projectComponents: query.data.projectComponents.create.map(item => ({ ...item, id: 'part-relation', component: { id: item.componentId, name: 'Board', unitPriceCents: 10000, stockQuantity: 10, isActive: true } })), contentSections: query.data.contentSections.create.map(item => ({ ...item, id: 'stage-id' })) });
    },
    update: async query => { calls.push(query); return row; },
  };
}
function response() {
  return { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
test('creation writes the full project and nested content in one transaction and returns the content', async () => {
  reset();
  const result = await service.createProject({ ...base, components: [part], contentSections: [section], preBuiltAvailable: true, preBuiltPriceCents: 249999, preBuiltStock: 2 }, 'admin-id');
  assert.equal(transactionCount, 1); assert.equal(calls.length, 1);
  assert.equal(calls[0].data.contentSections.create.length, 1);
  assert.equal(result.contentSections[0].diagramUrl, section.diagramUrl);
  assert.equal(result.components[0].quantity, 2);
  assert.equal(result.preBuiltPriceCents, 249999);
});
test('updates use nested upserts and targeted removals, retaining saved relationship identity', async () => {
  reset();
  await service.updateProject('project-id', { components: [part], contentSections: [section] });
  assert.equal(transactionCount, 1); assert.equal(calls.length, 1);
  const data = calls[0].data;
  assert.deepEqual(data.projectComponents.deleteMany, { componentId: { notIn: [part.componentId] } });
  assert.deepEqual(data.contentSections.deleteMany, { sectionKey: { notIn: ['wiring'] } });
  assert.equal(data.contentSections.upsert[0].where.projectId_sectionKey.sectionKey, 'wiring');
  assert.equal(data.contentSections.upsert[0].update.diagramUrl, section.diagramUrl);
});
test('updates validate merged ready-made/range state before issuing a write', async () => {
  reset(dbRow({ preBuiltAvailable: true, preBuiltPriceCents: 199900, preBuiltStock: 2 }));
  await assert.rejects(service.updateProject('project-id', { preBuiltPriceCents: null }));
  assert.equal(calls.length, 0);
  await service.updateProject('project-id', { preBuiltAvailable: false });
  assert.equal(calls[0].data.preBuiltPriceCents, null); assert.equal(calls[0].data.preBuiltStock, 0);
  reset(dbRow({ costEstimateMaxCents: 10000 }));
  await assert.rejects(service.updateProject('project-id', { costEstimateMinCents: 20000 }));
  assert.equal(calls.length, 0);
});
test('duplicate slugs reject before creating another project', async () => {
  reset(); mock.project.findUnique = async () => dbRow({});
  await assert.rejects(service.createProject(base, 'admin-id'), /already exists/);
  assert.equal(calls.length, 0);
});

test('matching projects filters exact component identity in the database before pagination and hides drafts', async () => {
  reset();
  const res = response();
  await controller.handleListProjects({ query: { componentId: part.componentId, isPublic: 'false', limit: '3' } }, res);
  const query = calls.at(-1);
  assert.deepEqual(query.where.projectComponents, { some: { componentId: part.componentId, component: { isActive: true } } });
  assert.equal(query.where.isPublic, true);
  assert.equal(query.where.deletedAt, null);
  assert.equal(query.take, 3);
  assert.equal(projectFiltersSchema.safeParse({ componentId: 'not-a-component-id' }).success, false);
});
test('public endpoints hide drafts while protected admin handlers can read them', async () => {
  reset();
  const req = { params: { id: 'project-id', slug: base.slug }, query: { isPublic: 'false' } };
  for (const handler of [controller.handleGetProjectById, controller.handleGetProjectBySlug]) {
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 404);
  }
  const adminRes = response(); await controller.handleAdminGetProject(req, adminRes); assert.equal(adminRes.body.data.isPublic, false);
  await controller.handleListProjects(req, response()); assert.equal(calls.at(-1).where.isPublic, true);
  await controller.handleAdminListProjects({ ...req, query: {} }, response()); assert.equal(calls.at(-1).where.isPublic, undefined);
  const routes = readFileSync(new URL('../src/features/projects/routes/project.routes.ts', import.meta.url), 'utf8');
  assert(routes.includes("router.get('/admin', authenticate, authorize('ADMIN')"));
  assert(routes.includes("router.get('/admin/:id', authenticate, authorize('ADMIN')"));
});
