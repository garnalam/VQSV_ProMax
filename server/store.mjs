import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('Database schema is newer than this backend');
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
      PRAGMA user_version=1;
    `);
  }
  close() { this.db.close(); }
  userByEmail(email) { return this.db.prepare('SELECT * FROM users WHERE email=?').get(email); }
  register(email, hash, now) {
    const user = { id: randomUUID(), email };
    try { this.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id, email, hash, now); }
    catch (error) { if (String(error.message).includes('UNIQUE')) return null; throw error; }
    return user;
  }
  createSession(hash, userId, expiry, now) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash, userId, expiry);
  }
  userForSession(hash, now) {
    return this.db.prepare('SELECT users.id,users.email FROM users JOIN sessions ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(hash, now);
  }
  revoke(hash) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); }
  saveRow(userId) { return this.db.prepare('SELECT * FROM saves WHERE user_id=?').get(userId); }
  metadata(row) { return { id: row.id, gameVersion: row.game_version, revision: row.revision, updatedAt: row.updated_at }; }
  write(userId, id, revision, json, now) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.writeInTransaction(userId, id, revision, json, now);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  writeInTransaction(userId, id, revision, json, now) {
    const old = this.saveRow(userId);
    if ((!id && old) || (id && old && old.id === id && old.revision !== revision)) return { status: 409 };
    if (id && (!old || old.id !== id)) return { status: 404 };
    if (old) {
      this.db.prepare('UPDATE saves SET previous_json=current_json,current_json=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?')
        .run(json, now, id, userId, revision);
    } else {
      this.db.prepare('INSERT INTO saves VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), userId, 'web-native', json, null, 1, now);
    }
    return { status: old ? 200 : 201, row: this.metadata(this.saveRow(userId)) };
  }
  deleteSave(userId, id, revision) {
    return this.db.prepare('DELETE FROM saves WHERE user_id=? AND id=? AND revision=?').run(userId, id, revision).changes > 0;
  }
}
