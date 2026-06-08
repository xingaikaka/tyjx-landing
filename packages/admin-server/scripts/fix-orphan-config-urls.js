#!/usr/bin/env node
/**
 * 修复 config 表里"孤儿 URL"问题:
 *   配置(landing/portalUI 等)中引用的 .enc URL,在 R2 上已经被覆盖删除
 *   (因为同 filename 重新上传时老对象会 purge,但这次的 fix 之前 config 没同步)。
 *
 * 策略:
 *   1. 收集 config 表所有出现的 R2/CDN URL
 *   2. 对每个 URL 用 S3 HeadObject 看 R2 上是否还存在
 *   3. 不存在的 → 在 media 表里找最近一条 image row(file kind),把 config 引用改成 row.url
 *
 * 用法:
 *   node scripts/fix-orphan-config-urls.js [--dry]
 */

import 'dotenv/config';
import db, { mediaRepo, configRepo } from '../src/lib/db.js';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getCdnBase } from '../src/lib/cdn-base.js';

const DRY = process.argv.includes('--dry');

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});
const BUCKET = process.env.R2_BUCKET;
const CDN = (getCdnBase() || '').replace(/\/$/, '');
const R2PUB = (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '');

function collectStrings(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') return (out.push(obj), out);
  if (Array.isArray(obj)) {
    for (const v of obj) collectStrings(v, out);
    return out;
  }
  if (typeof obj === 'object') for (const v of Object.values(obj)) collectStrings(v, out);
  return out;
}

function isOurAssetUrl(s) {
  return [CDN, R2PUB].filter(Boolean).some((b) => s.startsWith(b + '/'));
}

function urlToKey(u) {
  return new URL(u).pathname.replace(/^\/+/, '');
}

async function existsOnR2(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

function pickReplacementForBrokenUrl(brokenUrl) {
  // 简单语义匹配:
  //   - 名字含 "poster-" 或在 backgroundVideoPoster 字段 → 找最新 hls row 的 poster_url
  //   - 否则 → 找最新 file kind image row 的 url
  const isPoster = /\/poster-/i.test(brokenUrl);
  if (isPoster) {
    const rows = mediaRepo.list().filter(
      (r) => r.kind === 'hls' && r.poster_url && /\.enc(\?|$|#)/i.test(r.poster_url)
    );
    if (rows.length) {
      rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return rows[0].poster_url;
    }
  } else {
    const rows = mediaRepo.list().filter(
      (r) => r.kind === 'file' && (r.mime || '').startsWith('image/')
    );
    if (rows.length) {
      rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return rows[0].url;
    }
  }
  return null;
}

async function main() {
  console.log('=================================================');
  console.log(' fix-orphan-config-urls', DRY ? '[DRY]' : '[REAL]');
  console.log('=================================================');
  console.log('CDN     :', CDN);
  console.log('R2 pub  :', R2PUB);

  const allKeys = db.prepare('SELECT key FROM config').all().map((r) => r.key);
  const seen = new Set();
  const orphans = [];

  for (const k of allKeys) {
    const cur = configRepo.get(k);
    for (const s of collectStrings(cur)) {
      if (!isOurAssetUrl(s) || seen.has(s)) continue;
      seen.add(s);
      const key = urlToKey(s);
      // eslint-disable-next-line no-await-in-loop
      const ok = await existsOnR2(key);
      if (!ok) orphans.push(s);
    }
  }

  console.log(`\n扫描到 ${seen.size} 个 config 引用的资源 URL,其中 ${orphans.length} 个 R2 上已不存在`);

  if (!orphans.length) {
    console.log('\n✓ 没有孤儿 URL,无需修复');
    return;
  }

  const replacements = {};
  for (const o of orphans) {
    const repl = pickReplacementForBrokenUrl(o);
    if (!repl) {
      console.warn(`  ⚠ 找不到替代品,置空: ${o}`);
      replacements[o] = '';
    } else {
      console.log(`  ${o}\n  → ${repl}`);
      replacements[o] = repl;
    }
  }

  if (DRY) {
    console.log('\n[dry] 不写入');
    return;
  }

  // 应用替换
  for (const k of allKeys) {
    const cur = configRepo.get(k);
    if (cur === null || cur === undefined) continue;
    let dirty = false;
    const next = JSON.parse(
      JSON.stringify(cur, (_jk, v) => {
        if (typeof v !== 'string') return v;
        let out = v;
        for (const [old, repl] of Object.entries(replacements)) {
          if (out.includes(old)) {
            out = out.split(old).join(repl);
            dirty = true;
          }
        }
        return out;
      })
    );
    if (dirty) {
      configRepo.set(k, next);
      console.log(`  ✔ config[${k}] 已更新`);
    }
  }
  console.log('\n✓ 完成');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
