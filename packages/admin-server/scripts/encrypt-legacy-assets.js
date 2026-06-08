#!/usr/bin/env node
/**
 * 历史明文资源 → AES-256-GCM 加密迁移
 *
 * 适用场景:
 *   - 后台改造为"上传图片即加密"之前已经存在的 logo / 装饰图 / 视频 poster
 *   - 它们 URL 形如 .../uploads/xxx.png (没有 .enc 后缀)
 *   - 需要批量升级到 .enc 密文,前端 EncryptedImage 才会走解密路径
 *
 * 做的事(全部幂等,跑多次安全):
 *   1. 扫 media 表
 *      a. 图片 row(mime=image/*  或  url 后缀是图片)且 url 不带 .enc
 *         → fetch 明文 → encryptAsset → put(<key>.enc) → del 老 key → update DB
 *      b. 任何 row 的 poster_url 不带 .enc(主要是历史 HLS 视频的首帧)
 *         → 同样处理,替换 poster_url + poster_key
 *   2. 扫 config 表的所有 JSON value,字符串里出现 OLD_URL 就替换成 NEW_URL
 *      (覆盖 landing.logo / landing.backgroundVideoPoster / portalUI.* 等所有引用)
 *
 * 用法:
 *   cd packages/admin-server
 *   node scripts/encrypt-legacy-assets.js              # 真跑(会改 R2 + DB)
 *   node scripts/encrypt-legacy-assets.js --dry        # 只打印计划,不动数据
 *
 * 注意:
 *   - 脚本运行期间最好先停掉 admin-server,避免 DB / R2 同时被两边写
 *   - 跑完后请清一下浏览器缓存(预览图老 blob 还在 LRU 里)
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import db, { mediaRepo, configRepo } from '../src/lib/db.js';
import { encryptAsset, getAssetKeyHex } from '../src/lib/asset-crypto.js';
import { put, del, getKeyPrefix } from '../src/lib/storage.js';
import { getCdnBase } from '../src/lib/cdn-base.js';

const DRY = process.argv.includes('--dry');

function isPlainImageUrl(url) {
  if (!url) return false;
  if (/\.enc(\?|#|$)/i.test(url)) return false;
  return /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(url);
}

function inferMimeFromUrl(url) {
  const m = url.match(/\.(png|jpe?g|webp|gif)(\?|#|$)/i);
  if (!m) return 'image/jpeg';
  const ext = m[1].toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * 把对外 URL 转成 storage key(已含 STORAGE_KEY_PREFIX)。
 *
 * URL 形如 https://<cdn>/tyjx/uploads/abc.png
 *      或 https://<r2pub>/tyjx/uploads/abc.png
 * 提取 path 部分(以 / 开头) → 去掉前导 / → 即为 storage key。
 */
function urlToStorageKey(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, '');
  } catch {
    return url;
  }
}

async function fetchPlainBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * 加密一个明文 URL → 上传 .enc → 删除原 → 返回新 { url, key }。
 * dry-run 模式下只打印不做事,返回 { url: 原, key: 原, skipped: true }。
 */
async function migrateOne(plainUrl, oldKey) {
  const newKeyRel = (() => {
    // oldKey 可能是 'tyjx/uploads/abc.png' 也可能是 'uploads/abc.png'
    // put() 会自动加 KEY_PREFIX,所以传入相对 key
    const prefix = getKeyPrefix();
    let rel = oldKey;
    if (prefix && rel.startsWith(prefix + '/')) rel = rel.slice(prefix.length + 1);
    return `${rel}.enc`;
  })();

  if (DRY) {
    console.log(`  [dry] ${plainUrl}  →  +.enc(key=${newKeyRel})`);
    return { url: plainUrl, key: oldKey, skipped: true };
  }

  console.log(`  → fetch ${plainUrl}`);
  const plainBuf = await fetchPlainBuffer(plainUrl);
  console.log(`     ${plainBuf.length} bytes plaintext`);

  const enc = encryptAsset(plainBuf);
  console.log(`     ${enc.length} bytes ciphertext`);

  const r = await put(newKeyRel, enc, 'application/octet-stream', {
    cacheControl: 'public, max-age=31536000, immutable',
  });
  console.log(`     uploaded: ${r.key}`);
  console.log(`     url:      ${r.url}`);

  // 删老 key(忽略失败:cdn 缓存命中或对象不存在都不影响)
  try {
    await del(oldKey, 'r2');
    console.log(`     deleted old: ${oldKey}`);
  } catch (e) {
    console.warn(`     delete old failed (non-fatal): ${e.message}`);
  }

  return { url: r.url, key: r.key, skipped: false };
}

/* ─────────── 1. 扫 media 表 ─────────── */
async function migrateMediaRows() {
  const rows = mediaRepo.list();
  console.log(`\n[media] total rows = ${rows.length}`);

  const plan = [];
  for (const m of rows) {
    if (isPlainImageUrl(m.url) && (m.mime || '').startsWith('image/')) {
      plan.push({ kind: 'media.url', id: m.id, oldUrl: m.url, oldKey: m.storage_key });
    }
    if (isPlainImageUrl(m.poster_url || '')) {
      plan.push({
        kind: 'media.poster',
        id: m.id,
        oldUrl: m.poster_url,
        oldKey: m.poster_key || urlToStorageKey(m.poster_url),
      });
    }
  }
  console.log(`[media] need migrate = ${plan.length}`);

  /** @type {Record<string, {url:string, key:string}>} 老 URL → 新 URL/key,后面 config 替换用 */
  const replacements = {};

  for (const p of plan) {
    console.log(`\n· ${p.kind} id=${p.id}`);
    const newRef = await migrateOne(p.oldUrl, p.oldKey);
    if (newRef.skipped) continue;
    replacements[p.oldUrl] = newRef;

    // 更新 DB(用底层 db 直执行,绕开 mediaRepo 的写白名单)
    if (p.kind === 'media.url') {
      db.prepare('UPDATE media SET url = ?, storage_key = ? WHERE id = ?').run(
        newRef.url,
        newRef.key,
        p.id
      );
    } else {
      db.prepare('UPDATE media SET poster_url = ?, poster_key = ? WHERE id = ?').run(
        newRef.url,
        newRef.key,
        p.id
      );
    }
    console.log(`     ✔ DB updated`);
  }

  return replacements;
}

/**
 * 递归收集对象里所有 string 字段(用于扫 config JSON 里出现的 URL)。
 */
function collectStrings(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) collectStrings(v, out);
    return out;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) collectStrings(v, out);
  }
  return out;
}

/* ─────────── 2a. 扫 config 表里"孤儿"明文 URL(不在 media 表) ─────────── */
async function migrateOrphanConfigUrls(existingReplacements) {
  console.log(`\n[config-orphans] 扫描 landing/portalUI 中明文 URL...`);

  const allKeys = db.prepare('SELECT key FROM config').all().map((r) => r.key);
  const candidates = new Set();
  for (const k of allKeys) {
    const cur = configRepo.get(k);
    for (const s of collectStrings(cur)) {
      if (isPlainImageUrl(s)) candidates.add(s);
    }
  }

  // 跳过已经在 media 阶段处理的
  for (const u of Object.keys(existingReplacements)) candidates.delete(u);

  console.log(`[config-orphans] orphan plain image urls = ${candidates.size}`);

  /** 备用映射:R2 已 404 的孤儿 URL → 用 media 表里"语义最接近"的加密 URL 替换 */
  function findFallbackForBrokenUrl(brokenUrl) {
    // 当前 landing.backgroundVideo 对应的 hls row 的 poster_url(已是 .enc)
    const land = configRepo.get('landing') || {};
    if (typeof land.backgroundVideoPoster === 'string' && land.backgroundVideoPoster === brokenUrl) {
      const bv = land.backgroundVideo || '';
      const m = bv.match(/\/video-assets\/([0-9a-f]{30,40})\//i);
      if (m) {
        const vid = m[1];
        const row = db
          .prepare("SELECT poster_url FROM media WHERE kind='hls' AND url LIKE ?")
          .get(`%${vid}%`);
        if (row && row.poster_url && /\.enc(\?|$|#)/i.test(row.poster_url)) {
          return { url: row.poster_url, key: urlToStorageKey(row.poster_url), reason: 'video-poster-from-media' };
        }
      }
    }
    return null;
  }

  for (const oldUrl of candidates) {
    console.log(`\n· orphan: ${oldUrl}`);
    const oldKey = urlToStorageKey(oldUrl);
    try {
      const newRef = await migrateOne(oldUrl, oldKey);
      if (!newRef.skipped) existingReplacements[oldUrl] = newRef;
    } catch (e) {
      // 原始资源已不可达 → 尝试映射到 media 表里语义等价的加密 URL,最后兜底置空字符串
      const fallback = findFallbackForBrokenUrl(oldUrl);
      if (fallback) {
        console.warn(`     fetch fail (${e.message}) → fallback=${fallback.reason}: ${fallback.url}`);
        existingReplacements[oldUrl] = { url: fallback.url, key: fallback.key, skipped: false };
      } else {
        console.warn(`     fetch fail (${e.message}) → 替换为空字符串`);
        existingReplacements[oldUrl] = { url: '', key: '', skipped: false };
      }
    }
  }
}

/* ─────────── 2b. 扫 config 表替换 URL 引用 ─────────── */
function migrateConfigReferences(replacements) {
  const oldUrls = Object.keys(replacements);
  if (!oldUrls.length) {
    console.log(`\n[config] 无需替换(没有产生新 URL)`);
    return;
  }

  console.log(`\n[config] 替换 ${oldUrls.length} 个 URL 引用`);

  const allKeys = db.prepare('SELECT key FROM config').all().map((r) => r.key);
  for (const k of allKeys) {
    const cur = configRepo.get(k);
    if (cur === null || cur === undefined) continue;
    let dirty = false;
    const next = JSON.parse(
      JSON.stringify(cur, (_jk, v) => {
        if (typeof v === 'string') {
          const hit = oldUrls.find((u) => v.includes(u));
          if (hit) {
            dirty = true;
            return v.split(hit).join(replacements[hit].url);
          }
        }
        return v;
      })
    );
    if (dirty) {
      if (DRY) {
        console.log(`  [dry] config[${k}] 有 URL 替换`);
      } else {
        configRepo.set(k, next);
        console.log(`  ✔ config[${k}] 已更新`);
      }
    }
  }
}

/* ─────────── 入口 ─────────── */
async function main() {
  console.log('===================================================');
  console.log(' encrypt-legacy-assets ' + (DRY ? '[DRY-RUN]' : '[REAL]'));
  console.log('===================================================');
  console.log('CDN base    :', getCdnBase());
  console.log('KEY prefix  :', getKeyPrefix() || '(empty)');
  console.log('AES key hex :', getAssetKeyHex().slice(0, 16) + '...');

  if (process.env.STORAGE_BACKEND !== 'r2') {
    console.warn('\n⚠ STORAGE_BACKEND != r2,本脚本仅在 R2 后端有意义');
    process.exit(1);
  }

  const replacements = await migrateMediaRows();
  await migrateOrphanConfigUrls(replacements);
  migrateConfigReferences(replacements);

  console.log('\n✓ done');
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
