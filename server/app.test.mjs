import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from './app.mjs';

const origin = 'https://game.example';
const snapshot = (money = 12) => ({
  format: 'vqsv-web-save', version: 33, savedAt: '2026-11-13T00:00:00.000Z',
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
    app = createApplication({ databasePath, origin, now: () => clock, ...options });
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
  const save = (cookie, value, row) => {
    const form = new FormData();
    form.set('file', new Blob([JSON.stringify(value)], { type: 'application/json' }), 'save.json');
    form.set('gameVersion', 'web-native');
    form.set('name', 'Save web-native');
    if (row) form.set('revision', String(row.revision));
    return request(`/saves${row ? `/${row.id}` : ''}`, { cookie, method: row ? 'PUT' : 'POST', body: form });
  };
  return { databasePath, request, register, save, advance: ms => { clock += ms; }, restart: async () => { await app.close(); await open(); } };
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
  assert.equal((await (await f.request(`/saves/${row.id}`, { cookie: a.cookie })).json()).currency.money, 24);
  assert.equal((await (await f.request(`/saves/${row.id}/backup`, { cookie: a.cookie })).json()).currency.money, 12);
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
  const current = await (await f.request(`/saves/${row.id}`, { cookie: a.cookie })).json();
  assert.ok([100, 200].includes(current.currency.money));
  assert.equal((await (await f.request('/saves', { cookie: a.cookie })).json()).saves[0].revision, 2);
});
