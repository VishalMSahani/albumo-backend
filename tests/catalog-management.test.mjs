import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const mock = {};
globalThis.__catalogManagementPrisma = mock;
const bundled = await build({
  stdin: { contents: "export { updateComponentStock } from './src/features/components/services/component.service.ts'; export * from './src/features/categories/services/category.service.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'catalog-management-database', setup(builder) {
    builder.onResolve({ filter: /lib\/prisma\.js$/ }, () => ({ path: 'prisma', namespace: 'catalog-management-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'catalog-management-test' }, () => ({ contents: 'export const prisma = globalThis.__catalogManagementPrisma;', loader: 'js' }));
  } }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
mock.$transaction = async callback => callback(mock);

test('inventory changes reject stale stock, subtraction below zero, and concurrent writes', async () => {
  let writes = 0;
  mock.component = {
    findUnique: async () => ({ id: 'motor', name: 'Motor', stockQuantity: 10, unitPriceCents: 100 }),
    updateMany: async query => { writes++; assert.equal(query.where.stockQuantity, 10); return { count: 1 }; },
  };
  await assert.rejects(api.updateComponentStock('motor', 5, 'set', 8), /Stock changed/);
  await assert.rejects(api.updateComponentStock('motor', 11, 'subtract', 10), /nonnegative/);
  assert.equal(writes, 0);
  assert.equal((await api.updateComponentStock('motor', 4, 'add', 10)).stockQuantity, 14);
  mock.component.updateMany = async () => ({ count: 0 });
  await assert.rejects(api.updateComponentStock('motor', 3, 'subtract', 10), /Stock changed/);
});

test('category renames carry product assignments to the new category', async () => {
  let where, data;
  mock.category = {
    findUnique: async query => query.where.id ? { id: 'parent', name: 'Motors' } : null,
    update: async query => ({ id: 'parent', ...query.data, subcategories: [] }),
  };
  mock.component = { updateMany: async query => { ({ where, data } = query); return { count: 2 }; } };
  await api.updateCategory('parent', { name: 'Motors & Actuators' });
  assert.deepEqual(where, { category: { equals: 'Motors', mode: 'insensitive' } });
  assert.deepEqual(data, { category: 'Motors & Actuators' });
});

test('subcategory renames are scoped to their parent and assigned categories cannot be deleted', async () => {
  let scopedWhere;
  mock.category = {
    findUnique: async () => ({ id: 'parent', name: 'Motors' }),
    findUniqueOrThrow: async () => ({ id: 'parent', name: 'Motors' }),
    delete: async () => assert.fail('Assigned category must not be deleted'),
  };
  mock.subcategory = {
    findUnique: async query => query.where.id ? { id: 'child', name: 'DC', categoryId: 'parent' } : null,
    update: async query => ({ id: 'child', ...query.data }),
  };
  mock.component = {
    updateMany: async query => { scopedWhere = query.where; return { count: 1 }; },
    count: async () => 1,
  };
  await api.updateSubcategory('child', { name: 'DC Gear Motors' }, 'parent');
  assert.equal(scopedWhere.category.equals, 'Motors');
  assert.equal(scopedWhere.subcategory.equals, 'DC');
  await assert.rejects(api.updateSubcategory('child', { name: 'Other' }, 'wrong-parent'), /not found/);
  await assert.rejects(api.deleteCategory('parent'), /Move all products/);
  await assert.rejects(api.deleteSubcategory('child', 'parent'), /Move all products/);
});
