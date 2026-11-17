import { createServer } from 'node:http';
import { isGameSave } from '../src/persistence/save/GameSave.ts';
import { Store } from './store.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEV_BUILD_KEY_HEX, buildKeyId, envelopeAad, hexBytes, openSave, sealSave } from '../src/account/SaveEnvelope.ts';
import { auditSave } from './ledger.mjs';
import { adminRoutes } from './admin.mjs';
import { adminRoute } from './admin-grant.mjs';
import { presenceInfo } from './live.mjs';
import { bankFree, normalizeGiftCodeInput, rewardGrants } from './rewards.mjs';

const REDEEM_MESSAGES = {
  missing: 'Giftcode không tồn tại.',
  inactive: 'Giftcode hiện không hoạt động.',
  not_started: 'Giftcode chưa đến thời gian sử dụng.',
  expired: 'Giftcode đã hết hạn.',
  already: 'Tài khoản này đã dùng giftcode này rồi.',
  used_up: 'Giftcode đã hết lượt sử dụng.',
};
const bankFullMessage = pets => `Cần ${pets} chỗ trống trong ngân hàng sủng vật để nhận quà.`;
import { credentials, newToken, passwordHash, passwordMatches, sessionToken, tokenHash, SESSION_MS } from './auth.mjs';

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };
const MAX_SAVE = 2 * 1024 * 1024;
const WEB_NATIVE = 'web-native';

/**
 * The save envelope's build keys, newest first: deploy/build-keys.txt (renewed by
 * deploy/rotate-build-key.mjs on every deploy), or the dev key when there is no such file.
 */
export function loadBuildKeys(file = process.env.BUILD_KEYS_FILE ?? fileURLToPath(new URL('../deploy/build-keys.txt', import.meta.url))) {
  const keys = existsSync(file) ? readFileSync(file, 'utf8').split(/\s+/).filter(line => /^[0-9a-f]{64}$/.test(line)) : [];
  if (!keys.length) console.warn('VQSV_BUILD_KEY using the dev key: no', file);
  return (keys.length ? keys : [DEV_BUILD_KEY_HEX]).map(hexBytes);
}

async function bodyBytes(request, limit) {
  if (Number(request.headers['content-length']) > limit) {
    request.resume();
    fail(413, 'too_large', 'Dữ liệu vượt quá dung lượng cho phép.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) {
      request.resume();
      fail(413, 'too_large', 'Dữ liệu vượt quá dung lượng cho phép.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  if (!String(request.headers['content-type']).startsWith('application/json')) fail(415, 'content_type', 'Yêu cầu JSON.');
  const bytes = await bodyBytes(request, 4096);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { fail(400, 'invalid_json', 'Dữ liệu JSON không hợp lệ.'); }
}

export function createApplication({ databasePath, origin, secureCookies = true, now = Date.now, authLimit = 100, trustedProxy = false, buildKeys = loadBuildKeys() }) {
  const store = new Store(databasePath);
  const keyIds = Promise.all(buildKeys.map(buildKeyId));
  /** The session's envelope ticket; a session without one has expired. */
  function ticket(request) {
    const value = store.saveTicket(tokenHash(sessionToken(request.headers.cookie)));
    if (!value) fail(401, 'session_expired', 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.');
    return value;
  }
  function sealed(response, bytes) {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(Buffer.from(bytes));
  }
  const limits = new Map();
  const redeemTries = new Map();
  let hashing = 0;
  function authThrottle(request) {
    const key = trustedProxy ? String(request.headers['x-forwarded-for'] || request.socket.remoteAddress).split(',')[0].trim() : request.socket.remoteAddress;
    const time = now();
    for (const [ip, entry] of limits) if (entry.until <= time) limits.delete(ip);
    if (!limits.has(key)) {
      if (limits.size >= 10000) fail(429, 'rate_limit', 'Máy chủ đang bận. Hãy thử lại sau.');
      limits.set(key, { count: 0, until: time + 15 * 60000 });
    }
    if (++limits.get(key).count > authLimit) fail(429, 'rate_limit', 'Bạn thử quá nhiều lần. Hãy thử lại sau 15 phút.');
  }
  function user(request) {
    const token = sessionToken(request.headers.cookie);
    const account = token && store.userForSession(tokenHash(token), now());
    if (!account) fail(401, 'session_expired', 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.');
    return account;
  }
  function cookie(response, token, maxAge = SESSION_MS / 1000) {
    response.setHeader('Set-Cookie', `vqsv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`);
  }
  function reply(response, status, value) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(JSON.stringify(value));
  }
  const admin = adminRoutes({
    store, databasePath, reply, fail, readJson, now,
    readBody: request => bodyBytes(request, MAX_SAVE),
    validateSave: (json) => {
      try { return isGameSave(JSON.parse(json)); }
      catch { return false; }
    },
  });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://backend');
      const path = url.pathname;
      const method = request.method;
      if (!['GET', 'HEAD'].includes(method) && request.headers.origin !== origin)
        fail(403, 'origin', 'Nguồn yêu cầu không hợp lệ.');
      if (path === '/api/health' && method === 'GET') {
        store.db.prepare('SELECT 1').get();
        return reply(response, 200, { ok: true, service: 'vqsv-promax-save', saveVersion: 33 });
      }
      if (['/api/auth/login', '/api/auth/register'].includes(path) && method === 'POST') {
        authThrottle(request);
        const input = credentials(await readJson(request));
        if (!input) fail(400, 'credentials', 'Nhập email hợp lệ và mật khẩu từ 8 đến 128 ký tự.');
        if (hashing >= 4) fail(429, 'busy', 'Máy chủ đang bận. Hãy thử lại.');
        hashing++;
        let account;
        try {
          if (path.endsWith('/register')) {
            account = store.register(input.email, await passwordHash(input.password), now());
            if (!account) fail(409, 'exists', 'Email này đã có tài khoản.');
          } else {
            const stored = store.userByEmail(input.email);
            if (!(await passwordMatches(input.password, stored?.password_hash))) fail(401, 'login_failed', 'Email hoặc mật khẩu không đúng.');
            account = { id: stored.id, email: stored.email, role: stored.role };
          }
        } finally { hashing--; }
        const previous = sessionToken(request.headers.cookie);
        if (previous) store.revoke(tokenHash(previous));
        const token = newToken();
        if (!store.createSession(tokenHash(token), account.id, now() + SESSION_MS, now()))
          fail(403, 'account_locked', 'Tài khoản đã bị khóa.');
        cookie(response, token);
        return reply(response, path.endsWith('/register') ? 201 : 200, { user: account });
      }
      const account = user(request);
      if (request.headers['x-vqsv-account'] && request.headers['x-vqsv-account'] !== account.id)
        fail(409, 'account_changed', 'Tài khoản đã thay đổi ở tab khác. Hãy tải lại trang.');
      // The in-game Admin Tool: the server approves each grant and draws a new pet's random parts.
      if ((path === '/api/admin/status' && method === 'GET') || (path === '/api/admin/grant' && method === 'POST')) {
        const body = method === 'POST' ? await readJson(request) : {};
        const answer = adminRoute(account.role, [path.slice('/api/admin/'.length)], method, body);
        if (answer.body.grant) console.log('VQSV_ADMIN_GRANT', account.id, JSON.stringify(answer.body.grant));
        return reply(response, answer.status, answer.body);
      }
      if (path.startsWith('/api/admin/')) return await admin(request, response, url, account);
      if (path === '/api/gifts/redeem' && method === 'POST') {
        const input = await readJson(request);
        const code = normalizeGiftCodeInput(input?.code);
        if (!code) fail(400, 'code', 'Mã chỉ gồm A-Z, 0-9, dấu gạch ngang hoặc gạch dưới.');
        const time = now();
        const tries = redeemTries.get(account.id);
        if (tries && tries.until > time && tries.count >= 30) fail(429, 'rate_limit', 'Bạn nhập sai quá nhiều lần. Hãy thử lại sau 15 phút.');
        const result = store.redeemGiftCode(account.id, code, time, bankFree(input?.bankFree));
        if (result.status === 'bank_full') fail(409, 'bank_full', bankFullMessage(result.pets));
        if (result.status !== 'ok') {
          if (!tries || tries.until <= time) redeemTries.set(account.id, { count: 1, until: time + 15 * 60000 });
          else tries.count++;
          fail(result.status === 'missing' ? 404 : 409, result.status, REDEEM_MESSAGES[result.status]);
        }
        console.log('VQSV_GIFTCODE', account.id, code);
        return reply(response, 200, { code, description: result.description, grants: rewardGrants(result.rewards) });
      }
      if (path === '/api/mail' && method === 'GET') return reply(response, 200, { mail: store.inbox(account.id) });
      // The live channel (server/live.mjs): the game's heartbeat, and the admin commands it ran.
      if (path === '/api/live' && method === 'POST') {
        const input = await readJson(request);
        return reply(response, 200, { commands: store.liveBeat(account.id, presenceInfo(input), input?.first === true, now()) });
      }
      const done = /^\/api\/live\/(\d{1,12})\/done$/.exec(path);
      if (done && method === 'POST') {
        const input = await readJson(request);
        return reply(response, 200, { ok: store.finishCommand(account.id, Number(done[1]), input?.ok !== false, typeof input?.result === 'string' ? input.result : '', now()) });
      }
      const claim = /^\/api\/mail\/(\d{1,12})\/claim$/.exec(path);
      if (claim && method === 'POST') {
        const input = await readJson(request);
        const result = store.claimMail(account.id, Number(claim[1]), now(), bankFree(input?.bankFree));
        if (result.status === 'bank_full') fail(409, 'bank_full', bankFullMessage(result.pets));
        if (result.status !== 'ok') fail(404, 'not_found', 'Thư này đã được nhận hoặc không còn nữa.');
        console.log('VQSV_MAIL_CLAIM', account.id, claim[1]);
        return reply(response, 200, { title: result.title, body: result.body, grants: rewardGrants(result.rewards) });
      }
      if (path === '/api/auth/me' && method === 'GET') return reply(response, 200, { user: account });
      if (path === '/api/auth/logout' && method === 'POST') {
        store.revoke(tokenHash(sessionToken(request.headers.cookie)));
        cookie(response, '', 0);
        request.resume();
        return reply(response, 200, { ok: true });
      }
      if (path === '/api/saves' && method === 'GET') {
        const row = store.saveRow(account.id);
        return reply(response, 200, { saves: row ? [store.metadata(row)] : [], ticket: ticket(request) });
      }
      const match = /^\/api\/saves\/([a-zA-Z0-9-]+)(\/backup)?$/.exec(path);
      if (match && method === 'GET') {
        const row = store.saveRow(account.id);
        if (!row || row.id !== match[1]) fail(404, 'not_found', 'Không tìm thấy bản save.');
        const data = match[2] ? row.previous_json : row.current_json;
        if (!data) fail(404, 'not_found', 'Chưa có bản save dự phòng.');
        if (row.game_version !== WEB_NATIVE) return reply(response, 200, JSON.parse(data));
        // The game's own save goes down sealed, in the build key the game says it holds.
        const ids = await keyIds, wanted = ids.indexOf(String(request.headers['x-vqsv-build'] ?? ''));
        if (wanted < 0) fail(426, 'stale_build', 'Game vừa được cập nhật. Hãy tải lại trang (Ctrl+F5).');
        return sealed(response, await sealSave(data, ticket(request), buildKeys[wanted], envelopeAad(row.id, row.revision, 'down')));
      }
      if (match && !match[2] && method === 'DELETE') {
        const row = store.saveRow(account.id);
        if (!row || row.id !== match[1]) fail(404, 'not_found', 'Không tìm thấy bản save.');
        if (request.headers['if-match'] !== `"${row.revision}"` ||
            !store.deleteSave(account.id, match[1], row.revision))
          fail(409, 'save_conflict', 'Save đã thay đổi. Hãy tải lại save trước khi xóa.');
        return reply(response, 200, { ok: true });
      }
      if ((path === '/api/saves' && method === 'POST') || (match && !match[2] && method === 'PUT')) {
        const bytes = await bodyBytes(request, MAX_SAVE + 65536);
        let form;
        try { form = await new Request('http://backend', { method: 'POST', headers: { 'content-type': request.headers['content-type'] || '' }, body: bytes }).formData(); }
        catch { fail(400, 'form', 'Dữ liệu tải lên không hợp lệ.'); }
        const file = form.get('file');
        if (!(file instanceof Blob) || form.get('gameVersion') !== WEB_NATIVE) fail(400, 'save_format', 'Định dạng save không hợp lệ.');
        if (file.size > MAX_SAVE) fail(413, 'too_large', 'Save vượt quá dung lượng 2 MiB.');
        const revision = Number(form.get('revision'));
        if (method === 'PUT' && (!form.has('revision') || !Number.isSafeInteger(revision) || revision < 1)) fail(400, 'revision', 'Thiếu phiên bản save.');
        // Only a save the game sealed for this row and revision (SaveEnvelope.ts): plain JSON, an
        // edited envelope, another row's, an old revision's or a download sent back are refused.
        const text = await openSave(new Uint8Array(await file.arrayBuffer()), ticket(request), buildKeys,
          envelopeAad(match?.[1] || null, method === 'PUT' ? revision : 0, 'up'));
        if (text === null) {
          console.log('VQSV_SAVE_REJECTED', account.id);
          fail(400, 'save_sealed', 'Save không hợp lệ hoặc game vừa cập nhật. Hãy tải lại trang (Ctrl+F5).');
        }
        // The envelope is compressed: the 2 MiB limit is on the save itself.
        if (Buffer.byteLength(text) > MAX_SAVE) fail(413, 'too_large', 'Save vượt quá dung lượng 2 MiB.');
        let save;
        try { save = JSON.parse(text); }
        catch { fail(400, 'invalid_json', 'File save không phải JSON hợp lệ.'); }
        if (!isGameSave(save)) fail(400, 'save_format', 'Save không đúng cấu trúc phiên bản game hiện tại.');
        user(request);
        const before = store.saveRow(account.id);
        const result = store.write(account.id, match?.[1] || null, revision, JSON.stringify(save), now());
        if (result.status === 409 && result.admin) fail(409, 'admin_changed', 'Quản trị viên vừa chỉnh tiến trình của bạn. Game sẽ tải lại.');
        if (result.status === 409) fail(409, 'save_conflict', 'Save đã thay đổi ở phiên khác. Hãy tải lại tiến trình mới; dữ liệu chưa được ghi đè.');
        if (result.status === 404) fail(404, 'not_found', 'Không tìm thấy bản save.');
        // The money and pet log (server/ledger.mjs): never refuses, only records and warns.
        try {
          let previous = null;
          try { previous = before ? JSON.parse(before.current_json) : null; } catch { previous = null; }
          const audit = auditSave({ previous, next: save, claimed: source => store.sourceClaimed(account.id, source) });
          const alerts = account.role === 'admin' ? [] : audit.alerts;
          store.recordLedger(account.id, audit.entries, alerts, now());
          if (alerts.length) console.log('VQSV_ALERT', account.id, alerts.map(a => a.kind).join(','));
        } catch (error) { console.error('VQSV_LEDGER_ERROR', error?.message); }
        return reply(response, result.status, result.row);
      }
      fail(404, 'not_found', 'Không tìm thấy API.');
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      if (!(error instanceof HttpError)) console.error('VQSV_API_ERROR', error.code || error.name);
      reply(response, error.status || 500, { error: error.status ? error.message : 'Máy chủ gặp lỗi. Hãy thử lại.', code: error.code || 'server_error' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, close: () => new Promise(resolve => {
    server.close(() => { store.close(); resolve(); });
    server.closeIdleConnections();
  }) };
}
