import { createServer } from 'node:http';
import { isGameSave } from '../src/persistence/save/GameSave.ts';
import { Store } from './store.mjs';
import { credentials, newToken, passwordHash, passwordMatches, sessionToken, tokenHash, SESSION_MS } from './auth.mjs';

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };
const MAX_SAVE = 2 * 1024 * 1024;

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

export function createApplication({ databasePath, origin, secureCookies = true, now = Date.now, authLimit = 100, trustedProxy = false }) {
  const store = new Store(databasePath);
  const limits = new Map();
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
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://backend').pathname;
      const method = request.method;
      if (!['GET', 'HEAD'].includes(method) && request.headers.origin !== origin)
        fail(403, 'origin', 'Nguồn yêu cầu không hợp lệ.');
      if (path === '/api/health' && method === 'GET') {
        store.db.prepare('SELECT 1').get();
        return reply(response, 200, { ok: true, service: 'vqsv-promax-save', saveVersion: 33 });
      }
      if (['/api/auth/login', '/api/auth/register'].includes(path) && method === 'POST') {
        authThrottle(request);
        if (!String(request.headers['content-type']).startsWith('application/json')) fail(415, 'content_type', 'Yêu cầu JSON.');
        const bytes = await bodyBytes(request, 4096);
        let input;
        try { input = credentials(JSON.parse(bytes.toString('utf8'))); }
        catch { fail(400, 'invalid_json', 'Dữ liệu JSON không hợp lệ.'); }
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
            account = { id: stored.id, email: stored.email };
          }
        } finally { hashing--; }
        const previous = sessionToken(request.headers.cookie);
        if (previous) store.revoke(tokenHash(previous));
        const token = newToken();
        store.createSession(tokenHash(token), account.id, now() + SESSION_MS, now());
        cookie(response, token);
        return reply(response, path.endsWith('/register') ? 201 : 200, { user: account });
      }
      const account = user(request);
      if (request.headers['x-vqsv-account'] && request.headers['x-vqsv-account'] !== account.id)
        fail(409, 'account_changed', 'Tài khoản đã thay đổi ở tab khác. Hãy tải lại trang.');
      if (path === '/api/auth/me' && method === 'GET') return reply(response, 200, { user: account });
      if (path === '/api/auth/logout' && method === 'POST') {
        store.revoke(tokenHash(sessionToken(request.headers.cookie)));
        cookie(response, '', 0);
        request.resume();
        return reply(response, 200, { ok: true });
      }
      if (path === '/api/saves' && method === 'GET') {
        const row = store.saveRow(account.id);
        return reply(response, 200, { saves: row ? [store.metadata(row)] : [] });
      }
      const match = /^\/api\/saves\/([a-zA-Z0-9-]+)(\/backup)?$/.exec(path);
      if (match && method === 'GET') {
        const row = store.saveRow(account.id);
        if (!row || row.id !== match[1]) fail(404, 'not_found', 'Không tìm thấy bản save.');
        const data = match[2] ? row.previous_json : row.current_json;
        if (!data) fail(404, 'not_found', 'Chưa có bản save dự phòng.');
        return reply(response, 200, JSON.parse(data));
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
        if (!(file instanceof Blob) || form.get('gameVersion') !== 'web-native') fail(400, 'save_format', 'Định dạng save không hợp lệ.');
        if (file.size > MAX_SAVE) fail(413, 'too_large', 'Save vượt quá dung lượng 2 MiB.');
        let save;
        try { save = JSON.parse(await file.text()); }
        catch { fail(400, 'invalid_json', 'File save không phải JSON hợp lệ.'); }
        if (!isGameSave(save)) fail(400, 'save_format', 'Save không đúng cấu trúc phiên bản game hiện tại.');
        const revision = Number(form.get('revision'));
        if (method === 'PUT' && (!form.has('revision') || !Number.isSafeInteger(revision) || revision < 1)) fail(400, 'revision', 'Thiếu phiên bản save.');
        user(request);
        const result = store.write(account.id, match?.[1] || null, revision, JSON.stringify(save), now());
        if (result.status === 409) fail(409, 'save_conflict', 'Save đã thay đổi ở phiên khác. Hãy tải lại tiến trình mới; dữ liệu chưa được ghi đè.');
        if (result.status === 404) fail(404, 'not_found', 'Không tìm thấy bản save.');
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
