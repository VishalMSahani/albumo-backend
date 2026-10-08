import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createBulkOrderSchema, quoteSchema } from '../src/features/bulk-orders/validators/bulk-order.validator.ts';

// All writes, including the email outbox, stay uncommitted and are rolled back.
// No worker can see these notifications and no mail delivery code is imported.
test('real PostgreSQL request, quotation, access and fulfilment lifecycle (rolled back)', { skip: process.env.BULK_DATABASE_TEST !== '1' }, async () => {
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await import('../src/generated/prisma/client.ts');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, max: 2 }) });
  const bundle = await build({ stdin: { contents: "export * from './src/features/bulk-orders/bulk-order.service.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'transaction-only', setup(builder) {
      builder.onResolve({ filter: /lib\/prisma\.js$/ }, ({ path }) => ({ path, namespace: 'bulk-db-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'bulk-db-test' }, () => ({ loader: 'js', contents: 'export const prisma = new Proxy({}, {get: (_, key) => key === "$transaction" ? input => typeof input === "function" ? input(globalThis.__bulkTx) : Promise.all(input) : globalThis.__bulkTx[key] });' }));
    } }],
  });
  const service = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const rollback = new Error('ROLLBACK_TEST'); const input = createBulkOrderSchema.parse({ name: 'Rollback Test', email: `bulk-${randomUUID()}@example.invalid`, phone: '9876543210', postalCode: '110001', deliveryAddress: 'Test address for rollback only', consent: true, requestKey: randomUUID(), accessKey: 'a'.repeat(64), items: [{ name: 'Arduino Uno', quantity: 20 }] });
  try {
    await assert.rejects(db.$transaction(async tx => {
      globalThis.__bulkTx = tx;
      const row = await service.createRequest(input);
      assert.equal((await service.createRequest(input)).id, row.id);
      await assert.rejects(service.trackRequest(row.reference, { accessKey: 'b'.repeat(64) }), /not found/i);
      const tracked = await service.trackRequest(row.reference, { accessKey: input.accessKey });
      for (const key of ['accessKeyHash', 'adminNotes', 'requestKey', 'userId']) assert.equal(key in tracked, false);
      const draft = quoteSchema.parse({ expectedVersion: row.version, items: [{ name: 'Arduino Uno', quantity: 20, unitPriceCents: 45000, taxBasisPoints: 1800 }], shippingCents: 5000, validUntil: new Date(Date.now() + 86400000).toISOString(), leadTime: 'After payment is arranged', terms: 'Quotation test; no payment is collected.' });
      const quoted = await service.publishQuote(row.id, draft, 'rollback-admin');
      assert.equal(quoted.quotes[0].totalCents, 1067000);
      await assert.rejects(service.publishQuote(row.id, draft, 'rollback-admin'), /changed in another session/);
      const revised = await service.publishQuote(row.id, { ...draft, expectedVersion: quoted.version }, 'rollback-admin');
      await assert.rejects(service.decideQuote(row.reference, { accessKey: input.accessKey }, quoted.quotes[0].id, 'ACCEPTED'), /no longer current/);
      const accepted = await service.decideQuote(row.reference, { accessKey: input.accessKey }, revised.quotes[0].id, 'ACCEPTED');
      assert.equal(accepted.status, 'ACCEPTED');
      assert.equal((await service.decideQuote(row.reference, { accessKey: input.accessKey }, revised.quotes[0].id, 'ACCEPTED')).version, accepted.version);
      await assert.rejects(service.publishQuote(row.id, { ...draft, expectedVersion: accepted.version }, 'rollback-admin'), /cannot be repriced/);
      const fulfilment = await service.updateRequest(row.id, { expectedVersion: accepted.version, status: 'IN_FULFILLMENT', adminNotes: 'Private test note' });
      const done = await service.updateRequest(row.id, { expectedVersion: fulfilment.version, status: 'COMPLETED' }); assert.equal(done.status, 'COMPLETED');
      const reply = await service.addMessage(row.reference, 'Customer question', { accessKey: input.accessKey }); assert.equal(reply.messages.at(-1).body, 'Customer question');
      await service.recoverAccess(row.reference, input.email);
      await assert.rejects(service.trackRequest(row.reference, { accessKey: input.accessKey }), /not found/i);
      const notification = await tx.emailNotification.findFirst({ where: { email: input.email, eventType: 'BULK_ORDER_UPDATED' }, orderBy: { createdAt: 'desc' } });
      assert.ok(notification); assert.equal(notification.isSent, false);
      throw rollback;
    }, { timeout: 45000 }), error => error === rollback);
    assert.equal(await db.bulkOrderRequest.count({ where: { requestKey: input.requestKey } }), 0);
    assert.equal(await db.emailNotification.count({ where: { email: input.email } }), 0);
  } finally { delete globalThis.__bulkTx; await db.$disconnect(); }
});
