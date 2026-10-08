import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteTotals, assertTransition, assertQuoteDecision, parseBulkCsv } from '../src/features/bulk-orders/bulk-order.logic.ts';
import { createBulkOrderSchema, quoteSchema } from '../src/features/bulk-orders/validators/bulk-order.validator.ts';
import { bulkOrderTemplate } from '../src/utils/emailTemplates/bulkOrder.ts';

test('quotation totals use integer paise and round tax per line', () => {
  assert.deepEqual(quoteTotals({ items: [{ quantity: 3, unitPriceCents: 999, taxBasisPoints: 1800 }, { quantity: 2, unitPriceCents: 101, taxBasisPoints: 500 }], shippingCents: 1500 }), { subtotalCents: 3199, taxCents: 549, totalCents: 5248 });
  assert.throws(() => quoteTotals({ items: [], shippingCents: 0 }));
  assert.throws(() => quoteTotals({ items: [{ quantity: 100000, unitPriceCents: 100000000, taxBasisPoints: 0 }], shippingCents: 0 }));
});
test('CSV handles quoted commas and validates template columns and limits', () => {
  const rows = parseBulkCsv('Component Name,SKU,Quantity,Target Price (INR),Notes\n"Board, Uno",UNO,10,450.25,"Classroom, pack"');
  assert.equal(rows[0].name, 'Board, Uno'); assert.equal(rows[0].targetPriceCents, 45025);
  for (const csv of ['name,quantity\nBoard,-2', 'name,quantity\nBoard,2.5', 'name,quantity,price\nBoard,2,5', 'name,name,quantity\nBoard,Board,2', 'name,quantity\nBoard,0', 'name,quantity\n' + 'Board,1\n'.repeat(101)]) assert.throws(() => parseBulkCsv(csv));
});
test('workflow cannot bypass customer approval or resurrect a closed request', () => {
  assertTransition('SUBMITTED', 'REVIEWING'); assertTransition('ACCEPTED', 'IN_FULFILLMENT'); assertTransition('IN_FULFILLMENT', 'COMPLETED');
  for (const [from, to] of [['SUBMITTED', 'COMPLETED'], ['QUOTED', 'ACCEPTED'], ['CANCELLED', 'REVIEWING'], ['COMPLETED', 'IN_FULFILLMENT']]) assert.throws(() => assertTransition(from, to));
});
test('only current, unexpired quotations accept decisions', () => {
  const now = new Date('2026-10-08T00:00:00Z'); const future = new Date('2026-10-09T00:00:00Z');
  assertQuoteDecision('QUOTED', 'latest', 'latest', future, now);
  assert.throws(() => assertQuoteDecision('QUOTED', 'latest', 'old', future, now));
  assert.throws(() => assertQuoteDecision('QUOTED', 'latest', 'latest', now, now));
  assert.throws(() => assertQuoteDecision('ACCEPTED', 'latest', 'latest', future, now));
});
test('request validation enforces consent, item bounds, delivery and private access keys', () => {
  const input = { name: 'Test Maker', email: 'MAKER@example.test', phone: '9876543210', postalCode: '110001', deliveryAddress: 'Test classroom, New Delhi', consent: true, requestKey: '23702635-2aa8-47a5-abee-bc7875d2b281', accessKey: 'a'.repeat(64), items: [{ name: 'Arduino Uno', quantity: 20 }] };
  assert.equal(createBulkOrderSchema.parse(input).email, 'maker@example.test');
  for (const patch of [{ consent: false }, { postalCode: '000000' }, { phone: 'invalid' }, { accessKey: 'short' }, { website: 'spam' }, { items: [] }, { items: [{ name: 'Uno', quantity: 0 }] }]) assert.equal(createBulkOrderSchema.safeParse({ ...input, ...patch }).success, false);
  assert.equal(quoteSchema.safeParse({}).success, false);
});
test('notification template escapes customer-controlled content', () => {
  const template = bulkOrderTemplate({ reference: '<script>', message: '<img src=x>', url: 'https://example.test/?a="bad"' });
  assert.ok(!template.html.includes('<script>')); assert.ok(!template.html.includes('<img src=x>'));
});
