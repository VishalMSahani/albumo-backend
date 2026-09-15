import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseProductCsv, productTemplateCsv, csvCell } from '../src/features/components/validators/product-csv.ts';
import { productPricingSchema } from '../src/features/components/validators/product-pricing.ts';
import { parseProductDetails, productDetailsSchema } from '../src/features/components/validators/product-details.ts';
import { validateCreateComponent, validateUpdateComponent } from '../src/features/components/validators/component.validator.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createReviewSchema } from '../src/features/reviews/validators/review.validator.ts';
import { deliveryDays, summarizeDeliveryRates } from '../src/features/shipping/services/shiprocket.service.ts';
import { adminProductSettingsBodySchema } from '../src/validators/admin.validator.ts';

test('downloaded product template validates, is inactive, and supports the existing admin fields', () => {
  const [row] = parseProductCsv(productTemplateCsv());
  assert.equal(row.data.isActive, false);
  assert.equal(row.data.unitPriceCents, 10000);
  assert.equal(row.data.discountedPriceCents, 9000);
  assert.deepEqual(row.data.tags, ['infrared', 'robotics']);
  assert(row.data.description.includes('Specifications'));
});
test('CSV preserves quoted commas, HTML attributes, escaped quotes and multiline content', () => {
  const description = '<p title="Test">First, second</p>\nPinout: VCC, GND';
  const csv = ['name,unitPrice,description,tags', ['IR Sensor', '10.25', description, 'sensor, IR'].map(csvCell).join(',')].join('\r\n');
  const [row] = parseProductCsv('\uFEFF' + csv);
  assert.equal(row.data.description, description);
  assert.deepEqual(row.data.tags, ['sensor', 'IR']);
  assert.equal(row.data.unitPriceCents, 1025);
});
test('malformed files fail validation before any writes; unsafe numeric conversions are rejected', () => {
  for (const csv of [
    'name,unitPrice\nSensor,-1', 'name,unitPrice\nSensor,abc', 'name,unitPrice\nSensor,10.009',
    'name,unitPrice,stockQuantity\nSensor,10,2.5', 'name,unitPrice,isActive\nSensor,10,yes',
    'name,unitPrice,discountedPrice\nSensor,10,20', 'name,unitPrice,imageUrl\nSensor,10,javascript:alert(1)',
    'name,name,unitPrice\nSensor,Sensor,10', 'name,unitPrice\nSensor,10,extra',
    'name,unitPrice\n"Sensor,10', 'name,unitPrice,sku\nSensor,10,SAME\nSensor2,20,SAME',
  ]) assert.throws(() => parseProductCsv(csv), csv);
});
test('omitted columns are not replaced with destructive defaults; sale can be explicitly cleared', () => {
  const [row] = parseProductCsv('name,unitPrice\nNew name,20');
  assert.equal('description' in row.data, false);
  assert.equal('stockQuantity' in row.data, false);
  assert.equal('discountedPriceCents' in row.data, false);
  assert.equal(parseProductCsv('name,unitPrice,discountedPrice\nNew name,20,')[0].data.discountedPriceCents, null);
  assert.equal(parseCsv('"one","a""b"')[0][1], 'a"b');
});
test('pricing validation used by both create and update rejects invalid sale and stock values', () => {
  assert(productPricingSchema.safeParse({ unitPriceCents: 1000, discountedPriceCents: 0, stockQuantity: 0 }).success);
  for (const price of [-1, 1000, 2000, 0.5, Infinity, NaN]) assert.equal(productPricingSchema.safeParse({ unitPriceCents: 1000, discountedPriceCents: price }).success, false);
});
test('review control and delivery estimate inputs have strict contracts', () => {
  assert(adminProductSettingsBodySchema.safeParse({ productReviewsEnabled: false }).success);
  assert.equal(adminProductSettingsBodySchema.safeParse({ productReviewsEnabled: 'false' }).success, false);
  assert(createReviewSchema.safeParse({ componentId: 'product-id', rating: 5, title: 'Useful' }).success);
  assert.equal(createReviewSchema.safeParse({ componentId: 'product-id', rating: 6 }).success, false);
  assert.equal(deliveryDays('4'), 4);
  assert.equal(deliveryDays('3 - 5'), 5);
  assert.equal(deliveryDays('unknown'), null);
  assert.deepEqual(summarizeDeliveryRates('400001', [
    { courier_name: 'One', courier_id: 1, rate: 50, estimated_delivery_days: '3' },
    { courier_name: 'Two', courier_id: 2, rate: 60, estimated_delivery_days: '4 - 6' },
  ]), { pincode: '400001', serviceable: true, minDays: 3, maxDays: 6, courierCount: 2 });
  assert.deepEqual(summarizeDeliveryRates('400001', []), { pincode: '400001', serviceable: false, minDays: null, maxDays: null, courierCount: 0 });
});

const information = {
  specifications: [{ label: 'Interface', value: 'I2C' }, { label: 'Resolution', value: '128 × 64' }],
  countryOfOrigin: 'Supplier-confirmed country',
  warranty: 'Product-specific coverage.\nSee supplier documentation.',
};
test('product details validate JSON, multipart and API payloads without losing fields', () => {
  const multipart = { ...information, specifications: JSON.stringify(information.specifications) };
  assert.deepEqual(parseProductDetails(multipart), information);
  const created = validateCreateComponent({ name: 'OLED display', unitPriceCents: 10000, ...information });
  assert(created.success);
  assert.deepEqual(created.data.specifications, information.specifications);
  assert.equal(created.data.countryOfOrigin, information.countryOfOrigin);
  assert.equal(created.data.warranty, information.warranty);
  assert.deepEqual(validateUpdateComponent(multipart).data, information);
});
test('malformed, duplicate and oversized specifications fail cleanly before saving', () => {
  for (const specifications of ['{broken', null, {}, [{ label: 'Voltage' }], [{ label: ' ', value: '5V' }],
    [{ label: 'Voltage', value: '5V' }, { label: ' voltage ', value: '3.3V' }],
    [{ label: 'Voltage', value: '5V', unrecognized: true }],
    Array.from({ length: 101 }, (_, index) => ({ label: 'Parameter ' + index, value: 'value' })),
  ]) {
    assert.equal(productDetailsSchema.safeParse({ specifications }).success, false);
    assert.equal(validateUpdateComponent({ specifications }).success, false);
  }
  assert.equal(productDetailsSchema.safeParse({ countryOfOrigin: 'x'.repeat(101) }).success, false);
  assert.equal(productDetailsSchema.safeParse({ warranty: 'x'.repeat(10001) }).success, false);
});
test('optional details preserve omitted fields, clear explicit blanks, and support CSV round trips', () => {
  assert.deepEqual(parseProductDetails({}), {});
  assert.deepEqual(validateUpdateComponent({ specifications: [], countryOfOrigin: '', warranty: null }).data, { specifications: [], countryOfOrigin: null, warranty: null });
  const csv = ['name,unitPrice,specifications,countryOfOrigin,warranty', ['OLED display', '100', JSON.stringify(information.specifications), information.countryOfOrigin, information.warranty].map(csvCell).join(',')].join('\n');
  const [row] = parseProductCsv(csv);
  assert.deepEqual(parseProductDetails(row.data), information);
  assert.deepEqual(parseProductDetails(parseProductCsv('name,unitPrice,specifications,countryOfOrigin,warranty\nOLED display,100,,,')[0].data), { specifications: [], countryOfOrigin: null, warranty: null });
  assert.deepEqual(parseProductDetails(parseProductCsv('name,unitPrice\nOLED display,100')[0].data), {});
});

// Exercise persistence and the admin edit mapping without contacting a database or API.
const mock = {};
globalThis.__productInformationPrisma = mock;
const bundled = await build({
  stdin: { contents: "export * from './src/features/components/services/component.service.ts'; export * from '../admin-frontend/lib/api/products.ts'; export * from '../admin-frontend/utils/index.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-product-information', setup(builder) {
    builder.onResolve({ filter: /lib\/prisma\.js$/ }, () => ({ path: 'prisma', namespace: 'product-information-test' }));
    builder.onResolve({ filter: /^\.\/client$/ }, () => ({ path: 'client', namespace: 'product-information-test' }));
    builder.onResolve({ filter: /^@\/utils$/ }, () => ({ path: fileURLToPath(new URL('../../admin-frontend/utils/index.ts', import.meta.url)) }));
    builder.onLoad({ filter: /.*/, namespace: 'product-information-test' }, ({ path }) => ({ contents: path === 'prisma' ? 'export const prisma = globalThis.__productInformationPrisma;' : 'export async function apiFetch() { throw new Error("Unexpected API call in test"); }', loader: 'js' }));
  } }],
});
const contract = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
test('admin create/edit/clear round trip persists and returns all product tab fields', async () => {
  let stored, writes = 0;
  mock.component = {
    findUnique: async query => query.where.id ? stored : null,
    create: async query => { writes++; stored = { id: 'product-test', createdAt: new Date(), updatedAt: new Date(), ...query.data }; return stored; },
    update: async query => { writes++; stored = { ...stored, ...query.data }; return stored; },
  };
  const product = await contract.createComponent({ name: 'OLED display', unitPriceCents: 10000, ...information });
  assert.deepEqual(product.specifications, information.specifications);
  const form = contract.productToForm(product);
  form.specifications[0].value = 'SPI';
  assert.equal(product.specifications[0].value, 'I2C', 'editing must not mutate cached product data');
  const edited = await contract.updateComponent(product.id, contract.buildProductPayload(form));
  assert.equal(edited.specifications[0].value, 'SPI');
  assert.equal(edited.countryOfOrigin, information.countryOfOrigin);
  assert.equal(edited.warranty, information.warranty);
  const unchanged = await contract.updateComponent(product.id, { description: 'Updated overview' });
  assert.equal(unchanged.specifications[0].value, 'SPI');
  const cleared = await contract.updateComponent(product.id, contract.buildProductPayload({ ...contract.productToForm(unchanged), specifications: [], countryOfOrigin: '', warranty: '' }));
  assert.deepEqual(cleared.specifications, []);
  assert.equal(cleared.countryOfOrigin, null);
  assert.equal(cleared.warranty, null);
  const count = writes;
  await assert.rejects(contract.updateComponent(product.id, { specifications: [{ label: '', value: 'Invalid' }] }));
  await assert.rejects(contract.createComponent({ name: 'Invalid details', unitPriceCents: 1000, specifications: 'not JSON' }));
  assert.equal(writes, count, 'invalid details must not reach a database write');
});

const reviewMock = {};
globalThis.__productReviewPrisma = reviewMock;
const reviewBundle = await build({
  stdin: { contents: "export * from './src/features/reviews/services/review.service.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-review-control', setup(builder) {
    builder.onResolve({ filter: /lib\/prisma\.js$/ }, () => ({ path: 'prisma', namespace: 'review-control-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'review-control-test' }, () => ({ contents: 'export const prisma = globalThis.__productReviewPrisma;', loader: 'js' }));
  } }],
});
const reviewContract = await import('data:text/javascript;base64,' + Buffer.from(reviewBundle.outputFiles[0].text).toString('base64'));
test('paused reviews hide saved feedback and block new submissions before product writes', async () => {
  let reviewReads = 0, componentReads = 0;
  reviewMock.storeSetting = { findUnique: async () => ({ productReviewsEnabled: false }) };
  reviewMock.review = { findMany: async () => { reviewReads++; return []; } };
  reviewMock.component = { findUnique: async () => { componentReads++; return { id: 'product-id' }; } };
  const hidden = await reviewContract.getComponentReviews('product-id', 1, 5);
  assert.equal(hidden.enabled, false);
  assert.equal(reviewReads, 0);
  await assert.rejects(reviewContract.createReview('user-id', 'product-id', 5), /paused/);
  assert.equal(componentReads, 0);
  reviewMock.storeSetting.findUnique = async () => ({ productReviewsEnabled: true });
  await reviewContract.assertReviewsEnabled();
});
