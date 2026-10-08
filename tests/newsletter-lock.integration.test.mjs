import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { acquireNewsletterLock } from '../src/features/contact/newsletter-lock.ts';

// Opt-in: connects to the configured DB, but creates no records and sends no mail.
test('Prisma executes the newsletter lock without deserializing void and releases it on commit', {
  skip: process.env.CONTACT_DATABASE_TEST !== '1',
}, async () => {
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await import('../src/generated/prisma/client.ts');
  const prisma = new PrismaClient({ adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    max: 2,
  }) });
  const email = `lock-regression-${randomUUID()}@example.invalid`;
  const key = `newsletter:${email}`;
  try {
    await prisma.$transaction(async tx => {
      await acquireNewsletterLock(tx, email);
      await prisma.$transaction(async other => {
        const [same] = await other.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired`;
        assert.equal(same.acquired, false, 'another transaction must not acquire the same address lock');
        const [different] = await other.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${`${key}:different`})) AS acquired`;
        assert.equal(different.acquired, true, 'unrelated addresses should remain independent');
      });
    }, { timeout: 15000 });
    await prisma.$transaction(async tx => {
      const [released] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired`;
      assert.equal(released.acquired, true, 'the transaction lock must be released on commit');
    });
  } finally { await prisma.$disconnect(); }
});
