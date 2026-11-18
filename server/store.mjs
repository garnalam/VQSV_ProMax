import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

/** A few facts read straight out of a player's current save, for the admin lists. */
const SAVE_SUMMARY = `
  json_extract(s.current_json,'$.currency.money') AS money,
  json_extract(s.current_json,'$.currency.badges') AS badges,
  json_extract(s.current_json,'$.currency.luong') AS luong,
  json_extract(s.current_json,'$.progress.mainTaskProgress') AS mainTask,
  json_extract(s.current_json,'$.playTimeMillis') AS playTime,
  json_extract(s.current_json,'$.location.sceneId') AS sceneId,
  json_array_length(s.current_json,'$.pets') AS partySize,
  json_array_length(s.current_json,'$.meta.campaign.petBank') AS bankSize,
  (SELECT MAX(json_extract(value,'$.level')) FROM json_each(s.current_json,'$.pets')) AS topLevel`;
const USER_SORTS = {
  new: 'createdAt DESC',
  recent: 'updatedAt IS NULL,updatedAt DESC',
  money: 'money IS NULL,money DESC',
  level: 'topLevel IS NULL,topLevel DESC',
  task: 'mainTask IS NULL,mainTask DESC',
  play: 'playTime IS NULL,playTime DESC',
};

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 4) throw new Error('Database schema is newer than this backend');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS saves (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        game_version TEXT NOT NULL, current_json TEXT NOT NULL, previous_json TEXT,
        revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_access (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
        locked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS admin_log (
        id INTEGER PRIMARY KEY, admin_id TEXT NOT NULL, target_id TEXT,
        action TEXT NOT NULL, created_at INTEGER NOT NULL, revision INTEGER
      );
      CREATE TABLE IF NOT EXISTS gift_codes (
        code TEXT PRIMARY KEY, description TEXT NOT NULL, rewards_json TEXT NOT NULL,
        max_uses INTEGER, starts_at INTEGER, expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, created_by TEXT
      );
      CREATE TABLE IF NOT EXISTS gift_redemptions (
        code TEXT NOT NULL REFERENCES gift_codes(code) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        redeemed_at INTEGER NOT NULL, PRIMARY KEY (code, user_id)
      );
      CREATE TABLE IF NOT EXISTS mail (
        id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, body TEXT NOT NULL, rewards_json TEXT NOT NULL,
        created_at INTEGER NOT NULL, created_by TEXT, batch TEXT, claimed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS mail_inbox ON mail(user_id, claimed_at);
      CREATE TABLE IF NOT EXISTS player_log (
        id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL, at INTEGER, kind TEXT NOT NULL, amount INTEGER, balance INTEGER,
        pet_json TEXT, source TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS player_log_user ON player_log(user_id, id);
      CREATE TABLE IF NOT EXISTS player_alerts (
        id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, text TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL, seen_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS player_alerts_open ON player_alerts(seen_at, id);
      CREATE TABLE IF NOT EXISTS admin_commands (
        id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL, created_by TEXT,
        status TEXT NOT NULL DEFAULT 'pending', delivered_at INTEGER, done_at INTEGER, result TEXT
      );
      CREATE INDEX IF NOT EXISTS admin_commands_user ON admin_commands(user_id, status, id);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS presence (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        seen_at INTEGER NOT NULL, since_at INTEGER NOT NULL, info TEXT
      );
    `);
    if (!this.db.prepare("SELECT 1 FROM pragma_table_info('admin_log') WHERE name='detail'").get())
      this.db.exec('ALTER TABLE admin_log ADD COLUMN detail TEXT');
    // The save envelope's per-login ticket (src/account/SaveEnvelope.ts).
    if (!this.db.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name='save_key'").get())
      this.db.exec('ALTER TABLE sessions ADD COLUMN save_key TEXT');
    // The last save revision an admin wrote: an older game's upload is refused, not merged.
    if (!this.db.prepare("SELECT 1 FROM pragma_table_info('saves') WHERE name='admin_revision'").get())
      this.db.exec('ALTER TABLE saves ADD COLUMN admin_revision INTEGER');
    this.db.exec('PRAGMA user_version=4');
  }
  close() { this.db.close(); }
  userByEmail(email) {
    return this.db.prepare(`
      SELECT u.*, COALESCE(a.role, 'player') AS role, a.locked_at
      FROM users u LEFT JOIN account_access a ON a.user_id=u.id WHERE u.email=?
    `).get(email);
  }
  register(email, hash, now) {
    const user = { id: randomUUID(), email };
    try { this.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id, email, hash, now); }
    catch (error) { if (String(error.message).includes('UNIQUE')) return null; throw error; }
    return user;
  }
  createSession(hash, userId, expiry, now) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    return this.db.prepare(`
      INSERT INTO sessions (token_hash,user_id,expires_at)
      SELECT ?,u.id,? FROM users u LEFT JOIN account_access a ON a.user_id=u.id
      WHERE u.id=? AND a.locked_at IS NULL
    `).run(hash, expiry, userId).changes > 0;
  }
  userForSession(hash, now) {
    return this.db.prepare(`
      SELECT u.id,u.email,COALESCE(a.role,'player') AS role
      FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN account_access a ON a.user_id=u.id
      WHERE s.token_hash=? AND s.expires_at>? AND a.locked_at IS NULL
    `).get(hash, now);
  }
  /** The session's save envelope ticket (base64, 32 bytes), made on first use. */
  saveTicket(hash) {
    const row = this.db.prepare('SELECT save_key FROM sessions WHERE token_hash=?').get(hash);
    if (!row) return null;
    if (row.save_key) return row.save_key;
    const key = randomBytes(32).toString('base64');
    this.db.prepare('UPDATE sessions SET save_key=? WHERE token_hash=? AND save_key IS NULL').run(key, hash);
    return this.db.prepare('SELECT save_key FROM sessions WHERE token_hash=?').get(hash)?.save_key ?? null;
  }
  /** Writes one upload's ledger lines and alerts (server/ledger.mjs). */
  recordLedger(userId, entries, alerts, now) {
    const line = this.db.prepare('INSERT INTO player_log (user_id,seq,at,kind,amount,balance,pet_json,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const e of entries)
      line.run(userId, e.seq, e.at, e.kind, e.amount, e.balance, e.pet ? JSON.stringify(e.pet) : null, e.source, now);
    const warn = this.db.prepare('INSERT INTO player_alerts (user_id,kind,text,detail,created_at) VALUES(?,?,?,?,?)');
    for (const a of alerts) warn.run(userId, a.kind, a.text, JSON.stringify(a.detail ?? {}), now);
  }
  /** Whether a `mail:<id>` / `gift:<code>` ledger source is one this player really claimed. */
  sourceClaimed(userId, source) {
    const [kind, id] = String(source).split(':');
    if (kind === 'mail') return !!this.db.prepare('SELECT 1 FROM mail WHERE id=? AND user_id=? AND claimed_at IS NOT NULL').get(Number(id), userId);
    if (kind === 'gift') return !!this.db.prepare('SELECT 1 FROM gift_redemptions WHERE code=? AND user_id=?').get(String(id ?? '').toUpperCase(), userId);
    return true;
  }
  playerLog(userId, limit = 300) {
    return this.db.prepare('SELECT seq,at,kind,amount,balance,pet_json AS pet,source,created_at AS createdAt FROM player_log WHERE user_id=? ORDER BY id DESC LIMIT ?')
      .all(userId, limit).map(row => ({ ...row, pet: row.pet ? JSON.parse(row.pet) : null }));
  }
  alerts({ open = true, userId = null, limit = 200 } = {}) {
    return this.db.prepare(`
      SELECT a.id,a.user_id AS userId,u.email,a.kind,a.text,a.detail,a.created_at AS createdAt,a.seen_at AS seenAt
      FROM player_alerts a JOIN users u ON u.id=a.user_id
      WHERE (? = 0 OR a.seen_at IS NULL) AND (? IS NULL OR a.user_id=?) ORDER BY a.id DESC LIMIT ?
    `).all(open ? 1 : 0, userId, userId, limit).map(row => ({ ...row, detail: row.detail ? JSON.parse(row.detail) : null }));
  }
  openAlertCount() { return this.db.prepare('SELECT COUNT(*) AS n FROM player_alerts WHERE seen_at IS NULL').get().n; }
  markAlertsSeen(ids, now) {
    const seen = this.db.prepare('UPDATE player_alerts SET seen_at=? WHERE id=? AND seen_at IS NULL');
    let changed = 0;
    for (const id of ids) changed += seen.run(now, id).changes;
    return changed;
  }
  revoke(hash) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); }
  saveRow(userId) { return this.db.prepare('SELECT * FROM saves WHERE user_id=?').get(userId); }
  metadata(row) { return { id: row.id, gameVersion: row.game_version, revision: row.revision, updatedAt: row.updated_at }; }
  write(userId, id, revision, json, now) {
    return this.transaction(() => this.writeInTransaction(userId, id, revision, json, now));
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  writeInTransaction(userId, id, revision, json, now) {
    const old = this.saveRow(userId);
    if ((!id && old) || (id && old && old.id === id && old.revision !== revision))
      // An admin wrote the save after this game loaded it: the game reloads the admin's version.
      return { status: 409, admin: !!old.admin_revision && (!id || old.admin_revision > revision) };
    if (id && (!old || old.id !== id)) return { status: 404 };
    if (old) {
      this.db.prepare('UPDATE saves SET previous_json=current_json,current_json=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?')
        .run(json, now, id, userId, revision);
    } else {
      this.db.prepare('INSERT INTO saves (id,user_id,game_version,current_json,previous_json,revision,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), userId, 'web-native', json, null, 1, now);
    }
    return { status: old ? 200 : 201, row: this.metadata(this.saveRow(userId)) };
  }
  deleteSave(userId, id, revision) {
    return this.db.prepare('DELETE FROM saves WHERE user_id=? AND id=? AND revision=?').run(userId, id, revision).changes > 0;
  }
  grantAdmin(email) {
    return this.transaction(() => {
      const account = this.userByEmail(email);
      if (!account || account.locked_at !== null) return false;
      this.db.prepare(`
        INSERT INTO account_access (user_id,role) VALUES (?,'admin')
        ON CONFLICT(user_id) DO UPDATE SET role='admin'
      `).run(account.id);
      return true;
    });
  }
  adminSummary() {
    return this.db.prepare(`
      SELECT (SELECT COUNT(*) FROM users) AS accounts,
             (SELECT COUNT(*) FROM saves) AS saves,
             (SELECT COUNT(*) FROM account_access WHERE locked_at IS NOT NULL) AS locked
    `).get();
  }
  adminUsers(search, page, sort = 'new') {
    // "VQSV 1A2B3C4D", a supporter's transfer note: the account id's first 8 hex digits.
    const code = String(search).trim().replace(/^vqsv\s*/i, '').toUpperCase();
    const order = USER_SORTS[sort] ?? USER_SORTS.new;
    return this.db.prepare(`
      SELECT * FROM (
        SELECT u.id,u.email,u.created_at AS createdAt,COALESCE(a.role,'player') AS role,
               a.locked_at AS lockedAt,s.revision,s.updated_at AS updatedAt,
               s.previous_json IS NOT NULL AS hasPrevious, ${SAVE_SUMMARY}
        FROM users u LEFT JOIN account_access a ON a.user_id=u.id LEFT JOIN saves s ON s.user_id=u.id
        WHERE instr(u.email,?)>0 OR (length(?)>0 AND instr(upper(replace(u.id,'-','')),?)=1)
      ) ORDER BY ${order},createdAt DESC,id LIMIT 26 OFFSET ?
    `).all(search, code, code, page * 25);
  }
  adminUser(id) {
    return this.db.prepare(`
      SELECT u.id,u.email,u.created_at AS createdAt,COALESCE(a.role,'player') AS role,
             a.locked_at AS lockedAt,s.revision,s.updated_at AS updatedAt,
             s.previous_json IS NOT NULL AS hasPrevious, ${SAVE_SUMMARY},
             (SELECT COUNT(*) FROM sessions WHERE user_id=u.id AND expires_at>?) AS sessions,
             (SELECT COUNT(*) FROM mail WHERE user_id=u.id AND claimed_at IS NULL) AS unclaimedMail
      FROM users u LEFT JOIN account_access a ON a.user_id=u.id LEFT JOIN saves s ON s.user_id=u.id
      WHERE u.id=?
    `).get(Date.now(), id);
  }
  adminAudit(limit = 15) {
    return this.db.prepare(`
      SELECT l.action,l.created_at AS at,l.revision,l.detail,admin.email AS admin,target.email AS target
      FROM admin_log l LEFT JOIN users admin ON admin.id=l.admin_id LEFT JOIN users target ON target.id=l.target_id
      ORDER BY l.id DESC LIMIT ?
    `).all(limit);
  }
  logAdmin(admin, target, action, now, revision = null, detail = null) {
    this.db.prepare('INSERT INTO admin_log (admin_id,target_id,action,created_at,revision,detail) VALUES(?,?,?,?,?,?)')
      .run(admin, target, action, now, revision, detail);
  }
  /** Server-wide numbers for the dashboard: activity, sign-ups per day, the leaderboards. */
  adminStats(now) {
    const day = 86400_000;
    const activity = this.db.prepare(`
      SELECT (SELECT COUNT(*) FROM saves WHERE updated_at>?) AS active24h,
             (SELECT COUNT(*) FROM saves WHERE updated_at>?) AS active7d,
             (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE expires_at>?) AS signedIn,
             (SELECT COUNT(*) FROM users WHERE created_at>?) AS new7d,
             (SELECT COUNT(*) FROM mail WHERE claimed_at IS NULL) AS unclaimedMail,
             (SELECT COUNT(*) FROM gift_codes WHERE active=1) AS activeCodes,
             (SELECT COUNT(*) FROM gift_redemptions) AS redemptions
    `).get(now - day, now - 7 * day, now, now - 7 * day);
    const signups = this.db.prepare(`
      SELECT date(created_at/1000,'unixepoch','+7 hours') AS day,COUNT(*) AS count FROM users
      WHERE created_at>? GROUP BY day ORDER BY day
    `).all(now - 14 * day);
    const saves = this.db.prepare(`
      SELECT date(updated_at/1000,'unixepoch','+7 hours') AS day,COUNT(*) AS count FROM saves
      WHERE updated_at>? GROUP BY day ORDER BY day
    `).all(now - 14 * day);
    const board = order => this.db.prepare(`
      SELECT * FROM (SELECT u.id,u.email,${SAVE_SUMMARY} FROM users u JOIN saves s ON s.user_id=u.id)
      ORDER BY ${order} LIMIT 10
    `).all();
    return {
      activity, signups, saves,
      leaders: { level: board(USER_SORTS.level), money: board(USER_SORTS.money), task: board(USER_SORTS.task), play: board(USER_SORTS.play) },
    };
  }
  revokeSessions(admin, target, now) {
    const count = this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target).changes;
    this.logAdmin(admin, target, 'logout', now, null, String(count));
    return count;
  }
  setPassword(admin, target, hash, now) {
    return this.transaction(() => {
      if (!this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, target).changes) return 404;
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target);
      this.logAdmin(admin, target, 'password', now);
      return 200;
    });
  }
  // ---- gift codes
  /** A JSON setting an admin edits (the support rates...), or `fallback`. */
  setting(key, fallback) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return fallback; }
  }
  saveSetting(admin, key, value, now) {
    const json = JSON.stringify(value);
    this.db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, json, now);
    this.logAdmin(admin, null, 'setting_' + key, now, null, json.slice(0, 500));
  }
  giftCodes() {
    return this.db.prepare(`
      SELECT g.code,g.description,g.rewards_json AS rewardsJson,g.max_uses AS maxUses,g.starts_at AS startsAt,
             g.expires_at AS expiresAt,g.active,g.created_at AS createdAt,
             (SELECT COUNT(*) FROM gift_redemptions r WHERE r.code=g.code) AS uses
      FROM gift_codes g ORDER BY g.created_at DESC
    `).all().map(({ rewardsJson, active, ...row }) => ({ ...row, active: !!active, rewards: JSON.parse(rewardsJson) }));
  }
  saveGiftCode(admin, code, now) {
    return this.transaction(() => {
      const existed = !!this.db.prepare('SELECT 1 FROM gift_codes WHERE code=?').get(code.code);
      this.db.prepare(`
        INSERT INTO gift_codes (code,description,rewards_json,max_uses,starts_at,expires_at,active,created_at,created_by)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(code) DO UPDATE SET description=excluded.description,rewards_json=excluded.rewards_json,
          max_uses=excluded.max_uses,starts_at=excluded.starts_at,expires_at=excluded.expires_at,active=excluded.active
      `).run(code.code, code.description, JSON.stringify(code.rewards), code.maxUses, code.startsAt, code.expiresAt,
        code.active ? 1 : 0, now, admin);
      this.logAdmin(admin, null, existed ? 'giftcode_edit' : 'giftcode_create', now, null, code.code);
      return existed ? 200 : 201;
    });
  }
  deleteGiftCode(admin, code, now) {
    const deleted = this.db.prepare('DELETE FROM gift_codes WHERE code=?').run(code).changes > 0;
    if (deleted) this.logAdmin(admin, null, 'giftcode_delete', now, null, code);
    return deleted;
  }
  giftCodeRedemptions(code) {
    return this.db.prepare(`
      SELECT u.email,r.redeemed_at AS at FROM gift_redemptions r JOIN users u ON u.id=r.user_id
      WHERE r.code=? ORDER BY r.redeemed_at DESC LIMIT 200
    `).all(code);
  }
  /** A player's redemption: the code's rewards, or why not. Recorded only when it succeeds. */
  redeemGiftCode(userId, code, now, petRoom) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM gift_codes WHERE code=?').get(code);
      if (!row) return { status: 'missing' };
      if (!row.active) return { status: 'inactive' };
      if (row.starts_at !== null && now < row.starts_at) return { status: 'not_started' };
      if (row.expires_at !== null && now > row.expires_at) return { status: 'expired' };
      if (this.db.prepare('SELECT 1 FROM gift_redemptions WHERE code=? AND user_id=?').get(code, userId))
        return { status: 'already' };
      if (row.max_uses !== null &&
          this.db.prepare('SELECT COUNT(*) AS n FROM gift_redemptions WHERE code=?').get(code).n >= row.max_uses)
        return { status: 'used_up' };
      const rewards = JSON.parse(row.rewards_json);
      if (rewards.pets.length > petRoom) return { status: 'bank_full', pets: rewards.pets.length };
      this.db.prepare('INSERT INTO gift_redemptions VALUES (?,?,?)').run(code, userId, now);
      return { status: 'ok', description: row.description, rewards };
    });
  }
  // ---- mailbox
  sendMail(admin, target, title, body, rewards, now) {
    return this.transaction(() => {
      const batch = randomUUID();
      const json = JSON.stringify(rewards);
      const insert = this.db.prepare(`
        INSERT INTO mail (user_id,title,body,rewards_json,created_at,created_by,batch)
        SELECT u.id,?,?,?,?,?,? FROM users u LEFT JOIN account_access a ON a.user_id=u.id
        WHERE (?='all' AND a.locked_at IS NULL) OR u.id=?
      `);
      const count = insert.run(title, body, json, now, admin, batch, target, target).changes;
      if (count) this.logAdmin(admin, target === 'all' ? null : target, 'mail', now, null,
        (target === 'all' ? `Tất cả (${count}): ` : '') + title);
      return count;
    });
  }
  adminMail(limit = 50) {
    return this.db.prepare(`
      SELECT m.batch,m.title,m.body,m.rewards_json AS rewardsJson,MIN(m.created_at) AS createdAt,
             COUNT(*) AS recipients,SUM(m.claimed_at IS NOT NULL) AS claimed,
             CASE WHEN COUNT(*)=1 THEN MAX(u.email) END AS email
      FROM mail m JOIN users u ON u.id=m.user_id
      GROUP BY COALESCE(m.batch,m.id) ORDER BY createdAt DESC LIMIT ?
    `).all(limit).map(({ rewardsJson, ...row }) => ({ ...row, rewards: JSON.parse(rewardsJson) }));
  }
  /** Takes back the gifts of one sending that nobody has claimed yet. */
  recallMail(admin, batch, now) {
    const count = this.db.prepare('DELETE FROM mail WHERE batch=? AND claimed_at IS NULL').run(batch).changes;
    if (count) this.logAdmin(admin, null, 'mail_recall', now, null, String(count));
    return count;
  }
  inbox(userId) {
    return this.db.prepare(`
      SELECT id,title,body,rewards_json AS rewardsJson,created_at AS createdAt FROM mail
      WHERE user_id=? AND claimed_at IS NULL ORDER BY id LIMIT 20
    `).all(userId).map(({ rewardsJson, ...row }) => ({ ...row, rewards: JSON.parse(rewardsJson) }));
  }
  claimMail(userId, id, now, petRoom) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM mail WHERE id=? AND user_id=? AND claimed_at IS NULL').get(id, userId);
      if (!row) return { status: 'missing' };
      const rewards = JSON.parse(row.rewards_json);
      if (rewards.pets.length > petRoom) return { status: 'bank_full', pets: rewards.pets.length };
      this.db.prepare('UPDATE mail SET claimed_at=? WHERE id=?').run(now, id);
      return { status: 'ok', title: row.title, body: row.body, rewards };
    });
  }
  lockAccount(admin, target, locked, now) {
    return this.transaction(() => {
      const account = this.db.prepare(`
        SELECT a.role,a.locked_at FROM users u LEFT JOIN account_access a ON a.user_id=u.id WHERE u.id=?
      `).get(target);
      if (!account) return 404;
      if (account.role === 'admin' || admin === target) return 403;
      if ((account.locked_at !== null) === locked) return 200;
      this.db.prepare(`
        INSERT INTO account_access (user_id,locked_at) VALUES(?,?)
        ON CONFLICT(user_id) DO UPDATE SET locked_at=excluded.locked_at
      `).run(target, locked ? now : null);
      if (locked) this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target);
      this.logAdmin(admin, target, locked ? 'lock' : 'unlock', now);
      return 200;
    });
  }
  setRole(admin, target, role, now) {
    return this.transaction(() => {
      const account = this.db.prepare(`
        SELECT COALESCE(a.role,'player') AS role,a.locked_at FROM users u LEFT JOIN account_access a ON a.user_id=u.id WHERE u.id=?
      `).get(target);
      if (!account) return 404;
      if (admin === target) return 403;
      if (role === 'admin' && account.locked_at != null) return 409;
      if (account.role === role) return 200;
      this.db.prepare(`
        INSERT INTO account_access (user_id,role) VALUES(?,?)
        ON CONFLICT(user_id) DO UPDATE SET role=excluded.role
      `).run(target, role);
      this.logAdmin(admin, target, role === 'admin' ? 'grant_admin' : 'revoke_admin', now);
      return 200;
    });
  }
  /** `expected`: the revision the admin edited, or null to replace whatever is there. */
  adminReplaceSave(admin, target, json, now, expected = null, action = 'upload') {
    return this.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM users WHERE id=?').get(target)) return { status: 404 };
      const old = this.saveRow(target);
      if (expected !== null && (old?.revision ?? 0) !== expected) return { status: 409 };
      if (old) {
        this.db.prepare('UPDATE saves SET previous_json=current_json,current_json=?,revision=revision+1,admin_revision=revision+1,updated_at=? WHERE id=?')
          .run(json, now, old.id);
      } else {
        this.db.prepare('INSERT INTO saves (id,user_id,game_version,current_json,previous_json,revision,updated_at,admin_revision) VALUES(?,?,?,?,?,?,?,1)').run(randomUUID(), target, 'web-native', json, null, 1, now);
      }
      const row = this.saveRow(target);
      this.logAdmin(admin, target, action, now, row.revision);
      return { status: 200, save: this.metadata(row) };
    });
  }
  restorePrevious(admin, target, revision, now, isValid) {
    return this.transaction(() => {
      const save = this.saveRow(target);
      if (!save || !save.previous_json) return { status: 404 };
      if (save.revision !== revision) return { status: 409 };
      if (!isValid(save.previous_json)) return { status: 422 };
      this.db.prepare(`
        UPDATE saves SET current_json=previous_json,previous_json=current_json,revision=revision+1,admin_revision=revision+1,updated_at=?
        WHERE id=?
      `).run(now, save.id);
      this.logAdmin(admin, target, 'restore', now, revision + 1);
      return { status: 200, save: this.metadata(this.saveRow(target)) };
    });
  }
  // ---- the live channel (server/live.mjs): commands to a running game, and who is playing
  queueCommand(admin, target, kind, payload, now) {
    const id = this.db.prepare('INSERT INTO admin_commands (user_id,kind,payload,created_at,created_by) VALUES(?,?,?,?,?)')
      .run(target, kind, payload === undefined || payload === null ? null : JSON.stringify(payload), now, admin).lastInsertRowid;
    return Number(id);
  }
  /** A game's heartbeat: notes where it is and hands over the commands waiting for it. */
  liveBeat(userId, info, first, now) {
    return this.transaction(() => {
      const old = this.db.prepare('SELECT since_at,seen_at FROM presence WHERE user_id=?').get(userId);
      const since = old && !first && now - old.seen_at < 120_000 ? old.since_at : now;
      this.db.prepare(`INSERT INTO presence (user_id,seen_at,since_at,info) VALUES(?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET seen_at=excluded.seen_at,since_at=excluded.since_at,info=excluded.info`)
        .run(userId, now, since, JSON.stringify(info ?? {}));
      // A game that has just loaded already holds the newest save: older reloads are spent.
      if (first) this.db.prepare(`UPDATE admin_commands SET status='done',done_at=?,result='Game vừa tải lại.'
        WHERE user_id=? AND kind='reload' AND status IN ('pending','delivered')`).run(now, userId);
      const rows = this.db.prepare(`SELECT id,kind,payload,created_at AS createdAt FROM admin_commands
        WHERE user_id=? AND status IN ('pending','delivered') AND created_at>? ORDER BY id LIMIT 20`).all(userId, now - 7 * 86400_000);
      const mark = this.db.prepare("UPDATE admin_commands SET status='delivered',delivered_at=COALESCE(delivered_at,?) WHERE id=?");
      for (const row of rows) mark.run(now, row.id);
      return rows.map(row => ({ ...row, payload: row.payload ? JSON.parse(row.payload) : null }));
    });
  }
  finishCommand(userId, id, ok, result, now) {
    return this.db.prepare(`UPDATE admin_commands SET status=?,done_at=?,result=? WHERE id=? AND user_id=? AND status IN ('pending','delivered')`)
      .run(ok ? 'done' : 'failed', now, String(result ?? '').slice(0, 300), id, userId).changes > 0;
  }
  cancelCommand(admin, id, now) {
    const row = this.db.prepare("SELECT user_id FROM admin_commands WHERE id=? AND status IN ('pending','delivered')").get(id);
    if (!row) return false;
    this.db.prepare("UPDATE admin_commands SET status='cancelled',done_at=? WHERE id=?").run(now, id);
    this.logAdmin(admin, row.user_id, 'live:cancel', now, null, String(id));
    return true;
  }
  commands(userId, limit = 30) {
    return this.db.prepare(`SELECT c.id,c.kind,c.payload,c.created_at AS createdAt,c.status,c.delivered_at AS deliveredAt,
        c.done_at AS doneAt,c.result,u.email AS admin FROM admin_commands c LEFT JOIN users u ON u.id=c.created_by
      WHERE c.user_id=? ORDER BY c.id DESC LIMIT ?`).all(userId, limit)
      .map(row => ({ ...row, payload: row.payload ? JSON.parse(row.payload) : null }));
  }
  presence(userId) {
    const row = this.db.prepare('SELECT seen_at AS seenAt,since_at AS sinceAt,info FROM presence WHERE user_id=?').get(userId);
    return row ? { ...row, info: row.info ? JSON.parse(row.info) : {} } : null;
  }
  /** The games that sent a heartbeat in the last `windowMs`. */
  online(now, windowMs = 45_000) {
    return this.db.prepare(`SELECT p.user_id AS userId,u.email,p.seen_at AS seenAt,p.since_at AS sinceAt,p.info,COALESCE(a.role,'player') AS role
      FROM presence p JOIN users u ON u.id=p.user_id LEFT JOIN account_access a ON a.user_id=u.id
      WHERE p.seen_at>? ORDER BY p.since_at`).all(now - windowMs)
      .map(row => ({ ...row, info: row.info ? JSON.parse(row.info) : {} }));
  }
  /** An admin's change to the save itself (server/live.mjs), written as the admin's revision. */
  adminTransformSave(admin, target, transform, action, detail, now) {
    return this.transaction(() => {
      const old = this.saveRow(target);
      if (!old || old.game_version !== 'web-native') return { status: 404 };
      const json = JSON.stringify(transform(JSON.parse(old.current_json)));
      this.db.prepare('UPDATE saves SET previous_json=current_json,current_json=?,revision=revision+1,admin_revision=revision+1,updated_at=? WHERE id=?')
        .run(json, now, old.id);
      const row = this.saveRow(target);
      this.logAdmin(admin, target, action, now, row.revision, detail);
      return { status: 200, save: this.metadata(row) };
    });
  }
}
