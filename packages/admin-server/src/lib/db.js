import Database from 'better-sqlite3';
import config from './config.js';
import logger from './logger.js';

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

logger.info(`SQLite opened: ${config.dbPath}`);

/* ─────────── Migration: 给老库补字段 ─────────── */
function migrate() {
  try {
    const cols = db.prepare("PRAGMA table_info('media')").all();
    const has = (n) => cols.some((c) => c.name === n);

    if (cols.length > 0) {
      if (!has('backend')) {
        logger.info('migrate: add column media.backend');
        db.exec("ALTER TABLE media ADD COLUMN backend TEXT NOT NULL DEFAULT 'local'");
      }
      if (!has('poster_url')) {
        logger.info('migrate: add column media.poster_url');
        db.exec("ALTER TABLE media ADD COLUMN poster_url TEXT");
      }
      if (!has('duration')) {
        logger.info('migrate: add column media.duration');
        db.exec("ALTER TABLE media ADD COLUMN duration INTEGER");
      }
      if (!has('storage_prefix')) {
        logger.info('migrate: add column media.storage_prefix');
        db.exec("ALTER TABLE media ADD COLUMN storage_prefix TEXT");
      }
      if (!has('poster_key')) {
        logger.info('migrate: add column media.poster_key');
        db.exec('ALTER TABLE media ADD COLUMN poster_key TEXT');
      }
      if (!has('kind')) {
        logger.info('migrate: add column media.kind');
        db.exec("ALTER TABLE media ADD COLUMN kind TEXT NOT NULL DEFAULT 'file'");
      }
      if (!has('slug')) {
        logger.info('migrate: add column media.slug');
        // slug 仅对 kind='apk'/'ipa' 有意义,作为对外稳定短链的 ID,
        // 例如 /d/app.bin → 找 kind='apk' AND slug='app' 最新一条 → 302。
        db.exec('ALTER TABLE media ADD COLUMN slug TEXT');
        // 给现存 apk 记录回填一个默认 slug(基于 filename 简化版),
        // 老数据也能立刻通过短链访问。
        try {
          const apks = db.prepare("SELECT id, filename FROM media WHERE kind = 'apk'").all();
          const upd = db.prepare('UPDATE media SET slug = ? WHERE id = ?');
          for (const r of apks) {
            const fallback = String(r.filename || 'app')
              .toLowerCase()
              .replace(/\.apk$/i, '')
              .replace(/[^a-z0-9_-]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .slice(0, 32) || 'app';
            upd.run(fallback, r.id);
          }
        } catch (e) {
          logger.warn('migrate: backfill apk.slug failed:', e.message);
        }
      }
    }
  } catch (e) {
    logger.warn('migrate skipped:', e.message);
  }
}

/* ─────────── Schema ─────────── */

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
      backend TEXT NOT NULL DEFAULT 'local',
      -- 视频(HLS)专属:首帧 jpg 的 URL / poster 单独存的 key / 时长(秒) / R2 前缀(如 tyjx/video-assets/xxx/)
      poster_url TEXT,
      poster_key TEXT,
      duration INTEGER,
      storage_prefix TEXT,
      -- 'file'(单文件) | 'hls'(整个目录) | 'apk'(APK 安装包)
      kind TEXT NOT NULL DEFAULT 'file',
      -- 对外稳定短链 ID(只对 kind='apk'/'ipa' 有意义);例:'app' → /d/app.bin
      slug TEXT,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
  );
`);

migrate();

/* ─────────── Repositories(只暴露语义化方法,不让外面拿到原 db)─────────── */

const stmtGetConfig = db.prepare('SELECT value FROM config WHERE key = ?');
const stmtUpsertConfig = db.prepare(
  `INSERT INTO config(key, value, updated_at) VALUES(?, ?, CAST(strftime('%s','now') AS INTEGER))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
);

export const configRepo = {
  get(key, fallback = null) {
    const row = stmtGetConfig.get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    stmtUpsertConfig.run(key, JSON.stringify(value));
  },
};

const stmtFindUserByName = db.prepare('SELECT * FROM admin_users WHERE username = ?');
const stmtFindUserById = db.prepare('SELECT id, username, created_at FROM admin_users WHERE id = ?');
const stmtInsertUser = db.prepare(
  'INSERT INTO admin_users(username, password_hash) VALUES(?, ?)'
);
const stmtUpdateUserPassword = db.prepare(
  'UPDATE admin_users SET password_hash = ? WHERE id = ?'
);

export const userRepo = {
  findByUsername(username) {
    return stmtFindUserByName.get(username) || null;
  },
  findById(id) {
    return stmtFindUserById.get(id) || null;
  },
  create(username, passwordHash) {
    const info = stmtInsertUser.run(username, passwordHash);
    return info.lastInsertRowid;
  },
  updatePassword(id, passwordHash) {
    stmtUpdateUserPassword.run(passwordHash, id);
  },
};

const stmtListMedia = db.prepare('SELECT * FROM media ORDER BY id DESC');
const stmtFindMedia = db.prepare('SELECT * FROM media WHERE id = ?');
// 同名 + 同类型(file/hls/apk)定位现有记录,用于"上传覆盖"语义
const stmtFindMediaByFilenameKind = db.prepare(
  'SELECT * FROM media WHERE filename = ? AND kind = ? ORDER BY id DESC'
);
// 按 slug 取最新的同 kind 一条,用于 GET /d/:slug.bin 短链
const stmtFindLatestBySlugKind = db.prepare(
  'SELECT * FROM media WHERE slug = ? AND kind = ? ORDER BY id DESC LIMIT 1'
);
const stmtInsertMedia = db.prepare(
  `INSERT INTO media
    (filename, storage_key, url, mime, size, backend, poster_url, poster_key, duration, storage_prefix, kind, slug)
   VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtUpdateMediaSlug = db.prepare('UPDATE media SET slug = ? WHERE id = ?');
const stmtDeleteMedia = db.prepare('DELETE FROM media WHERE id = ?');

export const mediaRepo = {
  list() {
    return stmtListMedia.all();
  },
  findById(id) {
    return stmtFindMedia.get(id) || null;
  },
  findByFilenameKind(filename, kind = 'file') {
    return stmtFindMediaByFilenameKind.all(filename, kind);
  },
  findLatestBySlugKind(slug, kind = 'apk') {
    if (!slug) return null;
    return stmtFindLatestBySlugKind.get(slug, kind) || null;
  },
  create({
    filename,
    storage_key,
    url,
    mime,
    size,
    backend = 'local',
    poster_url = null,
    poster_key = null,
    duration = null,
    storage_prefix = null,
    kind = 'file',
    slug = null,
  }) {
    const info = stmtInsertMedia.run(
      filename,
      storage_key,
      url,
      mime,
      size,
      backend,
      poster_url,
      poster_key,
      duration,
      storage_prefix,
      kind,
      slug
    );
    return info.lastInsertRowid;
  },
  updateSlug(id, slug) {
    stmtUpdateMediaSlug.run(slug || null, id);
  },
  remove(id) {
    stmtDeleteMedia.run(id);
  },
};

const stmtInsertAudit = db.prepare(
  'INSERT INTO audit_log(user_id, action, payload) VALUES(?, ?, ?)'
);

export const auditRepo = {
  log(userId, action, payload) {
    stmtInsertAudit.run(userId, action, payload ? JSON.stringify(payload) : null);
  },
};

export default db;
