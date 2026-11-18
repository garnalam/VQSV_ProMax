import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from './app.mjs';
import { DEV_BUILD_KEY_HEX, buildKeyId, envelopeAad, hexBytes, openSave, sealSave } from '../src/account/SaveEnvelope.ts';
import { auditSave } from './ledger.mjs';

const DEV_KEY = hexBytes(DEV_BUILD_KEY_HEX);

const origin = 'https://game.example';
const snapshot = (money = 12) => ({
  format: 'vqsv-web-save', version: 34, savedAt: '2026-11-13T00:00:00.000Z',
  location: { sceneId: 1, roomIndex: 1, x: 55, y: 279, direction: 2 },
  resume: { owner: 'scene1.bunny-capture' }, progress: {}, story: {},
  inventory: { items: {} }, currency: { money, badges: 0 }, repelSteps: 0,
  pendingSkillLearns: [], pets: [{ speciesId: 68, level: 7, quality: 2 }],
});

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'vqsv-api-'));
  const databasePath = join(dir, 'game.sqlite');
  let clock = Date.now();
  let app;
  let base;
  async function open() {
    app = createApplication({ databasePath, origin, now: () => clock, buildKeys: [DEV_KEY], ...options });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  await open();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (path, { cookie, method = 'GET', json, body, headers = {} } = {}) =>
    fetch(`${base}/api${path}`, { method, headers: {
      ...(method !== 'GET' ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers,
    }, body: json !== undefined ? JSON.stringify(json) : body });
  async function register(email = 'one@example.com') {
    const response = await request('/auth/register', {
      method: 'POST', json: { email, password: 'test-password-123' },
    });
    assert.equal(response.status, 201);
    return { cookie: response.headers.get('set-cookie').split(';')[0], user: (await response.json()).user };
  }
  const ticket = async cookie => (await (await request('/saves', { cookie })).json()).ticket;
  /** What the game uploads: the save sealed for this row and revision (SaveEnvelope.ts). */
  const save = async (cookie, value, row, { plain = false, key = DEV_KEY, aad } = {}) => {
    const form = new FormData();
    const bytes = plain ? new TextEncoder().encode(JSON.stringify(value))
      : await sealSave(JSON.stringify(value), await ticket(cookie), key, aad ?? envelopeAad(row?.id ?? null, row?.revision ?? 0, 'up'));
    form.set('file', new Blob([bytes], { type: 'application/octet-stream' }), 'save.json');
    form.set('gameVersion', 'web-native');
    form.set('name', 'Save web-native');
    if (row) form.set('revision', String(row.revision));
    return request(`/saves${row ? `/${row.id}` : ''}`, { cookie, method: row ? 'PUT' : 'POST', body: form });
  };
  /** What the game downloads: the sealed save, opened as the game does. */
  const load = async (cookie, row, backup = false) => {
    const response = await request(`/saves/${row.id}${backup ? '/backup' : ''}`, { cookie, headers: { 'x-vqsv-build': await buildKeyId(DEV_KEY) } });
    assert.equal(response.status, 200);
    const text = await openSave(new Uint8Array(await response.arrayBuffer()), await ticket(cookie), [DEV_KEY], envelopeAad(row.id, row.revision, 'down'));
    return JSON.parse(text);
  };
  return { databasePath, request, register, save, load, ticket, advance: ms => { clock += ms; }, restart: async () => { await app.close(); await open(); } };
}

test('imported Cloudflare accounts can log in with their original passwords', async t => {
  const f = await fixture(t);
  const email = 'legacy@example.com';
  const password = 'mật-khẩu-cũ';
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const db = new DatabaseSync(f.databasePath);
  db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(
    randomUUID(), email, `pbkdf2-sha256:${salt.toString('base64url')}:${hash.toString('base64url')}`, Date.now(),
  );
  db.close();
  const login = password => f.request('/auth/login', { method: 'POST', json: { email, password } });
  assert.equal((await login('wrong-password')).status, 401);
  const response = await login(password);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.email, email);
});

test('authentication normalizes email, issues protected cookie, persists and revokes sessions', async t => {
  const f = await fixture(t);
  const r = await f.request('/auth/register', { method: 'POST', json: { email: ' ONE@Example.com ', password: 'test-password-123' } });
  assert.equal(r.status, 201);
  const cookieHeader = r.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=Lax/);
  const cookie = cookieHeader.split(';')[0];
  assert.equal((await r.json()).user.email, 'one@example.com');
  await f.restart();
  assert.equal((await f.request('/auth/me', { cookie })).status, 200);
  assert.equal((await f.request('/auth/logout', { method: 'POST', cookie })).status, 200);
  assert.equal((await f.request('/auth/me', { cookie })).status, 401);
  const login = await f.request('/auth/login', { method: 'POST', json: { email: 'one@example.com', password: 'test-password-123' } });
  assert.equal(login.status, 200);
  f.advance(7 * 86400_000 + 1);
  assert.equal((await f.request('/auth/me', { cookie: login.headers.get('set-cookie').split(';')[0] })).status, 401);
});

test('rejects cross-origin writes, malformed JSON, weak passwords, unknown auth and repeated attempts', async t => {
  const f = await fixture(t, { authLimit: 4 });
  assert.equal((await f.request('/auth/register', { method: 'POST', json: {}, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('/auth/register', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })).status, 400);
  assert.equal((await f.request('/auth/register', { method: 'POST', json: { email: 'a@b.com', password: 'short' } })).status, 400);
  const result = await f.request('/auth/login', { method: 'POST', json: { email: 'none@b.com', password: 'not-a-real-password' } });
  assert.equal(result.status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', json: { email: 'none@b.com', password: 'not-a-real-password' } })).status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', json: { email: 'none@b.com', password: 'not-a-real-password' } })).status, 429);
});

test('owns save and backup per user, validates snapshots and persists across restart', async t => {
  const f = await fixture(t);
  const a = await f.register(), b = await f.register('two@example.com');
  assert.equal((await f.request('/saves')).status, 401);
  const first = await f.save(a.cookie, snapshot());
  assert.equal(first.status, 201);
  let row = await first.json();
  assert.equal(row.revision, 1);
  assert.equal((await f.request(`/saves/${row.id}`, { cookie: b.cookie })).status, 404);
  assert.equal((await f.request(`/saves/${row.id}/backup`, { cookie: b.cookie })).status, 404);
  assert.equal((await f.request(`/saves/${row.id}`, { cookie: b.cookie, method: 'DELETE' })).status, 404);
  assert.equal((await f.save(a.cookie, snapshot())).status, 409);
  assert.equal((await f.save(a.cookie, { version: 33 }, row)).status, 400);
  const second = await f.save(a.cookie, snapshot(24), row);
  assert.equal(second.status, 200);
  row = await second.json();
  assert.equal(row.revision, 2);
  await f.restart();
  assert.equal((await f.load(a.cookie, row)).currency.money, 24);
  assert.equal((await f.load(a.cookie, row, true)).currency.money, 12);
  assert.equal((await (await f.request('/saves', { cookie: b.cookie })).json()).saves.length, 0);
  assert.equal((await f.request(`/saves/${row.id}`, { cookie: a.cookie, method: 'DELETE', headers: { 'if-match': '"1"' } })).status, 409);
  assert.equal((await f.request(`/saves/${row.id}`, { cookie: a.cookie, method: 'DELETE', headers: { 'if-match': '"2"' } })).status, 200);
  assert.equal((await (await f.request('/saves', { cookie: a.cookie })).json()).saves.length, 0);
});

test('only one writer wins a revision and oversize writes leave the valid save untouched', async t => {
  const f = await fixture(t);
  const a = await f.register();
  const row = await (await f.save(a.cookie, snapshot())).json();
  const writes = await Promise.all([f.save(a.cookie, snapshot(100), row), f.save(a.cookie, snapshot(200), row)]);
  assert.deepEqual(writes.map(r => r.status).sort(), [200, 409]);
  const huge = snapshot();
  huge.story.large = { text: 'x'.repeat(2 * 1024 * 1024) };
  assert.equal((await f.save(a.cookie, huge, { ...row, revision: 2 })).status, 413);
  const current = await f.load(a.cookie, { ...row, revision: 2 });
  assert.ok([100, 200].includes(current.currency.money));
  assert.equal((await (await f.request('/saves', { cookie: a.cookie })).json()).saves[0].revision, 2);
});

test('the in-game Admin Tool: grants are refused to players and normalized for admins', async t => {
  const f = await fixture(t);
  const { cookie } = await f.register('admin@example.com');
  const grant = json => f.request('/admin/grant', { cookie, method: 'POST', json });
  assert.equal((await grant({ action: 'addItem', kind: 'BAG', id: 1, quantity: 5 })).status, 403);
  const db = new DatabaseSync(f.databasePath);
  db.prepare("INSERT INTO account_access (user_id, role) SELECT id, 'admin' FROM users WHERE email = ?").run('admin@example.com');
  db.close();
  const status = await f.request('/admin/status', { cookie });
  assert.deepEqual([status.status, await status.json()], [200, { admin: true }]);
  const item = await grant({ action: 'addItem', kind: 'BAG', id: '7', quantity: 3 });
  assert.deepEqual(await item.json(), { ok: true, grant: { action: 'addItem', kind: 'BAG', id: 7, quantity: 3 } });
  const pet = await (await grant({ action: 'addPet', speciesId: 68 })).json();
  assert.equal(pet.grant.speciesId, 68);
  assert.match(pet.grant.talentSeed, /^\d+$/);
  assert.equal(pet.grant.quality, undefined);
  assert.equal(pet.grant.talentId, undefined);
  assert.equal((await (await grant({ action: 'addPet', speciesId: 68, talentId: 3 })).json()).grant.talentId, 3);
  assert.equal((await grant({ action: 'addPet', speciesId: 68, talentId: -1 })).status, 400);
  assert.equal((await (await grant({ action: 'addPet', speciesId: 68, quality: 4 })).json()).grant.quality, 4);
  assert.equal((await grant({ action: 'addPet', speciesId: 68, quality: 9 })).status, 400);
  assert.equal((await grant({ action: 'addPet', speciesId: 278 })).status, 400);
  assert.equal((await grant({ action: 'unknown' })).status, 400);
});

test('the DB admin page: roles, save upload and the database download', async t => {
  const f = await fixture(t);
  const admin = await f.register('admin@example.com');
  const player = await f.register('player@example.com');
  const db = new DatabaseSync(f.databasePath);
  db.prepare("INSERT INTO account_access (user_id, role) VALUES (?, 'admin')").run(admin.user.id);
  db.close();
  const as = (who, path, options = {}) => f.request(path, { cookie: who.cookie, ...options });
  const upload = (who, value) => as(who, `/admin/users/${player.user.id}/save`, {
    method: 'PUT', body: JSON.stringify(value), headers: { 'content-type': 'application/json' } });

  assert.equal((await upload(player, snapshot(5))).status, 403);
  assert.equal((await upload(admin, { not: 'a save' })).status, 422);
  const first = await upload(admin, snapshot(5));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).save.revision, 1);
  assert.equal((await (await as(player, '/saves')).json()).saves[0].revision, 1);
  assert.equal((await upload(admin, snapshot(9))).status, 200);
  const save = await (await as(admin, `/admin/users/${player.user.id}/save`)).json();
  const previous = await (await as(admin, `/admin/users/${player.user.id}/save/backup`)).json();
  assert.deepEqual([save.currency.money, previous.currency.money], [9, 5]);

  const role = (who, target, value) => as(who, `/admin/users/${target}/role`, { method: 'POST', json: { role: value } });
  assert.equal((await role(player, player.user.id, 'admin')).status, 403);
  assert.equal((await role(admin, admin.user.id, 'player')).status, 403);
  assert.equal((await role(admin, player.user.id, 'boss')).status, 400);
  assert.equal((await role(admin, player.user.id, 'admin')).status, 200);
  assert.equal((await (await as(player, '/auth/me')).json()).user.role, 'admin');
  assert.equal((await role(admin, player.user.id, 'player')).status, 200);
  assert.equal((await (await as(player, '/auth/me')).json()).user.role, 'player');

  assert.equal((await as(admin, '/admin/backup/download')).status, 404);
  assert.equal((await as(admin, '/admin/backup', { method: 'POST' })).status, 200);
  assert.equal((await as(player, '/admin/backup/download')).status, 403);
  const file = await as(admin, '/admin/backup/download');
  assert.equal(file.status, 200);
  assert.equal(Buffer.from(await file.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  const audit = (await (await as(admin, '/admin/overview')).json()).audit.map(entry => entry.action);
  assert.deepEqual(audit.slice(0, 6), ['download', 'backup', 'revoke_admin', 'grant_admin', 'upload', 'upload']);
});

async function withAdmin(t) {
  const f = await fixture(t);
  const admin = await f.register('admin@example.com');
  const db = new DatabaseSync(f.databasePath);
  db.prepare("INSERT INTO account_access (user_id, role) VALUES (?, 'admin')").run(admin.user.id);
  db.close();
  const as = (who, path, options = {}) => f.request(path, { cookie: who.cookie, ...options });
  return { f, admin, as };
}

test('gift codes: admins create them, players redeem each once, limits and windows hold', async t => {
  const { f, admin, as } = await withAdmin(t);
  const one = await f.register('one@example.com');
  const two = await f.register('two@example.com');
  const create = json => as(admin, '/admin/giftcodes', { method: 'POST', json });
  const redeem = (who, code, free = 10) => as(who, '/gifts/redeem', { method: 'POST', json: { code, bankFree: free } });
  const rewards = { money: 500, items: [{ kind: 'BAG', id: 3, quantity: 2 }], pets: [{ speciesId: 68, shiny: 'always', nature: 9, stars: 5, talent: 0 }] };

  assert.equal((await as(one, '/admin/giftcodes', { method: 'POST', json: { code: 'TEST1', description: 'x', rewards } })).status, 403);
  assert.equal((await create({ code: 'ab', description: 'x', rewards })).status, 400);
  assert.equal((await create({ code: 'BOSS', description: 'x', rewards: { pets: [{ speciesId: 278 }] } })).status, 400);
  assert.equal((await create({ code: 'NAT8R', description: 'x', rewards: { pets: [{ speciesId: 68, shiny: 'random', nature: 8 }] } })).status, 400);
  assert.equal((await create({ code: 'NAT5A', description: 'x', rewards: { pets: [{ speciesId: 68, shiny: 'always', nature: 5 }] } })).status, 400);
  assert.equal((await create({ code: 'TAL1K', description: 'x', rewards: { pets: [{ speciesId: 68, talent: 1000 }] } })).status, 400);
  assert.equal((await create({ code: 'STAR6', description: 'x', rewards: { pets: [{ speciesId: 68, stars: 6 }] } })).status, 400);
  assert.equal((await create({ code: 'EMPTY', description: 'x', rewards: {} })).status, 400);
  assert.equal((await create({ code: 'tet2027', description: 'Lì xì Tết', rewards, maxUses: 1 })).status, 201);

  assert.equal((await redeem(one, 'NOPE')).status, 404);
  assert.equal((await redeem(one, 'TET2027', 0)).status, 409);
  const ok = await redeem(one, ' tet2027 ');
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.description, 'Lì xì Tết');
  assert.deepEqual(body.grants.slice(0, 2), [
    { action: 'addCurrency', money: 500, badges: 0 }, { action: 'addItem', kind: 'BAG', id: 3, quantity: 2 },
  ]);
  assert.equal(body.grants[2].action, 'addPet');
  assert.equal(body.grants[2].shiny, true);
  assert.equal(body.grants[2].nature, 9);
  assert.match(body.grants[2].talentSeed, /^\d+$/);
  assert.equal(body.grants[2].quality, 5);
  assert.equal(body.grants[2].talentId, 0);
  assert.equal((await (await redeem(one, 'TET2027')).json()).code, 'already');
  assert.equal((await (await redeem(two, 'TET2027')).json()).code, 'used_up');

  assert.equal((await create({ code: 'LATER', description: 'x', rewards, startsAt: Date.now() + 3600_000 })).status, 201);
  assert.equal((await (await redeem(two, 'LATER')).json()).code, 'not_started');
  assert.equal((await create({ code: 'OFF1', description: 'x', rewards, active: false })).status, 201);
  assert.equal((await (await redeem(two, 'OFF1')).json()).code, 'inactive');
  assert.equal((await create({ code: 'OFF1', description: 'x', rewards, active: true })).status, 200);
  assert.equal((await redeem(two, 'OFF1')).status, 200);

  const codes = (await (await as(admin, '/admin/giftcodes')).json()).codes;
  assert.equal(codes.find(c => c.code === 'TET2027').uses, 1);
  const who = (await (await as(admin, '/admin/giftcodes/TET2027/redemptions')).json()).redemptions;
  assert.deepEqual(who.map(r => r.email), ['one@example.com']);
  assert.equal((await as(admin, '/admin/giftcodes/TET2027', { method: 'DELETE' })).status, 200);
  assert.equal((await redeem(two, 'TET2027')).status, 404);
});

test('mailbox: gifts to one player or everyone, claimed once, recalled while unclaimed', async t => {
  const { f, admin, as } = await withAdmin(t);
  const one = await f.register('one@example.com');
  const two = await f.register('two@example.com');
  const send = json => as(admin, '/admin/mail', { method: 'POST', json });

  assert.equal((await send({ target: one.user.id, title: '', rewards: { money: 1 } })).status, 400);
  assert.equal((await (await send({ target: one.user.id, title: 'Đền bù', body: 'Xin lỗi', rewards: { badges: 3 } })).json()).recipients, 1);
  assert.equal((await (await send({ target: 'all', title: 'Quà chung', rewards: { pets: [{ speciesId: 68 }] } })).json()).recipients, 3);

  const inbox = (await (await as(one, '/mail')).json()).mail;
  assert.deepEqual(inbox.map(m => m.title), ['Đền bù', 'Quà chung']);
  assert.equal((await as(two, `/mail/${inbox[0].id}/claim`, { method: 'POST', json: {} })).status, 404);
  const claimed = await (await as(one, `/mail/${inbox[0].id}/claim`, { method: 'POST', json: {} })).json();
  assert.deepEqual(claimed.grants, [{ action: 'addCurrency', money: 0, badges: 3 }]);
  assert.equal((await as(one, `/mail/${inbox[0].id}/claim`, { method: 'POST', json: {} })).status, 404);
  assert.equal((await as(one, `/mail/${inbox[1].id}/claim`, { method: 'POST', json: { bankFree: 0 } })).status, 409);
  assert.equal((await as(one, `/mail/${inbox[1].id}/claim`, { method: 'POST', json: { bankFree: 1 } })).status, 200);

  const sent = (await (await as(admin, '/admin/mail')).json()).mail;
  const everyone = sent.find(m => m.title === 'Quà chung');
  assert.deepEqual([everyone.recipients, everyone.claimed], [3, 1]);
  assert.equal((await (await as(admin, `/admin/mail/${everyone.batch}`, { method: 'DELETE' })).json()).recalled, 2);
  assert.deepEqual((await (await as(two, '/mail')).json()).mail, []);
});

test('the admin page edits saves safely and manages sessions and passwords', async t => {
  const { f, admin, as } = await withAdmin(t);
  const player = await f.register('player@example.com');
  const row = await (await f.save(player.cookie, snapshot(10))).json();
  const opened = await as(admin, `/admin/users/${player.user.id}/save`);
  assert.equal(opened.headers.get('etag'), '"1"');
  await f.save(player.cookie, snapshot(20), row);
  const edit = (revision, value) => as(admin, `/admin/users/${player.user.id}/save`, {
    method: 'PUT', body: JSON.stringify(value), headers: { 'content-type': 'application/json', 'if-match': `"${revision}"` } });
  assert.equal((await edit(1, snapshot(999))).status, 409);
  assert.equal((await edit(2, snapshot(999))).status, 200);
  assert.equal((await f.load(player.cookie, { ...row, revision: 3 })).currency.money, 999);

  const detail = (await (await as(admin, `/admin/users/${player.user.id}`)).json()).user;
  assert.deepEqual([detail.money, detail.topLevel, detail.partySize, detail.sessions], [999, 7, 1, 1]);
  const sorted = (await (await as(admin, '/admin/users?sort=money')).json()).users;
  assert.equal(sorted[0].email, 'player@example.com');
  const stats = (await (await as(admin, '/admin/overview')).json()).stats;
  assert.equal(stats.leaders.money[0].money, 999);
  assert.equal(stats.activity.active24h, 1);

  assert.equal((await (await as(admin, `/admin/users/${player.user.id}/logout`, { method: 'POST' })).json()).sessions, 1);
  assert.equal((await as(player, '/auth/me')).status, 401);
  assert.equal((await as(admin, `/admin/users/${player.user.id}/password`, { method: 'POST', json: { password: 'short' } })).status, 400);
  assert.equal((await as(admin, `/admin/users/${player.user.id}/password`, { method: 'POST', json: { password: 'brand-new-pass-1' } })).status, 200);
  const login = await f.request('/auth/login', { method: 'POST', json: { email: 'player@example.com', password: 'brand-new-pass-1' } });
  assert.equal(login.status, 200);
  const actions = (await (await as(admin, '/admin/audit')).json()).audit.map(entry => entry.action);
  assert.deepEqual(actions.slice(0, 3), ['password', 'logout', 'edit']);
});

test('the save envelope: plain JSON, edits, replays, other rows and stale builds are refused', async t => {
  const f = await fixture(t);
  const a = await f.register(), b = await f.register('two@example.com');
  // The F12 way: plain JSON, as the console script in the owner's video sent it.
  assert.equal((await f.save(a.cookie, snapshot(), null, { plain: true })).status, 400);
  let row = await (await f.save(a.cookie, snapshot())).json();
  // The download is sealed: no JSON to edit.
  const raw = await f.request(`/saves/${row.id}`, { cookie: a.cookie, headers: { 'x-vqsv-build': await buildKeyId(DEV_KEY) } });
  assert.equal(raw.headers.get('content-type'), 'application/octet-stream');
  const rawText = Buffer.from(await raw.arrayBuffer()).toString('utf8');
  assert.throws(() => JSON.parse(rawText));
  // A build the server does not know is told to reload.
  assert.equal((await f.request(`/saves/${row.id}`, { cookie: a.cookie, headers: { 'x-vqsv-build': 'deadbeef' } })).status, 426);
  // Sealed for another revision, for the download direction, or with another build key: refused.
  assert.equal((await f.save(a.cookie, snapshot(5), row, { aad: envelopeAad(row.id, 0, 'up') })).status, 400);
  assert.equal((await f.save(a.cookie, snapshot(5), row, { aad: envelopeAad(row.id, row.revision, 'down') })).status, 400);
  assert.equal((await f.save(a.cookie, snapshot(5), row, { key: new Uint8Array(32) })).status, 400);
  const put = async bytes => {
    const form = new FormData();
    form.set('file', new Blob([bytes]), 'save.json');
    form.set('gameVersion', 'web-native');
    form.set('revision', String(row.revision));
    return f.request(`/saves/${row.id}`, { cookie: a.cookie, method: 'PUT', body: form });
  };
  // Another player's ticket cannot seal for this account.
  assert.equal((await put(await sealSave(JSON.stringify(snapshot(9)), await f.ticket(b.cookie), DEV_KEY, envelopeAad(row.id, row.revision, 'up')))).status, 400);
  // One flipped byte in a good envelope: refused.
  const good = await sealSave(JSON.stringify(snapshot(7)), await f.ticket(a.cookie), DEV_KEY, envelopeAad(row.id, row.revision, 'up'));
  good[good.length - 3] ^= 1;
  assert.equal((await put(good)).status, 400);
  // The game's own upload goes through, and the previous build's key is still accepted.
  row = await (await f.save(a.cookie, snapshot(30), row)).json();
  assert.equal((await f.load(a.cookie, row)).currency.money, 30);
  const old = new Uint8Array(32).fill(7);
  const f2 = await fixture(t, { buildKeys: [DEV_KEY, old] });
  const c = await f2.register();
  assert.equal((await f2.save(c.cookie, snapshot(), null, { key: old })).status, 201);
});

test('the money and pet log: lines are kept and unexplained money or pets raise alerts', async t => {
  const { f, admin, as } = await withAdmin(t);
  const player = await f.register('player@example.com');
  const pet = (uid, speciesId = 68, level = 7) => ({ uid, speciesId, level, quality: 2 });
  const withLedger = (money, pets, seq, entries) => ({ ...snapshot(money), pets, ledger: { seq, entries } });
  const baseline = { seq: 1, t: 1, kind: 'pet+', pet: pet('a1'), source: 'baseline' };
  const fight = { seq: 2, t: 2, kind: 'money', amount: 50, balance: 62, source: 'battle:wild' };
  let row = await (await f.save(player.cookie, withLedger(12, [pet('a1')], 1, [baseline]))).json();
  // An honest fight: +50 money, logged.
  row = await (await f.save(player.cookie, withLedger(62, [pet('a1')], 2, [baseline, fight]), row)).json();
  let alerts = (await (await as(admin, '/admin/alerts')).json()).alerts;
  assert.deepEqual(alerts, []);
  // Money edited in without a line, and a pet with no line.
  row = await (await f.save(player.cookie, withLedger(9_999_999, [pet('a1'), pet('zz', 150, 99)], 2, [fight]), row)).json();
  alerts = (await (await as(admin, '/admin/alerts')).json()).alerts;
  assert.deepEqual(alerts.map(a => a.kind).sort(), ['money_unexplained', 'pet_unexplained']);
  assert.equal((await (await as(admin, '/admin/overview')).json()).openAlerts, 2);
  const log = (await (await as(admin, `/admin/users/${player.user.id}/ledger`)).json()).log;
  assert.deepEqual(log.map(l => [l.seq, l.kind, l.source]), [[2, 'money', 'battle:wild'], [1, 'pet+', 'baseline']]);
  assert.equal((await (await as(admin, '/admin/alerts/seen', { method: 'POST', json: { ids: alerts.map(a => a.id) } })).json()).seen, 2);
  assert.equal((await (await as(admin, '/admin/alerts')).json()).open, 0);
  assert.equal((await as(player, '/admin/alerts')).status, 403);
});

test('auditSave: sources from nowhere, spikes, level jumps and unclaimed letters', () => {
  const pet = (uid, speciesId = 68, level = 7) => ({ uid, speciesId, level, quality: 2 });
  const save = (money, pets, seq, entries) => ({ currency: { money }, pets, ledger: { seq, entries } });
  const previous = save(100, [pet('a', 68, 20)], 1, []);
  const kinds = next => auditSave({ previous, next, claimed: source => source !== 'mail:9' }).alerts.map(a => a.kind).sort();
  assert.deepEqual(kinds(save(100, [pet('a', 68, 20), pet('b')], 2, [{ seq: 2, kind: 'pet+', pet: pet('b'), source: 'world' }])), ['pet_nowhere']);
  assert.deepEqual(kinds(save(2_000_100, [pet('a', 68, 20)], 2, [{ seq: 2, kind: 'money', amount: 2_000_000, source: 'event:1:2:3' }])), ['money_spike']);
  assert.deepEqual(kinds(save(100, [pet('a', 68, 20), pet('c', 9, 80)], 2, [{ seq: 2, kind: 'pet+', pet: pet('c', 9, 80), source: 'battle:wild' }])), ['pet_level']);
  assert.deepEqual(kinds(save(150, [pet('a', 68, 20)], 2, [{ seq: 2, kind: 'money', amount: 50, source: 'mail:9' }])), ['source_unclaimed']);
  assert.deepEqual(kinds(save(150, [pet('a', 68, 20)], 2, [{ seq: 2, kind: 'money', amount: 50, source: 'mail:3' }])), []);
  assert.deepEqual(kinds({ currency: { money: 100 }, pets: [pet('a', 68, 20)] }), ['ledger_missing']);
});

test('loadBuildKeys reads deploy/build-keys.txt as rotate-build-key.mjs writes it (newest first)', async t => {
  const { loadBuildKeys } = await import('./app.mjs');
  const { writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'vqsv-keys-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'build-keys.txt'), a = 'a'.repeat(64), b = 'b'.repeat(64);
  await writeFile(file, `${a}\n${b}\n`);
  assert.deepEqual(loadBuildKeys(file).map(k => Buffer.from(k).toString('hex')), [a, b]);
  assert.deepEqual(loadBuildKeys(join(dir, 'missing.txt')).map(k => Buffer.from(k).toString('hex')), [DEV_BUILD_KEY_HEX]);
});

test('live channel: admin commands reach the game, admin save edits win over an older game', async t => {
  const f = await fixture(t);
  const admin = await f.register('admin@example.com');
  const player = await f.register('player@example.com');
  const db = new DatabaseSync(f.databasePath);
  db.prepare("INSERT INTO account_access (user_id, role) VALUES (?, 'admin')").run(admin.user.id);
  db.close();
  const as = (who, path, options = {}) => f.request(path, { cookie: who.cookie, ...options });
  const beat = async (first = false) => (await (await as(player, '/live', { method: 'POST', json: { first, where: { scene: 4, room: 2, x: 10, y: 20, phase: 'freeworld', battle: false, junk: 'x'.repeat(500) }, idleMs: 300 } })).json()).commands;

  // The player plays: a save, then a heartbeat shows them online, where they are.
  const story = { ...snapshot(10), story: { quest: { node: 'n', main: 3, mainDone: false, branch: '7:1', tokens: '' } },
    world: { badgesAchieved: [], badgesEnhanced: [], sourceWorldFlags: [5], gameCf: false, mainTaskProgress: 3, activeTask: '' },
    pendingSkillLearns: [{ petSlot: 0, skillId: 9 }] };
  const uploaded = await f.save(player.cookie, story);
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const row = await uploaded.json();
  assert.deepEqual(await beat(true), []);
  const online = await (await as(admin, '/admin/online')).json();
  assert.equal(online.online.length, 1);
  assert.deepEqual(online.online[0].info, { scene: 4, room: 2, x: 10, y: 20, phase: 'freeworld', battle: false, idleMs: 300 });
  assert.equal((await as(player, '/admin/online')).status, 403);

  // A message waits for the game, which reports it done.
  assert.equal((await as(admin, `/admin/users/${player.user.id}/command`, { method: 'POST', json: { kind: 'message', payload: { text: 'Xin chào' } } })).status, 201);
  const [message] = await beat();
  assert.deepEqual([message.kind, message.payload], ['message', { text: 'Xin chào' }]);
  assert.equal((await as(player, `/live/${message.id}/done`, { method: 'POST', json: { ok: true, result: 'shown' } })).status, 200);
  assert.deepEqual(await beat(), []);

  // Bad inputs write nothing.
  const command = (kind, payload) => as(admin, `/admin/users/${player.user.id}/command`, { method: 'POST', json: { kind, payload } });
  assert.equal((await command('teleport', { scene: 0, room: 0 })).status, 400);
  assert.equal((await command('teleport', { scene: 77, room: 77 })).status, 400);
  assert.equal((await command('rm -rf', {})).status, 400);
  assert.equal((await command('mainTask', { progress: -4 })).status, 400);

  // Save commands change the save as the admin's revision and queue a reload.
  for (const [kind, payload] of [
    ['teleport', { scene: 1, room: 2 }], ['mainTask', { progress: 9 }],
    ['eventState', { scene: 4, room: 5, group: 6, state: 'complete' }], ['branchTask', { task: 7, status: 3 }],
    ['branchTask', { task: 12, status: 1 }], ['worldFlag', { flag: 5, on: false }], ['worldFlag', { flag: 44, on: true }],
    ['dismount', {}], ['clearSkills', {}],
  ]) assert.equal((await command(kind, payload)).status, 200, kind);
  const edited = await (await as(admin, `/admin/users/${player.user.id}/save`)).json();
  assert.deepEqual(edited.location, { sceneId: 1, roomIndex: 2, x: -1, y: -1, direction: 0, adminPlaced: true });
  assert.equal(edited.progress.mainTaskProgress, 9);
  assert.equal(edited.world.mainTaskProgress, 9);
  assert.equal(edited.eventStates['4:5:6'], 3);
  assert.equal(edited.story.quest.branch, '7:3,12:1');
  assert.deepEqual(edited.world.sourceWorldFlags, [44]);
  assert.deepEqual(edited.pendingSkillLearns, []);

  // Story rewind: only a step the save's journal has, Cầu Vồng only once reached; the game applies it.
  assert.equal((await command('storyRewind', { seq: 0 })).status, 400);
  assert.equal((await command('storyRewind', { seq: 3 })).status, 400);
  assert.equal((await command('storyRewind', { target: 'cv-start' })).status, 400);
  assert.equal((await command('mainTask', { progress: 48 })).status, 200);
  assert.equal((await command('storyRewind', { target: 'cv-start' })).status, 200);
  const rewinding = await (await as(admin, `/admin/users/${player.user.id}/save`)).json();
  assert.deepEqual(rewinding.storyRewind, { cauVongStart: true });
  assert.equal((await command('cancelStoryRewind', {})).status, 200);
  assert.equal('storyRewind' in (await (await as(admin, `/admin/users/${player.user.id}/save`)).json()), false);
  assert.equal((await command('mainTask', { progress: 9 })).status, 200);
  assert.equal((await command('eventState', { scene: 4, room: 5, group: 6, state: 'fresh' })).status, 200);
  assert.equal((await (await as(admin, `/admin/users/${player.user.id}/save`)).json()).eventStates['4:5:6'], undefined);

  // The game still on the old save cannot write over the admin: it is told to reload.
  const stale = await f.save(player.cookie, snapshot(999999), row);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'admin_changed');
  const reloads = await beat();
  assert.ok(reloads.length >= 1 && reloads.every(c => c.kind === 'reload'));
  // After reloading, the game's first beat spends the old reloads; it saves on the admin's revision.
  assert.deepEqual(await beat(true), []);
  const current = await (await as(admin, `/admin/users/${player.user.id}`)).json();
  const fresh = await f.load(player.cookie, { id: row.id, revision: current.user.revision });
  assert.equal(fresh.progress.mainTaskProgress, 9);
  const next = await f.save(player.cookie, fresh, { id: row.id, revision: current.user.revision });
  assert.equal(next.status, 200);
  // An ordinary conflict (two tabs) is still a plain conflict, not an admin change.
  const twoTabs = await f.save(player.cookie, fresh, { id: row.id, revision: current.user.revision });
  assert.equal((await twoTabs.json()).code, 'save_conflict');

  // History, cancel, reload-all.
  const live = await (await as(admin, `/admin/users/${player.user.id}/live`)).json();
  assert.ok(live.commands.length > 5 && live.presence.info.scene === 4);
  assert.equal((await as(admin, `/admin/users/${player.user.id}/command`, { method: 'POST', json: { kind: 'reload' } })).status, 201);
  const pending = (await (await as(admin, `/admin/users/${player.user.id}/live`)).json()).commands[0];
  assert.equal((await as(admin, `/admin/commands/${pending.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await as(admin, `/admin/commands/${pending.id}`, { method: 'DELETE' })).status, 409);
  assert.deepEqual(await beat(), []);
  assert.deepEqual(await (await as(admin, '/admin/online/reload', { method: 'POST' })).json(), { players: 1 });
  assert.equal((await beat())[0].kind, 'reload');
  f.advance(60_000);
  assert.equal((await (await as(admin, '/admin/online')).json()).online.length, 0);
});
