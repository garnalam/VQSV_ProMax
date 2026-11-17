import { createReadStream, statSync, statfsSync } from 'node:fs';
import { chmod, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backup } from 'node:sqlite';
import { passwordHash } from './auth.mjs';
import { GIFT_CODE_PATTERN, normalizeRewards } from './rewards.mjs';
import { LIVE_KINDS, SAVE_COMMANDS } from './live.mjs';

const USER_ID = '([a-f0-9-]{36})';
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const time = value => (value === null || value === undefined || value === '' ? null
  : Number.isSafeInteger(value) && value >= 0 ? value : undefined);

/** The admin page's API (`/admin/`): every route needs a signed-in admin. */
export function adminRoutes({ store, databasePath, reply, fail, readJson, readBody, now, validateSave }) {
  const directory = dirname(databasePath);
  const backupPath = join(directory, 'admin-backup.sqlite');
  let backingUp = false;

  function backupAt() {
    return statSync(backupPath, { throwIfNoEntry: false })?.mtimeMs ?? null;
  }
  function rewards(input) {
    const value = normalizeRewards(input);
    if (!value) fail(400, 'rewards', 'Quà không hợp lệ: cần ít nhất một phần quà, tối đa 20 vật phẩm và 6 pet (trừ pet boss).');
    return value;
  }
  function giftCode(input, code) {
    const description = text(input?.description, 200);
    const maxUses = input?.maxUses === null || input?.maxUses === undefined || input?.maxUses === '' ? null : Number(input.maxUses);
    const startsAt = time(input?.startsAt);
    const expiresAt = time(input?.expiresAt);
    if (!GIFT_CODE_PATTERN.test(code)) fail(400, 'code', 'Mã chỉ gồm A-Z, 0-9, gạch ngang, gạch dưới (4–32 ký tự).');
    if (!description) fail(400, 'description', 'Hãy nhập mô tả quà (người chơi sẽ thấy dòng này).');
    if (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses < 1)) fail(400, 'max_uses', 'Số lượt dùng không hợp lệ.');
    if (startsAt === undefined || expiresAt === undefined) fail(400, 'time', 'Thời gian không hợp lệ.');
    if (startsAt !== null && expiresAt !== null && expiresAt <= startsAt) fail(400, 'time', 'Hạn dùng phải sau thời điểm bắt đầu.');
    return { code, description, rewards: rewards(input?.rewards), maxUses, startsAt, expiresAt, active: input?.active !== false };
  }

  return async function route(request, response, url, account) {
    if (account.role !== 'admin') fail(403, 'admin_only', 'Tài khoản này chưa có quyền quản trị.');
    const { pathname } = url;
    const { method } = request;
    if (pathname === '/api/admin/overview' && method === 'GET') {
      const disk = statfsSync(directory);
      return reply(response, 200, {
        summary: store.adminSummary(), disk: { total: disk.blocks * disk.bsize, free: disk.bavail * disk.bsize },
        backupAt: backupAt(), audit: store.adminAudit(15), stats: store.adminStats(now()), openAlerts: store.openAlertCount(),
      });
    }
    if (pathname === '/api/admin/audit' && method === 'GET')
      return reply(response, 200, { audit: store.adminAudit(200) });
    // The money and pet log's warnings (server/ledger.mjs) and each player's log.
    if (pathname === '/api/admin/alerts' && method === 'GET')
      return reply(response, 200, { alerts: store.alerts({ open: url.searchParams.get('all') !== '1' }), open: store.openAlertCount() });
    if (pathname === '/api/admin/alerts/seen' && method === 'POST') {
      const input = await readJson(request);
      const ids = Array.isArray(input?.ids) ? input.ids.filter(Number.isSafeInteger).slice(0, 500) : [];
      return reply(response, 200, { seen: store.markAlertsSeen(ids, now()) });
    }
    const playerLog = new RegExp(`^/api/admin/users/${USER_ID}/ledger$`).exec(pathname);
    if (playerLog && method === 'GET')
      return reply(response, 200, { log: store.playerLog(playerLog[1]), alerts: store.alerts({ open: false, userId: playerLog[1] }) });
    if (pathname === '/api/admin/users' && method === 'GET') {
      const search = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 160);
      const page = Number(url.searchParams.get('page') ?? 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 100000)
        fail(400, 'page', 'Số trang không hợp lệ.');
      const rows = store.adminUsers(search, page, url.searchParams.get('sort') ?? 'new');
      return reply(response, 200, { users: rows.slice(0, 25), hasMore: rows.length > 25 });
    }
    if (pathname === '/api/admin/backup' && method === 'POST') {
      if (backingUp) fail(409, 'backup_pending', 'Đang sao lưu database.');
      const temporary = backupPath + '.' + randomUUID() + '.tmp';
      backingUp = true;
      try {
        await backup(store.db, temporary);
        await chmod(temporary, 0o600);
        await rename(temporary, backupPath);
        store.logAdmin(account.id, null, 'backup', now());
        return reply(response, 200, { backupAt: backupAt() });
      } finally {
        backingUp = false;
        await rm(temporary, { force: true });
      }
    }
    if (pathname === '/api/admin/backup/download' && method === 'GET') {
      const size = statSync(backupPath, { throwIfNoEntry: false })?.size;
      if (!size) fail(404, 'not_found', 'Chưa có bản sao lưu. Hãy bấm Sao lưu ngay trước.');
      store.logAdmin(account.id, null, 'download', now());
      response.writeHead(200, {
        'content-type': 'application/vnd.sqlite3', 'content-length': size, 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="vqsv-game-${new Date(backupAt()).toISOString().slice(0, 10)}.sqlite"`,
      });
      return createReadStream(backupPath).pipe(response);
    }

    // ---- gift codes
    if (pathname === '/api/admin/giftcodes' && method === 'GET')
      return reply(response, 200, { codes: store.giftCodes() });
    if (pathname === '/api/admin/giftcodes' && method === 'POST') {
      const input = await readJson(request);
      const code = giftCode(input, text(input?.code, 40).toUpperCase());
      const status = store.saveGiftCode(account.id, code, now());
      return reply(response, status, { code: code.code });
    }
    const codeMatch = /^\/api\/admin\/giftcodes\/([A-Za-z0-9_-]{1,40})(\/redemptions)?$/.exec(pathname);
    if (codeMatch) {
      const code = codeMatch[1].toUpperCase();
      if (codeMatch[2] && method === 'GET') return reply(response, 200, { redemptions: store.giftCodeRedemptions(code) });
      if (!codeMatch[2] && method === 'DELETE') {
        if (!store.deleteGiftCode(account.id, code, now())) fail(404, 'not_found', 'Không tìm thấy giftcode.');
        return reply(response, 200, { ok: true });
      }
    }

    // ---- mailbox
    if (pathname === '/api/admin/mail' && method === 'GET')
      return reply(response, 200, { mail: store.adminMail(60) });
    if (pathname === '/api/admin/mail' && method === 'POST') {
      const input = await readJson(request);
      const title = text(input?.title, 80);
      const body = text(input?.body, 300);
      const target = input?.target === 'all' ? 'all' : text(input?.target, 36);
      if (!title) fail(400, 'title', 'Hãy nhập tiêu đề thư.');
      if (target !== 'all' && !/^[a-f0-9-]{36}$/.test(target)) fail(400, 'target', 'Người nhận không hợp lệ.');
      const count = store.sendMail(account.id, target, title, body, rewards(input?.rewards), now());
      if (!count) fail(404, 'not_found', 'Không có người nhận nào.');
      return reply(response, 201, { recipients: count });
    }
    const mailMatch = /^\/api\/admin\/mail\/([a-f0-9-]{36})$/.exec(pathname);
    if (mailMatch && method === 'DELETE')
      return reply(response, 200, { recalled: store.recallMail(account.id, mailMatch[1], now()) });

    // ---- the live channel (server/live.mjs): who is playing, and commands to their game
    if (pathname === '/api/admin/online' && method === 'GET')
      return reply(response, 200, { online: store.online(now()) });
    if (pathname === '/api/admin/online/reload' && method === 'POST') {
      request.resume();
      const players = store.online(now()).filter(row => row.userId !== account.id);
      for (const row of players) store.queueCommand(account.id, row.userId, 'reload', null, now());
      store.logAdmin(account.id, null, 'live:reload-all', now(), null, String(players.length));
      return reply(response, 200, { players: players.length });
    }
    const commandMatch = /^\/api\/admin\/commands\/(\d{1,12})$/.exec(pathname);
    if (commandMatch && method === 'DELETE') {
      if (!store.cancelCommand(account.id, Number(commandMatch[1]), now())) fail(409, 'command_done', 'Lệnh này đã chạy hoặc đã huỷ.');
      return reply(response, 200, { ok: true });
    }

    // ---- one account
    const userMatch = new RegExp(`^/api/admin/users/${USER_ID}(?:/(lock|role|logout|password|live|command|save(?:/(?:backup|restore))?))?$`).exec(pathname);
    if (!userMatch) fail(404, 'not_found', 'Không tìm thấy API quản trị.');
    const [, target, action] = userMatch;
    if (!action && method === 'GET') {
      const user = store.adminUser(target);
      if (!user) fail(404, 'not_found', 'Không tìm thấy tài khoản.');
      return reply(response, 200, { user });
    }
    if (action === 'live' && method === 'GET') {
      if (!store.adminUser(target)) fail(404, 'not_found', 'Không tìm thấy tài khoản.');
      return reply(response, 200, { presence: store.presence(target), commands: store.commands(target), now: now() });
    }
    if (action === 'command' && method === 'POST') {
      const input = await readJson(request);
      const kind = text(input?.kind, 30);
      if (!store.adminUser(target)) fail(404, 'not_found', 'Không tìm thấy tài khoản.');
      if (LIVE_KINDS.has(kind)) {
        let payload = null;
        if (kind === 'message') {
          const message = text(input?.payload?.text, 300);
          if (!message) fail(400, 'command', 'Hãy nhập nội dung tin nhắn.');
          payload = { text: message };
        }
        const id = store.queueCommand(account.id, target, kind, payload, now());
        store.logAdmin(account.id, target, `live:${kind}`, now(), null, payload?.text ?? null);
        return reply(response, 201, { id });
      }
      const make = Object.hasOwn(SAVE_COMMANDS, kind) ? SAVE_COMMANDS[kind] : null;
      if (!make) fail(400, 'command', 'Lệnh không hợp lệ.');
      const command = make(input?.payload ?? {});
      const result = store.adminTransformSave(account.id, target, save => {
        const next = command.apply(save);
        if (!validateSave(JSON.stringify(next))) fail(422, 'save_format', 'Save sau khi sửa không hợp lệ; chưa ghi gì.');
        return next;
      }, `live:${kind}`, command.describe, now());
      if (result.status === 404) fail(404, 'not_found', 'Người chơi này chưa có save của bản web.');
      // The running game (if any) loads the changed save; an offline player gets it at next login.
      const id = store.queueCommand(account.id, target, 'reload', { reason: kind }, now());
      return reply(response, 200, { save: result.save, id, describe: command.describe });
    }
    if (action === 'lock' && method === 'POST') {
      const input = await readJson(request);
      if (typeof input?.locked !== 'boolean') fail(400, 'locked', 'Trạng thái khóa không hợp lệ.');
      const status = store.lockAccount(account.id, target, input.locked, now());
      if (status === 404) fail(404, 'not_found', 'Không tìm thấy tài khoản.');
      if (status === 403) fail(403, 'admin_target', 'Không thể khóa tài khoản quản trị.');
      return reply(response, 200, { locked: input.locked });
    }
    if (action === 'role' && method === 'POST') {
      const input = await readJson(request);
      if (input?.role !== 'admin' && input?.role !== 'player') fail(400, 'role', 'Quyền không hợp lệ.');
      const status = store.setRole(account.id, target, input.role, now());
      if (status === 404) fail(404, 'not_found', 'Không tìm thấy tài khoản.');
      if (status === 403) fail(403, 'self_target', 'Không thể tự đổi quyền của chính mình.');
      if (status === 409) fail(409, 'locked_target', 'Hãy mở khóa tài khoản trước khi cấp quyền quản trị.');
      return reply(response, 200, { role: input.role });
    }
    if (action === 'logout' && method === 'POST') {
      request.resume();
      return reply(response, 200, { sessions: store.revokeSessions(account.id, target, now()) });
    }
    if (action === 'password' && method === 'POST') {
      const input = await readJson(request);
      const password = typeof input?.password === 'string' ? input.password : '';
      if (password.length < 8 || password.length > 128) fail(400, 'password', 'Mật khẩu mới cần 8–128 ký tự.');
      if (target === account.id) fail(403, 'self_target', 'Hãy đổi mật khẩu của chính mình bằng cách khác.');
      if (store.setPassword(account.id, target, await passwordHash(password), now()) === 404)
        fail(404, 'not_found', 'Không tìm thấy tài khoản.');
      return reply(response, 200, { ok: true });
    }
    if (action === 'save' && method === 'PUT') {
      if (!String(request.headers['content-type']).startsWith('application/json')) fail(415, 'content_type', 'Yêu cầu JSON.');
      const match = /^"(\d+)"$/.exec(request.headers['if-match'] ?? '');
      const expected = match ? Number(match[1]) : null;
      let save;
      try { save = JSON.parse((await readBody(request)).toString('utf8')); }
      catch (error) { if (error.status) throw error; fail(400, 'invalid_json', 'File save không phải JSON hợp lệ.'); }
      const json = JSON.stringify(save);
      if (!validateSave(json)) fail(422, 'save_format', 'File không đúng cấu trúc save của phiên bản game hiện tại.');
      const result = store.adminReplaceSave(account.id, target, json, now(), expected, expected === null ? 'upload' : 'edit');
      if (result.status === 404) fail(404, 'not_found', 'Không tìm thấy tài khoản.');
      if (result.status === 409) fail(409, 'save_conflict', 'Người chơi vừa lưu game sau khi bạn mở save. Hãy tải lại save rồi sửa lại.');
      store.queueCommand(account.id, target, 'reload', { reason: 'save' }, now());
      return reply(response, 200, { save: result.save });
    }
    if ((action === 'save' || action === 'save/backup') && method === 'GET') {
      const row = store.saveRow(target);
      const data = action === 'save' ? row?.current_json : row?.previous_json;
      if (!data) fail(404, 'not_found', 'Không tìm thấy bản save.');
      response.setHeader('Content-Disposition', `attachment; filename="vqsv-save-${row.id}-${action === 'save' ? 'current' : 'previous'}.json"`);
      response.setHeader('ETag', `"${row.revision}"`);
      return reply(response, 200, JSON.parse(data));
    }
    if (action === 'save/restore' && method === 'POST') {
      const input = await readJson(request);
      if (!Number.isSafeInteger(input?.revision) || input.revision < 1)
        fail(400, 'revision', 'Thiếu phiên bản save.');
      const result = store.restorePrevious(account.id, target, input.revision, now(), validateSave);
      if (result.status === 404) fail(404, 'not_found', 'Chưa có bản save trước.');
      if (result.status === 409) fail(409, 'save_conflict', 'Save đã thay đổi. Hãy tải lại danh sách.');
      if (result.status === 422) fail(422, 'save_format', 'Bản trước không đúng cấu trúc save của game.');
      store.queueCommand(account.id, target, 'reload', { reason: 'restore' }, now());
      return reply(response, 200, { save: result.save });
    }
    fail(404, 'not_found', 'Không tìm thấy API quản trị.');
  };
}
