import 'dotenv/config';
import pg from 'pg';
import { readdir } from 'node:fs/promises';
import { GetBucketCorsCommand, GetBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import { getR2Client, r2Bucket } from '../src/services/r2-storage.service.js';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15_000, statement_timeout: 15_000 });
try {
  await db.connect();
  await db.query('BEGIN READ ONLY');
  const migrations = await db.query('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at');
  const applied = new Set(migrations.rows.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name));
  const local = (await readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  const pending = local.filter(name => !applied.has(name));
  const unresolved = migrations.rows.filter(row => !row.finished_at && !row.rolled_back_at).map(row => row.migration_name);
  const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('StudioProject','StudioAsset','StudioInvite','StudioGuestSession') ORDER BY table_name");
  const products = await db.query(`SELECT name, configuration FROM "Component" WHERE "isActive"=true AND configuration->>'format' IN ('album','book') AND configuration->>'allowPhotoUpload'='true'`);
  console.log(JSON.stringify({ database: new URL(process.env.DATABASE_URL!).pathname.slice(1), pending, unresolved, tables: tables.rows.map(row => row.table_name), albums: products.rows.map(row => ({ name: row.name, groups: row.configuration.groups.map((group: { kind: string }) => group.kind) })) }, null, 2));
  await db.query('ROLLBACK');
  const Bucket = r2Bucket('private'); const client = getR2Client();
  const cors = await client.send(new GetBucketCorsCommand({ Bucket }), { abortSignal: AbortSignal.timeout(20_000) });
  const lifecycle = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket }), { abortSignal: AbortSignal.timeout(20_000) });
  console.log(JSON.stringify({ privateStorageCors: cors.CORSRules, stagingCleanup: lifecycle.Rules?.filter(rule => rule.Filter?.Prefix === 'staging/') }, null, 2));
} catch (error) { console.error('Studio readiness check failed:', error instanceof Error ? error.name : 'Unknown error'); process.exitCode = 1; }
finally { await db.end(); getR2Client().destroy(); }
