// Real PostgreSQL + real Studio routes/services. Only account authentication is a fixture.
// Never imports backend/lib/prisma or loads .env / the configured database.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import express from 'express';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { csrfProtection } from '../src/middlewares/csrf.middleware.ts';
import { createStudioProjectSchema, updateStudioProjectSchema } from '../src/features/studio/projects/project.schema.ts';
import sharp from 'sharp';
import { processPhoto } from '../src/features/studio/media.ts';

const bin = process.env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '/usr/lib/postgresql/18/bin');
const executable = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
let temporary, dataDirectory, started = false, db, server, origin;
let processNextPhoto, expireUploads, purgeTrashedAlbums, pruneRetainedExtras, assessPrint, operationMonitor;
const objects = new Map();
const productId = 'clalbumoproduct000000000001';
const configuration = { format: 'album', personalizationEnabled: true, allowPhotoUpload: true, allowText: true, instructions: '', productionDays: 7,
  groups: ['dimension','cover','paper','pages'].map(kind => ({ id: kind, kind, label: kind, required: true, defaultOptionId: 'choice', options: [{ id: 'choice', label: kind === 'pages' ? '20 pages' : kind, ...(kind === 'dimension' ? { width: 8, height: 8, unit: 'in' } : {}) }] })) };
const selection = { productId, choices: { dimension: 'choice', cover: 'choice', paper: 'choice', pages: 'choice' }, quantity: 2, personalText: 'Our summer' };
const csrf = 'a'.repeat(64);
const oldCsrf = process.env.CSRF_ENABLED;
function command(name, args) {
  const result = spawnSync(executable(name), args, { windowsHide: true, stdio: 'ignore', timeout: 30_000 });
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.error || result.stdout}`);
}
before(async () => {
  assert(existsSync(executable('initdb')), 'Install local PostgreSQL or set PG_BIN to run isolated Studio tests.');
  temporary = await mkdtemp(path.join(tmpdir(), 'albumo-studio-test-'));
  dataDirectory = path.join(temporary, 'data');
  const finder = createServer();
  await new Promise(resolve => finder.listen(0, '127.0.0.1', resolve));
  const port = finder.address().port;
  await new Promise(resolve => finder.close(resolve));
  command('initdb', ['-D', dataDirectory, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  command('pg_ctl', ['-D', dataDirectory, '-l', path.join(temporary, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -F -c shared_buffers=16MB -c max_connections=30`, '-w', 'start']);
  started = true;
  const connectionString = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  const sql = new pg.Client({ connectionString });
  await sql.connect();
  try {
    await sql.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "name" TEXT, "email" TEXT)');
    await sql.query('INSERT INTO "User" ("id") VALUES ($1), ($2)', ['owner-a', 'owner-b']);
    await sql.query(await readFile(new URL('../prisma/migrations/20261022150000_studio_projects/migration.sql', import.meta.url), 'utf8'));
    await sql.query(await readFile(new URL('../prisma/migrations/20261023010000_studio_collection/migration.sql', import.meta.url), 'utf8'));
    await sql.query(`CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT','PAID','PROCESSING','PACKED','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','RETURN_REQUESTED','RETURNED','REFUND_INITIATED','REFUNDED','CANCELLED');
      CREATE TABLE "Order" ("id" TEXT PRIMARY KEY, "userId" TEXT, "status" "OrderStatus", "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, "deliveredAt" TIMESTAMPTZ);
      CREATE TABLE "OrderItem" ("id" TEXT PRIMARY KEY, "orderId" TEXT REFERENCES "Order"("id"), "itemType" TEXT DEFAULT 'COMPONENT', "kitId" TEXT, "componentId" TEXT,
      "description" TEXT DEFAULT 'Album', "quantity" INTEGER DEFAULT 2, "unitPriceCents" INTEGER DEFAULT 1000, "subtotalCents" INTEGER DEFAULT 2000, "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`);
    await sql.query(await readFile(new URL('../prisma/migrations/20261023180000_studio_admin/migration.sql', import.meta.url), 'utf8'));
    await sql.query(`UPDATE "User" SET "name"='Test owner', "email"="id" || '@example.test'`);
    await sql.query(`CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED','CLOSED'); CREATE TABLE "SupportTicket" ("id" TEXT PRIMARY KEY, "orderId" TEXT, "status" "SupportTicketStatus")`);
    await sql.query('CREATE TABLE "Component" ("id" TEXT PRIMARY KEY, "name" TEXT, "isActive" BOOLEAN, "configuration" JSONB)');
    await sql.query('INSERT INTO "Component" VALUES ($1,$2,true,$3)', [productId, 'Everyday album', JSON.stringify(configuration)]);
    await sql.query('CREATE TABLE "Cart" ("id" TEXT PRIMARY KEY, "userId" TEXT UNIQUE, "updatedAt" TIMESTAMPTZ NOT NULL)');
    await sql.query(await readFile(new URL('../prisma/migrations/20261024010000_studio_checkout/migration.sql', import.meta.url), 'utf8'));
    await sql.query(await readFile(new URL('../prisma/migrations/20261024180000_studio_trash/migration.sql', import.meta.url), 'utf8'));
    await sql.query(await readFile(new URL('../prisma/migrations/20261026010000_studio_operations/migration.sql', import.meta.url), 'utf8'));

  } finally { await sql.end(); }
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  globalThis.__studioTestPrisma = db;
  globalThis.__studioTestObjects = objects;
  process.env.STUDIO_WORKER_TEST = '1';
  const built = await build({ stdin: { contents: "export {default} from './src/features/studio/projects/project.routes.ts'; export {guestCollectionRoutes} from './src/features/studio/collection.routes.ts'; export {default as adminRoutes} from './src/features/studio/admin.routes.ts'; export {processNextPhoto,expireUploads} from './src/workers/studio-media-worker.ts'; export {purgeTrashedAlbums} from './src/features/studio/trash.ts'; export {pruneRetainedExtras,operationMonitor} from './src/features/studio/maintenance.ts'; export {assessPrint} from './src/features/studio/print-quality.ts';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
    plugins: [{ name: 'isolated-studio', setup(builder) {
      builder.onResolve({ filter: /lib\/prisma\.js$/ }, () => ({ path: 'prisma', namespace: 'fixture' }));
      builder.onResolve({ filter: /auth\.middleware\.js$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      builder.onResolve({ filter: /r2-storage\.service\.js$/ }, () => ({ path: 'storage', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path === 'prisma'
        ? 'export const prisma = globalThis.__studioTestPrisma;'
        : path === 'storage' ? `import {Readable} from 'node:stream'; const objects=globalThis.__studioTestObjects;
          export async function prepareStagedPut(key) { return {uploadUrl:'https://upload.invalid/'+key,headers:{'Content-Type':'application/octet-stream'}}; }
          export async function privateDownloadUrl(key) { return 'https://private.invalid/'+key; }
          export async function openStagedObject(key,size) { const bytes=objects.get(key);if(!bytes || bytes.length!==size) throw new Error('Bad size');return Readable.from([bytes]); }
          export async function putR2Object(key,bytes) { if(objects.has(key)) throw Object.assign(new Error('exists'),{$metadata:{httpStatusCode:412}});objects.set(key,bytes); }
          export async function deleteR2Object(key) { if(globalThis.__studioFailDeleteKey === key) throw new Error('storage unavailable'); objects.delete(key); }`
        : `export function authenticate(req,res,next) { const userId=req.headers['x-fixture-owner']; if(!['owner-a','owner-b','admin-a','super-a'].includes(userId)) return res.status(401).json({success:false,code:'UNAUTHORIZED'}); req.user={userId,role:userId==='admin-a'?'ADMIN':userId==='super-a'?'SUPER_ADMIN':'CUSTOMER'}; next(); } export function authorize() { return (req,res,next) => { if(!['ADMIN','SUPER_ADMIN'].includes(req.user.role)) return res.status(403).json({success:false,code:'FORBIDDEN'}); next(); }; }` }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  ({ processNextPhoto, expireUploads, purgeTrashedAlbums, pruneRetainedExtras, assessPrint, operationMonitor } = module.exports);
  process.env.CSRF_ENABLED = 'true';
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/studio/guest', module.exports.guestCollectionRoutes);
  app.use(csrfProtection);
  app.use('/api/studio/projects', module.exports.default);
  app.use('/api/admin/studio', module.exports.adminRoutes);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}/api/studio/projects`;
}, { timeout: 90_000 });
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (db) await db.$disconnect();
  delete globalThis.__studioTestPrisma;
  delete globalThis.__studioTestObjects;
  delete process.env.STUDIO_WORKER_TEST;
  if (oldCsrf === undefined) delete process.env.CSRF_ENABLED; else process.env.CSRF_ENABLED = oldCsrf;
  if (started) command('pg_ctl', ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']);
  if (temporary) {
    const target = path.resolve(temporary);
    assert(path.dirname(target) === path.resolve(tmpdir()) && path.basename(target).startsWith('albumo-studio-test-'));
    await rm(target, { recursive: true, force: true });
  }
});
async function request(route = '', { owner = 'owner-a', method = 'GET', body, withCsrf = true } = {}) {
  const response = await fetch(origin + route, { method, headers: {
    'content-type': 'application/json', 'x-fixture-owner': owner,
    ...(withCsrf ? { cookie: `csrf_token=${csrf}`, 'x-csrf-token': csrf } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, cache: response.headers.get('cache-control'), ...(await response.json()) };
}
const input = overrides => ({ title: 'Our little life', occasion: 'EVERYDAY', requestId: randomUUID(), ...overrides });
const create = body => request('', { method: 'POST', body: body || input() });

test('strict validation rejects ownership injection, bad titles, format/price fields and missing revisions', () => {
  for (const body of [input({ ownerId: 'owner-b' }), input({ title: '  ' }), input({ title: 'x'.repeat(121) }), input({ title: 'a\u0000b' }), input({ price: 1 }), input({ occasion: 'INVALID' })]) assert.equal(createStudioProjectSchema.safeParse(body).success, false);
  for (const body of [{ title: 'New' }, { baseRevision: 1 }, { baseRevision: 0, archived: true }, { baseRevision: 1, ownerId: 'owner-b' }]) assert.equal(updateStudioProjectSchema.safeParse(body).success, false);
});
test('all routes need a session and writes require the existing CSRF token', async () => {
  assert.equal((await request('', { owner: '' })).status, 401);
  assert.equal((await request('', { method: 'POST', body: input(), withCsrf: false })).status, 403);
  assert.equal((await request('', { method: 'POST', body: input(), owner: '' })).status, 401);
});
test('concurrent create retries produce exactly one row and do not expose owner/request metadata', async () => {
  const body = input();
  const responses = await Promise.all([create(body), create(body)]);
  for (const response of responses) assert.equal(response.status, 201, JSON.stringify(response));
  assert.equal(responses[0].data.id, responses[1].data.id);
  assert.equal(await db.studioProject.count({ where: { ownerId: 'owner-a', requestId: body.requestId } }), 1);
  assert.equal(responses[0].data.revision, 1);
  assert(!('requestHash' in responses[0].data)); assert(!('ownerId' in responses[0].data));
  assert.equal(responses[0].cache, 'private, no-store');
  assert.equal((await create({ ...body, title: 'Different payload' })).status, 409);
  const other = await request('', { owner: 'owner-b', method: 'POST', body });
  assert.equal(other.status, 201); assert.notEqual(other.data.id, responses[0].data.id);
});
test('other users cannot read, update, archive or use a foreign project as a pagination cursor', async () => {
  const { data } = await create();
  for (const action of [
    request('/' + data.id, { owner: 'owner-b' }),
    request('/' + data.id, { owner: 'owner-b', method: 'PATCH', body: { baseRevision: 1, title: 'Intruder' } }),
    request('/' + data.id, { owner: 'owner-b', method: 'PATCH', body: { baseRevision: 1, archived: true } }),
    request('?after=' + data.id, { owner: 'owner-b' }),
  ]) assert.equal((await action).status, 404);
  const list = await request('', { owner: 'owner-b' });
  assert(!list.data.items.some(row => row.id === data.id));
  assert.equal((await request('/' + data.id)).data.title, data.title);
});
test('real concurrent updates with one base revision have one winner and one conflict', async () => {
  const { data } = await create();
  const responses = await Promise.all(['First tab', 'Second tab'].map(title => request('/' + data.id, { method: 'PATCH', body: { baseRevision: data.revision, title } })));
  assert.deepEqual(responses.map(value => value.status).sort(), [200, 409]);
  assert.equal((await request('/' + data.id)).data.revision, 2);
  assert.equal(responses.find(value => value.status === 409).code, 'STUDIO_REVISION_CONFLICT');
});
test('archive and restore retain the same album and require current revisions', async () => {
  const { data } = await create();
  const archived = await request('/' + data.id, { method: 'PATCH', body: { baseRevision: 1, archived: true } });
  assert.equal(archived.status, 200); assert(archived.data.archivedAt);
  assert(!(await request()).data.items.some(row => row.id === data.id));
  assert((await request('?archived=true')).data.items.some(row => row.id === data.id));
  assert.equal((await request('/' + data.id, { method: 'PATCH', body: { baseRevision: 1, archived: false } })).status, 409);
  const restored = await request('/' + data.id, { method: 'PATCH', body: { baseRevision: 2, archived: false } });
  assert.equal(restored.data.archivedAt, null); assert.equal(restored.data.id, data.id); assert.equal(restored.data.revision, 3);
});
test('pagination is bounded, stable and has no repeated IDs', async () => {
  for (let i = 0; i < 3; i++) await create(input({ title: `Pagination ${i}` }));
  const first = await request('?limit=2');
  const second = await request('?limit=2&after=' + first.data.nextCursor);
  assert.equal(first.data.items.length, 2); assert.equal(second.data.items.length, 2);
  assert.equal(new Set([...first.data.items, ...second.data.items].map(row => row.id)).size, 4);
  assert.equal((await request('?limit=51')).status, 400);
  assert.equal((await request('?archived=no')).status, 400);
});
test('invalid or missing project IDs return structured errors without leaking data', async () => {
  assert.equal((await request('/invalid')).status, 400);
  assert.equal((await request('/' + randomUUID())).status, 404);
});

async function guest(route, { token, method = 'GET', body } = {}) {
  const response = await fetch(origin.replace('/projects', '/guest') + route, { method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'StudioGuest ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, ...(await response.json()) };
}
const configured = () => create(input({ selection }));

async function admin(route = '', { owner = 'admin-a', method = 'GET', body, withCsrf = true } = {}) {
  const response = await fetch(origin.replace('/studio/projects', '/admin/studio') + route, { method, headers: {
    'content-type': 'application/json', 'x-fixture-owner': owner,
    ...(withCsrf ? { cookie: `csrf_token=${csrf}`, 'x-csrf-token': csrf } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, cache: response.headers.get('cache-control'), ...(await response.json()) };
}
async function designed() {
  const { data: project } = await configured();
  const assets = Array.from({ length: 26 }, () => ({ id: randomUUID(), projectId: project.id, requestId: randomUUID(), uploaderKey: 'owner:owner-a', filename: 'memory.jpg', mimeType: 'image/jpeg', byteSize: 100, status: 'READY', stagingKey: 'fixture/' + randomUUID(), originalKey: 'private/original', previewKey: 'private/preview', expiresAt: new Date(Date.now()+60_000) }));
  await db.studioAsset.createMany({ data: assets });
  const document = { version: 1, template: 'everyday', cover: { title: 'Saved album', photo: { assetId: assets[0].id, x: 50, y: 50 } }, pages: Array.from({ length: 20 }, (_, i) => ({ id: randomUUID(), layout: 'full', caption: '', photos: [{ assetId: assets[i].id, x: 50, y: 50 }] })) };
  assert.equal((await request('/' + project.id + '/design', { method: 'PUT', body: { baseRevision: 1, document } })).status, 200);
  return { project, assets, document };
}
const reviewAlbum = (id, baseRevision = 2) => admin('/' + id + '/actions', { method: 'POST', body: { action: 'review', status: 'REVIEWED', baseRevision, note: 'Checked every page.' } });
async function orderFixture({ owner = 'owner-a', product = productId, quantity = 2, status = 'PAID' } = {}) {
  const orderId = randomUUID(), itemId = randomUUID();
  await db.$executeRaw`INSERT INTO "Order" ("id","userId","status") VALUES (${orderId},${owner},${status}::"OrderStatus")`;
  await db.$executeRaw`INSERT INTO "OrderItem" ("id","orderId","componentId","quantity") VALUES (${itemId},${orderId},${product},${quantity})`;
  return { orderId, itemId };
}

test('Studio administration requires an admin session and CSRF; owner APIs retain ownership checks', async () => {
  const { data: p } = await configured();
  assert.equal((await admin('', { owner: '' })).status, 401);
  for (const suffix of ['', '/' + p.id, '/' + p.id + '/photos', '/' + p.id + '/design', '/' + p.id + '/activity', '/' + p.id + '/orders']) {
    assert.equal((await admin(suffix, { owner: 'owner-a' })).status, 403);
  }
  assert.equal((await admin('', { owner: 'super-a' })).status, 200);
  assert.equal((await request('/' + p.id, { owner: 'admin-a' })).status, 404);
  const action = { action: 'archive', archived: true, baseRevision: 1, note: 'Support archive.' };
  assert.equal((await admin('/' + p.id + '/actions', { method: 'POST', body: action, withCsrf: false })).status, 403);
  assert.equal((await admin('/' + p.id + '/actions', { method: 'POST', body: { ...action, ownerId: 'owner-b' } })).status, 400);
});

test('admin album search, private photo pagination and downloads do not expose storage internals', async () => {
  const { project: p, assets } = await designed();
  const result = await admin('?search=' + p.id + '&limit=1');
  assert.equal(result.status, 200); assert.equal(result.data.total, 1); assert.equal(result.data.items[0].owner.id, 'owner-a');
  assert.equal(result.cache, 'private, no-store');
  assert.equal((await admin('?limit=501')).status, 400);
  const detail = await admin('/' + p.id); assert.equal(detail.data._count.assets, 26);
  const library = await admin('/' + p.id + '/photos');
  assert.equal(library.status, 200); assert(library.data.items[0].previewUrl);
  for (const key of ['stagingKey','originalKey','previewKey','uploaderKey','requestId','tokenHash']) assert(!JSON.stringify(library).includes('"' + key + '"'));
  const other = await designed();
  assert.equal((await admin('/' + p.id + '/photos?after=' + other.assets[0].id)).status, 404);
  assert.equal((await admin('/' + p.id + '/photos/' + other.assets[0].id + '/download', { method: 'POST', body: { note: 'Support check.' } })).status, 404);
  assert.equal((await admin('/' + p.id + '/photos/' + assets[0].id + '/download', { method: 'POST', body: { note: 'Support check.' } })).status, 200);
  const history = await admin('/' + p.id + '/activity'); assert.equal(history.data.items[0].action, 'download-original');
  assert.equal(history.data.items[0].actorId, 'admin-a');
});

test('review requires a complete saved design and stale reviews cannot attach orders', async () => {
  const empty = await configured(); assert.equal((await reviewAlbum(empty.data.id, 1)).status, 409);
  const { project: p, assets, document } = await designed();
  assert.equal((await reviewAlbum(p.id)).data.revision, 3);
  assert.equal((await admin('/' + p.id)).data.reviewCurrent, true);
  assert.equal((await reviewAlbum(p.id)).status, 409);
  const item = await orderFixture();
  const changed = { ...document, cover: { ...document.cover, title: 'Newer version' } };
  assert.equal((await request('/' + p.id + '/design', { method: 'PUT', body: { baseRevision: 3, document: changed } })).status, 200);
  assert.equal((await admin('/' + p.id)).data.reviewCurrent, false);
  assert.equal((await admin('/' + p.id + '/orders', { method: 'POST', body: { orderItemId: item.itemId, baseRevision: 4, note: 'Attach checked design.' } })).status, 409);
  assert.equal((await reviewAlbum(p.id, 4)).status, 200);
  await request('/' + p.id + '/photos/' + assets[25].id, { method: 'PATCH', body: { selected: false } });
  assert.equal((await admin('/' + p.id)).data.reviewCurrent, false);
});

test('admin photo selection protects saved design and archive revokes contributor capabilities', async () => {
  const { project: p, assets } = await designed();
  const action = body => admin('/' + p.id + '/actions', { method: 'POST', body: { baseRevision: 2, note: 'Support review.', ...body } });
  assert.equal((await action({ action: 'select-photo', assetId: assets[0].id, selected: false })).status, 409);
  assert.equal((await action({ action: 'select-photo', assetId: randomUUID(), selected: false })).status, 404);
  const invitation = (await request('/' + p.id + '/invites', { method: 'POST' })).data;
  const session = (await guest('/exchange', { method: 'POST', body: { inviteId: invitation.id, token: invitation.token, displayName: 'Friend' } })).data;
  assert.equal((await action({ action: 'archive', archived: true })).status, 200);
  assert.equal((await guest('/uploads', { token: session.token })).status, 403);
  assert.equal((await admin('/' + p.id)).data.activeInvites, 0);
  assert.equal((await admin('/' + p.id + '/actions', { method: 'POST', body: { action: 'archive', archived: false, baseRevision: 3, note: 'Restore collection.' } })).status, 200);
  assert.equal((await admin('/' + p.id)).data._count.assets, 26);
});

test('order attachment validates customer, product, quantity and open status, then freezes a replay-safe snapshot', async () => {
  const { project: p, document } = await designed(); await reviewAlbum(p.id);
  const attach = itemId => admin('/' + p.id + '/orders', { method: 'POST', body: { orderItemId: itemId, baseRevision: 3, note: 'Attach reviewed reference.' } });
  for (const [options, status] of [[{ owner: 'owner-b' },422], [{ product: 'other-product' },422], [{ quantity: 1 },422], [{ status: 'SHIPPED' },409]]) {
    assert.equal((await attach((await orderFixture(options)).itemId)).status, status);
  }
  const order = await orderFixture();
  const candidates = await admin('/' + p.id + '/orders'); assert.equal(candidates.status, 200, JSON.stringify(candidates)); assert(candidates.data.items.some(i => i.id === order.itemId));
  const responses = await Promise.all([attach(order.itemId), attach(order.itemId)]);
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response));
  assert.equal(responses[0].data.id, responses[1].data.id);
  assert.equal(await db.studioOrderLink.count({ where: { orderItemId: order.itemId } }), 1);
  assert.equal(await db.studioActivity.count({ where: { projectId: p.id, action: 'attach-order' } }), 1);
  await request('/' + p.id + '/design', { method: 'PUT', body: { baseRevision: 3, document: { ...document, template: 'travel' } } });
  const snapshot = await admin('/' + p.id + '/orders/' + responses[0].data.id);
  assert.equal(snapshot.data.document.template, 'everyday'); assert.equal(snapshot.data.printApproved, false);
  const other = await designed(); await reviewAlbum(other.project.id);
  assert.equal((await admin('/' + other.project.id + '/orders/' + responses[0].data.id)).status, 404);
  assert.equal((await admin('/' + other.project.id + '/orders', { method: 'POST', body: { orderItemId: order.itemId, baseRevision: 3, note: 'Cannot replace attachment.' } })).status, 409);
  const unchanged = await db.$queryRaw`SELECT "status" FROM "Order" WHERE "id"=${order.orderId}`;
  assert.equal(unchanged[0].status, 'PAID');
});
test('catalogue handoff is validated, snapshots options, and 20 pages require 24/26 photos', async () => {
  const result = await configured(); assert.equal(result.status, 201, JSON.stringify(result));
  assert.equal(result.data.pageCount, 20); assert.equal(result.data.minimumPhotos, 24); assert.equal(result.data.recommendedPhotos, 26);
  assert.equal(result.data.configuration.quantity, 2); assert.equal(result.data.configuration.options.length, 4);
  assert.equal((await create(input({ selection: { ...selection, choices: { ...selection.choices, pages: '999' } } }))).status, 422);
  assert.equal((await create(input({ selection: { ...selection, minimumPhotos: 1 } }))).status, 400);
  assert.equal((await request('/' + result.data.id + '/design')).status, 409);
  assert.equal((await request('/' + result.data.id + '/photos', { owner: 'owner-b' })).status, 404);
  const noPaper = 'clalbumoproduct000000000002';
  await db.$executeRaw`INSERT INTO "Component" ("id","name","isActive","configuration") VALUES (${noPaper},'Paper pending album',true,${JSON.stringify({ ...configuration, groups: configuration.groups.filter(group => group.kind !== 'paper') })}::jsonb)`;
  const paperPending = await create(input({ selection: { ...selection, productId: noPaper, choices: { dimension: 'choice', cover: 'choice', pages: 'choice' } } }));
  assert.equal(paperPending.status, 201); assert(!paperPending.data.configuration.options.some(option => option.kind === 'paper'));
});

test('QR capabilities permit uploads only; revoke/expire closes existing sessions', async () => {
  const { data: project } = await configured();
  const route = '/' + project.id;
  const { data: invite } = await request(route + '/invites', { method: 'POST', body: {} });
  assert.equal(invite.token.length, 64);
  const stored = await db.studioInvite.findUnique({ where: { id: invite.id } }); assert.notEqual(stored.tokenHash, invite.token);
  const exchanged = await guest('/exchange', { method: 'POST', body: { inviteId: invite.id, token: invite.token, displayName: 'Friend' } });
  assert.equal(exchanged.status, 200, JSON.stringify(exchanged)); const token = exchanged.data.token;
  assert.equal((await guest('/uploads')).status, 401);
  assert.equal((await request(route + '/photos', { owner: '' })).status, 401);
  const upload = { requestId: randomUUID(), filename: 'memory.jpg', byteSize: 20, mimeType: 'image/jpeg' };
  const a = await guest('/uploads', { token, method: 'POST', body: upload }); assert.equal(a.status, 200);
  const b = await guest('/uploads', { token, method: 'POST', body: upload }); assert.equal(a.data.id, b.data.id);
  assert.equal((await guest('/uploads', { token, method: 'POST', body: { ...upload, filename: 'changed.jpg' } })).status, 409);
  const progress = await guest('/uploads', { token }); assert.equal(progress.data.length, 1);
  assert.deepEqual(Object.keys(progress.data[0]).sort(), ['errorCode','filename','id','status']);
  const ownerUpload = await request(route + '/photos', { method: 'POST', body: { ...upload, requestId: randomUUID() } });
  assert.equal((await guest('/uploads/' + ownerUpload.data.id + '/complete', { token, method: 'POST', body: {} })).status, 404);
  await request(route + '/invites/close', { method: 'POST', body: {} });
  assert.equal((await guest('/uploads', { token })).status, 403);
  assert.equal((await guest('/exchange', { method: 'POST', body: { inviteId: invite.id, token: invite.token } })).status, 403);
  const { data: fresh } = await request(route + '/invites', { method: 'POST', body: {} });
  await db.studioInvite.update({ where: { id: fresh.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await guest('/exchange', { method: 'POST', body: { inviteId: fresh.id, token: fresh.token } })).status, 403);
});

test('worker validates real image bytes, strips metadata, recovers leases, and readies guest photos for owner', async () => {
  const { data: project } = await configured(); const route = '/' + project.id;
  const { data: invite } = await request(route + '/invites', { method: 'POST', body: {} });
  const { data: session } = await guest('/exchange', { method: 'POST', body: { inviteId: invite.id, token: invite.token, displayName: 'Mira' } });
  const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c73b65' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const { data: ticket } = await guest('/uploads', { token: session.token, method: 'POST', body: { requestId: randomUUID(), filename: 'garden.jpg', byteSize: bytes.length, mimeType: 'image/jpeg' } });
  const row = await db.studioAsset.findUnique({ where: { id: ticket.id } }); objects.set(row.stagingKey, bytes);
  assert.equal((await request(route + '/photos')).data.ready, 0);
  await guest('/uploads/' + ticket.id + '/complete', { token: session.token, method: 'POST', body: {} });
  await db.studioAsset.update({ where: { id: ticket.id }, data: { leaseUntil: new Date(0), leaseToken: randomUUID() } });
  await processNextPhoto();
  const ready = await db.studioAsset.findUnique({ where: { id: ticket.id } }); assert.equal(ready.status, 'READY'); assert.equal(ready.width, 48); assert.equal(ready.height, 64);
  assert.deepEqual(objects.get(ready.originalKey), bytes); assert(!objects.has(row.stagingKey));
  const preview = await sharp(objects.get(ready.previewKey)).metadata(); assert.equal(preview.format, 'webp'); assert.equal(preview.exif, undefined);
  const library = (await request(route + '/photos')).data; assert.equal(library.ready, 1); assert.equal(library.items[0].contributor, 'Mira'); assert(library.items[0].previewUrl);
  assert.equal((await guest('/uploads', { token: session.token })).data[0].status, 'READY');
  await assert.rejects(processPhoto(Buffer.from('<svg/>'), 'image/jpeg'));
  await assert.rejects(processPhoto(bytes, 'image/png'));
  const large = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await assert.rejects(processPhoto(large, 'image/png'));
  await db.studioAsset.updateMany({ where: { projectId: project.id, status: 'UPLOADING' }, data: { expiresAt: new Date(0) } }); await expireUploads();
});

test('design gate, selected-photo ownership, exact page count, and revision-safe save/replay', async () => {
  const { data: project } = await configured(); const route = '/' + project.id;
  const rows = Array.from({ length: 24 }, () => ({ id: randomUUID(), projectId: project.id, requestId: randomUUID(), uploaderKey: 'owner:owner-a', filename: 'photo.jpg', mimeType: 'image/jpeg', byteSize: 100, status: 'READY', stagingKey: 'fixture/' + randomUUID(), previewKey: 'fixture/preview.webp', originalKey: 'fixture/original.jpg', expiresAt: new Date(Date.now()+60_000) }));
  await db.studioAsset.createMany({ data: rows });
  assert.equal((await request(route + '/photos')).data.canDesign, true);
  assert.equal((await request(route + '/design')).data.photos.length, 24);
  const document = { version: 1, template: 'everyday', cover: { title: 'Our summer', photo: { assetId: rows[0].id, x: 50, y: 50 } }, pages: Array.from({ length: 20 }, (_, index) => ({ id: randomUUID(), layout: 'full', caption: '', photos: [{ assetId: rows[index].id, x: 50, y: 50 }] })) };
  const save = (body, owner) => request(route + '/design', { method: 'PUT', body, ...(owner ? { owner } : {}) });
  assert.equal((await save({ baseRevision: 1, document }, 'owner-b')).status, 404);
  assert.equal((await save({ baseRevision: 1, document: { ...document, pages: document.pages.slice(1) } })).status, 422);
  assert.equal((await save({ baseRevision: 1, document: { ...document, cover: { title: '', photo: { assetId: randomUUID(), x: 0, y: 0 } } } })).status, 422);
  assert.equal((await save({ baseRevision: 1, document })).data.revision, 2);
  assert.equal((await save({ baseRevision: 1, document })).data.revision, 2);
  assert.equal((await request(route)).data.designState, 'READY');
  assert((await request(route)).data.coverPreviewUrl);
  const changed = { ...document, template: 'travel' };
  assert.equal((await save({ baseRevision: 1, document: changed })).status, 409);
  const raced = await Promise.all(['travel','celebration'].map(template => save({ baseRevision: 2, document: { ...document, template } })));
  assert.deepEqual(raced.map(result => result.status).sort(), [200,409]);
  assert.equal((await request(route + '/photos/' + rows[0].id, { method: 'PATCH', body: { selected: false } })).code, 'PHOTO_IN_DESIGN');
  assert.equal((await request(route + '/design')).status, 200);
  assert.equal((await request(route + '/photos')).data.ready, 24);
  assert.equal((await request(route)).data.designState, 'READY');
});

test('concurrent upload reservations cannot exceed the collection cap', async () => {
  const { data: project } = await configured();
  await db.studioAsset.createMany({ data: Array.from({ length: 499 }, () => ({ projectId: project.id, requestId: randomUUID(), uploaderKey: 'owner:owner-a', filename: 'photo.jpg', mimeType: 'image/jpeg', byteSize: 1, stagingKey: 'fixture/' + randomUUID(), expiresAt: new Date(Date.now()+60_000) })) });
  const results = await Promise.all([0,1].map(() => request('/' + project.id + '/photos', { method: 'POST', body: { requestId: randomUUID(), filename: 'photo.jpg', mimeType: 'image/jpeg', byteSize: 1 } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200,413]);
  assert.equal(await db.studioAsset.count({ where: { projectId: project.id } }), 500);
});


test('trash is owner/revision protected, closes invitations, removes cart entries and restores for 15 days', async () => {
  const { data: project } = await configured();
  const route = '/' + project.id;
  const invite = (await request(route + '/invites', { method: 'POST', body: {} })).data;
  const cart = await db.cart.upsert({ where: { userId: 'owner-a' }, create: { userId: 'owner-a' }, update: {} });
  await db.studioCartItem.create({ data: { cartId: cart.id, projectId: project.id, productId, revision: 1, quantity: 1, snapshot: {} } });
  assert.equal((await request(route)).data.inCart, true);
  const act = (action, baseRevision, owner = 'owner-a') => request(route + '/lifecycle', { method: 'POST', owner, body: { action, baseRevision } });
  assert.equal((await act('trash', 1, 'owner-b')).status, 404);
  assert.equal((await act('trash', 9)).status, 409);
  assert.equal((await act('delete', 1)).status, 409);
  assert.equal((await act('trash', 1)).status, 200);
  assert.equal(await db.studioCartItem.count({ where: { projectId: project.id } }), 0);
  assert.equal((await guest('/exchange', { method: 'POST', body: { inviteId: invite.id, token: invite.token } })).status, 403);
  assert.equal((await request(route + '/design')).status, 404);
  const trashed = (await request('?trash=true')).data.items.find(p => p.id === project.id);
  assert(trashed); assert.equal(new Date(trashed.deleteAfter) - new Date(trashed.trashedAt), 15 * 86400000);
  assert.equal((await act('restore', 2)).status, 200);
  assert.equal((await request(route)).data.trashedAt, null);
  assert.equal((await request(route)).data.inCart, false);
  assert.equal((await act('trash', 3)).status, 200);
  await db.studioProject.update({ where: { id: project.id }, data: { trashedAt: new Date(Date.now() - 16 * 86400000) } });
  assert.equal((await act('restore', 4)).status, 410);
  await purgeTrashedAlbums();
  assert.equal(await db.studioProject.findUnique({ where: { id: project.id } }), null);
});

test('permanent deletion waits for transforms, deletes private files and preserves order records', async () => {
  const { data: project } = await configured();
  const asset = await db.studioAsset.create({ data: { projectId: project.id, requestId: randomUUID(), uploaderKey: 'owner:owner-a', filename: 'photo.jpg', mimeType: 'image/jpeg', byteSize: 1, status: 'PROCESSING', stagingKey: 'trash/staging', originalKey: 'trash/original', previewKey: 'trash/preview', leaseUntil: new Date(Date.now() + 60000), expiresAt: new Date() } });
  for (const key of [asset.stagingKey, asset.originalKey, asset.previewKey]) objects.set(key, Buffer.from('x'));
  const act = (action, baseRevision) => request('/' + project.id + '/lifecycle', { method: 'POST', body: { action, baseRevision } });
  await act('trash', 1); assert.equal((await act('delete', 2)).status, 200);
  assert.equal((await request('/' + project.id)).status, 404);
  await purgeTrashedAlbums(); assert(await db.studioProject.findUnique({ where: { id: project.id } }));
  await db.studioAsset.update({ where: { id: asset.id }, data: { leaseUntil: new Date(0) } });
  globalThis.__studioFailDeleteKey = asset.originalKey;
  await purgeTrashedAlbums(); assert(await db.studioProject.findUnique({ where: { id: project.id } }), 'Failed storage deletion remains retryable');
  delete globalThis.__studioFailDeleteKey;
  await purgeTrashedAlbums(); assert.equal(await db.studioProject.findUnique({ where: { id: project.id } }), null);
  for (const key of [asset.stagingKey, asset.originalKey, asset.previewKey]) assert(!objects.has(key));
  const { data: ordered } = await configured();
  await db.$executeRawUnsafe(`INSERT INTO "Order" ("id","userId","status") VALUES ('trash-order','owner-a','PAID')`);
  await db.$executeRawUnsafe(`INSERT INTO "OrderItem" ("id","orderId") VALUES ('trash-item','trash-order')`);
  await db.studioOrderLink.create({ data: { projectId: ordered.id, orderItemId: 'trash-item', revision: 1, snapshot: { title: 'Ordered album' }, actorId: 'owner-a' } });
  assert.equal((await request('/' + ordered.id)).data.order.status, 'PAID');
  await request('/' + ordered.id + '/lifecycle', { method: 'POST', body: { action: 'trash', baseRevision: 1 } });
  const deleted = await request('/' + ordered.id + '/lifecycle', { method: 'POST', body: { action: 'delete', baseRevision: 2 } });
  assert.equal(deleted.data.orderFilesRetained, true);
  await purgeTrashedAlbums();
  assert.equal((await request('/' + ordered.id)).status, 404);
  assert.equal(await db.studioOrderLink.count({ where: { projectId: ordered.id } }), 1);
});


test('older drafts configure in place, preserve identity and metadata, and replay safely', async () => {
  const p = (await create(input({ title: 'Keep this name', occasion: 'TRAVEL' }))).data;
  assert((await request('/formats')).data.some(f => f.id === productId));
  const route = '/' + p.id + '/configure';
  const body = { baseRevision: 1, selection };
  assert.equal((await request(route, { method: 'POST', owner: 'owner-b', body })).status, 404);
  assert.equal((await request(route, { method: 'POST', body, withCsrf: false })).status, 403);
  assert.equal((await request(route, { method: 'POST', body: { ...body, baseRevision: 99 } })).status, 409);
  const responses = await Promise.all([0,1].map(() => request(route, { method: 'POST', body })));
  for (const response of responses) {
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.data.id, p.id); assert.equal(response.data.title, p.title); assert.equal(response.data.occasion, 'TRAVEL'); assert.equal(response.data.minimumPhotos, 24); assert.equal(response.data.revision, 2);
  }
  assert.equal((await request(route, { method: 'POST', body: { ...body, selection: { ...selection, quantity: 3 } } })).status, 409);
});

test('duplicate remaps photo references, is idempotent and owner protected, and shared files survive source deletion', async () => {
  const { project: p, assets } = await designed();
  // Use unique keys so the test proves last-reference cleanup, independent of other fixtures.
  for (const a of assets) {
    a.originalKey = `copy/${a.id}/original`; a.previewKey = `copy/${a.id}/preview`;
    await db.studioAsset.update({ where: { id: a.id }, data: { originalKey: a.originalKey, previewKey: a.previewKey } });
    objects.set(a.originalKey, Buffer.from('x')); objects.set(a.previewKey, Buffer.from('x'));
  }
  await db.studioAsset.update({ where: { id: assets[25].id }, data: { selected: false } });
  const body = { requestId: randomUUID(), baseRevision: 2, mode: 'duplicate' };
  const route = '/' + p.id + '/copy';
  assert.equal((await request(route, { method: 'POST', owner: 'owner-b', body })).status, 404);
  assert.equal((await request(route, { method: 'POST', body, withCsrf: false })).status, 403);
  const responses = await Promise.all([0,1].map(() => request(route, { method: 'POST', body })));
  for (const response of responses) assert.equal(response.status, 201, JSON.stringify(response));
  const copy = responses[0].data; assert.equal(copy.id, responses[1].data.id); assert.notEqual(copy.id, p.id); assert.equal(copy.inCart, false); assert.equal(copy.order, null); assert.equal(copy.designState, 'READY');
  assert.equal(await db.studioAsset.count({ where: { projectId: copy.id } }), 26);
  assert.equal(await db.studioAsset.count({ where: { projectId: copy.id, selected: false } }), 1);
  const saved = (await request('/' + copy.id + '/design')).data;
  assert(!assets.some(a => a.id === saved.document.cover.photo.assetId));
  assert(saved.photos.some(a => a.id === saved.document.cover.photo.assetId));
  assert.equal((await request(route, { method: 'POST', body: { ...body, mode: 'reorder' } })).status, 409);
  await request('/' + p.id + '/lifecycle', { method: 'POST', body: { action: 'trash', baseRevision: 2 } });
  await request('/' + p.id + '/lifecycle', { method: 'POST', body: { action: 'delete', baseRevision: 3 } });
  await purgeTrashedAlbums();
  assert.equal(await db.studioProject.findUnique({ where: { id: p.id } }), null);
  assert(objects.has(assets[0].originalKey)); assert.equal((await request('/' + copy.id + '/design')).status, 200);
  await request('/' + copy.id + '/lifecycle', { method: 'POST', body: { action: 'trash', baseRevision: 1 } });
  await request('/' + copy.id + '/lifecycle', { method: 'POST', body: { action: 'delete', baseRevision: 2 } });
  await Promise.all([purgeTrashedAlbums(), purgeTrashedAlbums()]);
  assert.equal(await db.studioProject.findUnique({ where: { id: copy.id } }), null);
  assert(!objects.has(assets[0].originalKey));
});

test('reorder copies the frozen order rather than a subsequently edited design', async () => {
  const { project: p, document } = await designed();
  const order = await orderFixture();
  const original = await db.studioProject.findUnique({ where: { id: p.id } });
  await db.studioOrderLink.create({ data: { projectId: p.id, orderItemId: order.itemId, revision: 2, actorId: 'owner-a', snapshot: { title: p.title, configuration: original.configuration, document } } });
  await request('/' + p.id + '/design', { method: 'PUT', body: { baseRevision: 2, document: { ...document, template: 'travel' } } });
  const result = await request('/' + p.id + '/copy', { method: 'POST', body: { requestId: randomUUID(), baseRevision: 3, mode: 'reorder' } });
  assert.equal(result.status, 201, JSON.stringify(result)); assert.equal(result.data.order, null);
  assert.equal((await request('/' + result.data.id + '/design')).data.document.template, 'everyday');
  assert.equal((await request('/' + p.id + '/design')).data.document.template, 'travel');
  assert.equal((await db.studioOrderLink.findUnique({ where: { orderItemId: order.itemId } })).snapshot.document.template, 'everyday');
});

test('owner and admin protect used photos and the minimum, with replacement and concurrent exclusions', async () => {
  const { project: p, assets, document } = await designed();
  const select = a => request('/' + p.id + '/photos/' + a.id, { method: 'PATCH', body: { selected: false } });
  assert.equal((await select(assets[0])).code, 'PHOTO_IN_DESIGN');
  const library = (await request('/' + p.id + '/photos')).data;
  assert.equal(library.items.find(a => a.id === assets[0].id).usedInDesign, true);
  const raced = await Promise.all([assets[23], assets[24], assets[25]].map(select));
  assert.deepEqual(raced.map(r => r.status).sort(), [200,200,409]);
  const unused = (await db.studioAsset.findMany({ where: { projectId: p.id, selected: true } })).find(a => !document.pages.some(page => page.photos.some(photo => photo.assetId === a.id)));
  const revision = (await request('/' + p.id)).data.revision;
  assert.equal((await admin('/' + p.id + '/actions', { method: 'POST', body: { action: 'select-photo', assetId: unused.id, selected: false, baseRevision: revision, note: 'Cannot break minimum.' } })).code, 'DESIGN_PHOTO_MINIMUM');
  await request('/' + p.id + '/photos/' + assets[24].id, { method: 'PATCH', body: { selected: true } });
  await request('/' + p.id + '/photos/' + assets[25].id, { method: 'PATCH', body: { selected: true } });
  const freshRevision = (await request('/' + p.id)).data.revision;
  const replacement = JSON.parse(JSON.stringify(document)); replacement.cover.photo.assetId = assets[21].id; replacement.pages[0].photos[0].assetId = assets[21].id;
  assert.equal((await request('/' + p.id + '/design', { method: 'PUT', body: { baseRevision: freshRevision, document: replacement } })).status, 200);
  assert.equal((await select(assets[0])).status, 200);
  assert.equal((await request('/' + p.id + '/design')).status, 200);
});

test('interrupted owner and guest upload tickets renew in place without duplicates or quota bypass', async () => {
  const { data: p } = await configured();
  const body = { requestId: randomUUID(), filename: 'retry.jpg', byteSize: 100, mimeType: 'image/jpeg' };
  const first = (await request('/' + p.id + '/photos', { method: 'POST', body })).data;
  const old = await db.studioAsset.findUnique({ where: { id: first.id } });
  await db.studioAsset.update({ where: { id: first.id }, data: { expiresAt: new Date(0) } }); await expireUploads();
  const renewed = await request('/' + p.id + '/photos', { method: 'POST', body });
  assert.equal(renewed.status, 200); assert.equal(renewed.data.id, first.id); assert.equal(renewed.data.status, 'UPLOADING');
  assert.notEqual((await db.studioAsset.findUnique({ where: { id: first.id } })).stagingKey, old.stagingKey);
  assert.equal((await request('/' + p.id + '/photos/' + first.id + '/complete', { method: 'POST', body: {} })).status, 200);
  assert.equal((await request('/' + p.id + '/photos', { method: 'POST', body })).data.status, 'PROCESSING');
  const invite = (await request('/' + p.id + '/invites', { method: 'POST', body: {} })).data;
  const session = (await guest('/exchange', { method: 'POST', body: { inviteId: invite.id, token: invite.token } })).data;
  const photo = (await guest('/uploads', { method: 'POST', token: session.token, body })).data;
  await db.studioAsset.update({ where: { id: photo.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await guest('/uploads', { method: 'POST', token: session.token, body })).data.id, photo.id);
  await request('/' + p.id + '/invites/close', { method: 'POST', body: {} });
  assert.equal((await guest('/uploads', { method: 'POST', token: session.token, body })).status, 403);
  assert.equal(await db.studioAsset.count({ where: { projectId: p.id } }), 2);
  await db.studioAsset.update({ where: { id: first.id }, data: { status: 'FAILED', errorCode: 'UPLOAD_EXPIRED', expiresAt: new Date(0) } });
  await db.studioAsset.createMany({ data: Array.from({ length: 499 }, () => ({ projectId: p.id, requestId: randomUUID(), uploaderKey: 'owner:owner-a', filename: 'reserved.jpg', mimeType: 'image/jpeg', byteSize: 1, stagingKey: 'quota/' + randomUUID(), expiresAt: new Date(Date.now()+60000) })) });
  assert.equal((await request('/' + p.id + '/photos', { method: 'POST', body })).status, 413, 'Renewal reserves quota again');

});


const opsPolicy = { profiles: [], retentionEnabled: false, retentionDays: null, alertMinutes: 30 };
const printProfile = { productId: '', supplier: 'Fixture print supplier', targetDpi: 300, minimumDpi: 150, bleedMm: 3, safeMm: 5, approved: true };
async function savePolicy(policy) {
  const current = (await admin('/operations/settings')).data;
  const result = await admin('/operations/settings', { method:'POST',body:{baseRevision:current.revision,policy,confirmRetention:policy.retentionEnabled} });
  assert.equal(result.status,200,JSON.stringify(result)); return result.data;
}
test('admin settings are authenticated, revision safe, validated and public values follow product overrides', async()=>{
  assert.equal((await admin('/operations',{owner:'owner-a'})).status,403);
  const state = (await admin('/operations/settings')).data;
  const body={baseRevision:state.revision,policy:{...opsPolicy,profiles:[printProfile]},confirmRetention:false};
  assert.equal((await admin('/operations/settings',{method:'POST',body,withCsrf:false})).status,403);
  assert.equal((await admin('/operations/settings',{method:'POST',body:{...body,policy:{...body.policy,retentionEnabled:true,retentionDays:90}}})).status,422);
  const updates=await Promise.all([0,1].map(()=>admin('/operations/settings',{method:'POST',body})));
  assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
  const publicSettings=await request('/public-settings?productId='+productId,{owner:''});assert.equal(publicSettings.status,200);assert.equal(publicSettings.data.print.targetDpi,300);assert(!('workerError' in publicSettings.data));
  await savePolicy({...opsPolicy,profiles:[printProfile,{...printProfile,productId,approved:false}]});
  assert.equal((await request('/public-settings?productId='+productId,{owner:''})).data.print,null,'Unconfirmed override cannot inherit approved defaults');
  await savePolicy(opsPolicy);
});
test('print checks use physical frame dimensions, crop resolution, units and repeated image content', async()=>{
  const {project,assets,document}=await designed(); const config=(await db.studioProject.findUnique({where:{id:project.id}})).configuration;
  const images=assets.map(a=>({id:a.id,width:3000,height:2400,checksum:a.id}));
  const report=assessPrint(document,config,images,{...opsPolicy,profiles:[printProfile]});
  assert.equal(report.widthMm,203.2);assert.equal(report.bleedWidthMm,209.2);assert.equal(report.slots[1].dpi,340);assert(report.repeatedCount>=1);assert(report.canApprove);
  const mm={...config,options:config.options.map(o=>o.kind==='dimension'?{...o,width:203.2,height:203.2,unit:'mm'}:o)};
  assert.equal(assessPrint(document,mm,images,{...opsPolicy,profiles:[printProfile]}).slots[1].dpi,report.slots[1].dpi);
  const low=assessPrint(document,config,images.map(p=>({...p,width:100,height:100})),{...opsPolicy,profiles:[printProfile]});assert(!low.canApprove);assert(low.lowCount>0);
  assert(!assessPrint(document,config,images,{...opsPolicy,profiles:[{...printProfile,safeMm:25}]}).canApprove);
});
test('page appearance persists through save/reload and full-page geometry invalidates the old proof',async()=>{
  const {project,assets,document}=await designed();
  const config=(await db.studioProject.findUnique({where:{id:project.id}})).configuration;
  const images=assets.map(a=>({id:a.id,width:3000,height:2400,checksum:a.id}));
  const original=assessPrint(document,config,images,{...opsPolicy,profiles:[printProfile]});
  const updated=structuredClone(document);
  updated.cover.appearance={margin:0,font:'serif',fontSize:24,align:'left'};
  updated.pages[0].appearance={margin:0,font:'classic',fontSize:12,align:'right'};
  const result=await request('/'+project.id+'/design',{method:'PUT',body:{baseRevision:2,document:updated}});
  assert.equal(result.status,200,JSON.stringify(result));
  const loaded=(await request('/'+project.id+'/design')).data.document;
  assert.deepEqual(loaded.cover.appearance,updated.cover.appearance);
  assert.deepEqual(loaded.pages[0].appearance,updated.pages[0].appearance);
  const report=assessPrint(loaded,config,images,{...opsPolicy,profiles:[printProfile]});
  assert.equal(original.layoutVersion,2);assert.equal(report.layoutVersion,3);
  assert.notEqual(report.reportHash,original.reportHash);
  assert.equal(report.slots[1].dpi,300,'Borderless page uses full physical height');
  const invalid=structuredClone(updated);invalid.pages[0].appearance.margin=40;
  assert.equal((await request('/'+project.id+'/design',{method:'PUT',body:{baseRevision:3,document:invalid}})).status,400);
  const helpers=await Promise.all(['../studio_album/src/features/design/page-appearance.ts','../frontend_album/src/features/checkout/page-appearance.ts','../admin-frontend/lib/page-appearance.ts','src/features/studio/page-appearance.ts'].map(file=>readFile(path.resolve(file),'utf8')));
  assert(helpers.every(helper=>helper===helpers[0]),'All renderers and API use identical geometry');
});

test('customer proof and internal order print approvals reject stale designs, profile changes and low resolution',async()=>{
  const {project:p,document}=await designed(); await db.studioAsset.updateMany({where:{projectId:p.id},data:{width:3600,height:3600}});
  await savePolicy({...opsPolicy,profiles:[printProfile]});
  const report=(await request('/'+p.id+'/quality')).data;assert(report.canApprove);assert(!report.accepted);
  const body={baseRevision:2,reportHash:report.reportHash,accepted:true};
  assert.equal((await request('/'+p.id+'/proof',{method:'POST',owner:'owner-b',body})).status,404);
  assert.equal((await request('/'+p.id+'/proof',{method:'POST',body})).status,200);
  assert.equal((await request('/'+p.id+'/quality')).data.accepted,true);
  const order=await orderFixture();const row=await db.studioProject.findUnique({where:{id:p.id}});
  const link=await db.studioOrderLink.create({data:{projectId:p.id,orderItemId:order.itemId,revision:2,actorId:'owner-a',snapshot:{title:p.title,configuration:row.configuration,document}}});
  const orderProof={reportHash:report.reportHash,note:'Supplier proof checked.',supplierProofChecked:true};
  assert.equal((await admin('/'+p.id+'/orders/'+link.id+'/print-approval',{method:'POST',body:orderProof})).status,200);
  assert.equal((await admin('/'+p.id+'/orders/'+link.id)).data.printApprovalCurrent,true);
  await savePolicy({...opsPolicy,profiles:[{...printProfile,targetDpi:350}]});
  assert.equal((await request('/'+p.id+'/quality')).data.accepted,false);
  assert.equal((await request('/'+p.id+'/proof',{method:'POST',body})).status,409);
  assert.equal((await admin('/'+p.id+'/orders/'+link.id)).data.printApprovalCurrent,false);
  await savePolicy(opsPolicy);
});
test('retention skips active orders/support, preserves order and shared files, and retries storage failures',async()=>{
  const {project:p,assets,document}=await designed();const order=await orderFixture({status:'DELIVERED'});const row=await db.studioProject.findUnique({where:{id:p.id}});
  await db.$executeRaw`UPDATE "Order" SET "deliveredAt"=NOW()-INTERVAL '120 days' WHERE "id"=${order.orderId}`;
  await db.studioOrderLink.create({data:{projectId:p.id,orderItemId:order.itemId,revision:2,actorId:'owner-a',snapshot:{title:p.title,configuration:row.configuration,document}}});
  await db.studioProject.update({where:{id:p.id},data:{trashedAt:new Date(Date.now()-120*86400000),deletedAt:new Date(Date.now()-120*86400000)}});
  const spare=assets[25];await db.studioAsset.update({where:{id:spare.id},data:{originalKey:'retention/extra'}});objects.set('retention/extra',Buffer.from('x'));
  await pruneRetainedExtras();assert.equal(await db.studioAsset.count({where:{projectId:p.id}}),26,'Default policy preserves all files');
  await savePolicy({...opsPolicy,retentionEnabled:true,retentionDays:90});
  await db.$executeRaw`INSERT INTO "SupportTicket" ("id","orderId","status") VALUES ('retention-case',${order.orderId},'OPEN')`;
  await pruneRetainedExtras();assert.equal(await db.studioAsset.count({where:{projectId:p.id}}),26,'Open support holds extras');
  await db.$executeRaw`UPDATE "SupportTicket" SET "status"='CLOSED' WHERE "id"='retention-case'`;
  globalThis.__studioFailDeleteKey='retention/extra';await pruneRetainedExtras();assert(await db.studioAsset.findUnique({where:{id:spare.id}}));assert.equal((await db.studioProject.findUnique({where:{id:p.id}})).cleanupError,'RETENTION_CLEANUP_FAILED');
  delete globalThis.__studioFailDeleteKey;await pruneRetainedExtras();assert.equal(await db.studioAsset.count({where:{projectId:p.id}}),20);assert(!objects.has('retention/extra'));
  assert(await db.studioAsset.findUnique({where:{id:assets[0].id}}));assert.equal((await db.studioProject.findUnique({where:{id:p.id}})).cleanupError,null);
  await savePolicy(opsPolicy);
});
test('cleanup monitoring reports failed retries, oldest pending work and stale heartbeat',async()=>{
  const {data:p}=await configured();await db.studioProject.update({where:{id:p.id},data:{deletedAt:new Date(0),trashedAt:new Date(0),cleanupError:'TRASH_CLEANUP_FAILED',cleanupAttempts:3}});
  await db.studioOperationSetting.update({where:{id:1},data:{workerHeartbeatAt:new Date(0)}});
  const result=await operationMonitor();assert(result.pending>0);assert(result.failed>0);assert(result.alerts.some(a=>a.includes('heartbeat')));assert.equal(result.items.find(a=>a.id===p.id).cleanupAttempts,3);
  await purgeTrashedAlbums();assert.equal(await db.studioProject.findUnique({where:{id:p.id}}),null);
});
