/**
 * 存储后端抽象:local(本机磁盘) | r2(Cloudflare R2 + 腾讯 CDN 回源)
 *
 * 由 STORAGE_BACKEND env 决定。
 *
 * R2 路径规划(腾讯 CDN 回源 → R2 公网域):
 *   浏览器 → https://<CDN_BASE>/uploads/<key>
 *   CDN 回源 → https://<R2_PUBLIC_BASE>/<key>
 *   admin-server → S3 PUT https://<accountid>.r2.cloudflarestorage.com/<bucket>/<key>
 *
 * 接口:
 *   put(key, buffer, mime): 写入 + 返回 { url, backend }
 *   del(key, backend):     按记录的 backend 删除(兼容老 local 文件)
 *   localFsPath(key):      仅 backend=local 时,返回本地文件绝对路径(用于 sharp pre-process)
 *
 * URL 写入数据库后是终态,relay-server / luodiye_video 直接 fetch,不再经 admin-server。
 */

import path from 'node:path';
import fs from 'node:fs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

import config from './config.js';
import logger from './logger.js';
import { getCdnBase } from './cdn-base.js';

const BACKEND = (process.env.STORAGE_BACKEND || 'local').toLowerCase();

/**
 * 全局 key 前缀。
 * 例 STORAGE_KEY_PREFIX=tyjx → 所有 key 自动 prepend 'tyjx/'。
 * 用途:多套系统共享同一个 R2 桶时避免目录冲突
 *   dp/tyjx-admin   → 写 encrypted-assets/、downloads/、video-assets/
 *   tyjx-landing    → 写 tyjx/uploads/、tyjx/downloads/、tyjx/video-assets/
 */
const KEY_PREFIX = (process.env.STORAGE_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '');

function withPrefix(key) {
  if (!KEY_PREFIX) return key;
  if (key === KEY_PREFIX || key.startsWith(KEY_PREFIX + '/')) return key;
  return `${KEY_PREFIX}/${key}`;
}

let r2Client = null;

function ensureR2() {
  if (r2Client) return r2Client;
  const ep = process.env.R2_ENDPOINT;
  const ak = process.env.R2_ACCESS_KEY_ID;
  const sk = process.env.R2_SECRET_ACCESS_KEY;
  if (!ep || !ak || !sk) {
    throw new Error('R2 env not set: R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
  }
  r2Client = new S3Client({
    region: 'auto',
    endpoint: ep,
    credentials: { accessKeyId: ak, secretAccessKey: sk },
    forcePathStyle: true,
  });
  return r2Client;
}

/* ─────────── public API ─────────── */

/**
 * 上传到对应后端
 * @param {string} key       相对 key(自动加 KEY_PREFIX),例 'uploads/abc.png' 或 'video-assets/xxx/index.m3u8'
 * @param {Buffer} buffer    文件内容
 * @param {string} mime
 * @param {object} [opts]
 * @param {string} [opts.cacheControl]      自定义 Cache-Control(R2 生效)
 * @param {string} [opts.contentDisposition] 例 attachment; filename="x.apk"(R2 生效)
 * @returns {Promise<{key: string, url: string, backend: 'local' | 'r2'}>}
 *
 * 返回的 key 是**最终落地 key**(已含 KEY_PREFIX),
 * 调用方应把这个 key 存入 DB 的 storage_key 字段,删除时用同样的 key 就能定位回去。
 */
export async function put(key, buffer, mime, opts = {}) {
  // opts.absoluteKey=true 时跳过 STORAGE_KEY_PREFIX,直接写 key 字面量
  // (用于 APK 等需要与 dp/tyjx-admin 共享同一个 R2 对象的场景)
  const realKey = opts.absoluteKey ? key : withPrefix(key);
  const result = BACKEND === 'r2'
    ? await putR2(realKey, buffer, mime, opts)
    : putLocal(realKey, buffer);
  return { key: realKey, ...result };
}

/**
 * 批量上传(用于 HLS 一次推 m3u8 + 多个 ts 分片)
 *
 * @param {Array<{key:string, buffer:Buffer, mime:string, cacheControl?:string}>} items
 * @returns {Promise<Array<{key:string, url:string, backend:'local'|'r2'}>>}
 *
 * R2: 顺序串行(避免并发挤占 admin 出口带宽,与 dp 经验一致)。
 * local: 直写盘,顺序写。
 */
export async function putMany(items) {
  const out = [];
  for (const it of items) {
    const r = await put(it.key, it.buffer, it.mime, {
      cacheControl: it.cacheControl,
      contentDisposition: it.contentDisposition,
    });
    out.push(r);
  }
  return out;
}

/**
 * 删除
 * @param {string} key   存进 DB 时返回的 key(已含 KEY_PREFIX)
 * @param {'local'|'r2'} [backend]  老数据可能是 local,新数据是 r2
 *
 * 兼容老数据:如果 key 没带 KEY_PREFIX 也能正确删(直接当原始 key 处理)。
 */
export async function del(key, backend) {
  const b = (backend || BACKEND).toLowerCase();
  if (b === 'r2') return delR2(key);
  return delLocal(key);
}

export function getCurrentBackend() {
  return BACKEND;
}

/**
 * 仅 local 后端用:取本地绝对路径(给 sharp 直接读)
 */
export function localFsPath(key) {
  return path.join(config.uploadDir, path.basename(key));
}

/* ─────────── local impl ─────────── */

function putLocal(key, buffer) {
  // 支持嵌套路径(video-assets/<id>/seg_001.ts) → 自动建子目录
  const full = path.join(config.uploadDir, key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  const base = (config.publicUrl || '').replace(/\/$/, '');
  return { url: `${base}/uploads/${key}`, backend: 'local' };
}

function delLocal(key) {
  try {
    // 支持单文件或目录(HLS 整个 video 目录一次删)
    const full = path.join(config.uploadDir, key);
    const resolved = path.resolve(full);
    if (!resolved.startsWith(path.resolve(config.uploadDir))) return;
    if (!fs.existsSync(resolved)) return;
    const st = fs.statSync(resolved);
    if (st.isDirectory()) {
      fs.rmSync(resolved, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolved);
    }
  } catch (e) {
    logger.warn('local del fail:', e.message);
  }
}

/* ─────────── r2 impl ─────────── */

async function putR2(objectKey, buffer, mime, opts = {}) {
  const client = ensureR2();
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET not set');

  const params = {
    Bucket: bucket,
    Key: objectKey,
    Body: buffer,
    ContentType: mime || 'application/octet-stream',
    CacheControl: opts.cacheControl || 'public, max-age=31536000, immutable',
  };
  if (opts.contentDisposition) {
    params.ContentDisposition = opts.contentDisposition;
  }

  await client.send(new PutObjectCommand(params));

  // 优先后台配置的 mediaCdnBase,其次 env CDN_BASE,再 R2_PUBLIC_BASE
  const cdnBase = getCdnBase();
  if (!cdnBase) {
    throw new Error('请在后台或 env 配置媒体 CDN 域名(system.mediaCdnBase / CDN_BASE / R2_PUBLIC_BASE)');
  }
  return {
    url: `${cdnBase}/${objectKey}`,
    backend: 'r2',
  };
}

async function delR2(key) {
  try {
    const client = ensureR2();
    const bucket = process.env.R2_BUCKET;
    if (!bucket) return;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    logger.warn('r2 del fail:', e.message);
  }
}

/**
 * 删整个"目录"(R2 没有目录,这里按 prefix 列对象再批删)
 * @param {string} prefix  存进 DB 的 storage_prefix(已含 KEY_PREFIX,如 'tyjx/video-assets/<id>/')
 */
export async function delPrefix(prefix) {
  if (!prefix) return;
  if (BACKEND === 'r2') {
    try {
      const client = ensureR2();
      const bucket = process.env.R2_BUCKET;
      let continuationToken;
      do {
        const listed = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );
        const objs = (listed.Contents || []).map((o) => ({ Key: o.Key }));
        if (objs.length) {
          await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objs, Quiet: true },
            })
          );
        }
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch (e) {
      logger.warn('r2 delPrefix fail:', e.message);
    }
  } else {
    // local: 等价 rm -rf <UPLOAD_DIR>/<prefix>
    delLocal(prefix.replace(/\/$/, ''));
  }
}

/** 给外部用:读当前 KEY_PREFIX(可能空字符串) */
export function getKeyPrefix() {
  return KEY_PREFIX;
}

/**
 * 从存储后端拉二进制(给 image-raw 解密代理用)
 * @param {string} key  存进 DB 的 key(已含 KEY_PREFIX)或相对 key 都接受
 * @returns {Promise<Buffer>}
 */
export async function getBytes(key) {
  if (BACKEND === 'r2') {
    const client = ensureR2();
    const bucket = process.env.R2_BUCKET;
    if (!bucket) throw new Error('R2_BUCKET not set');
    const realKey = withPrefix(key);
    const r = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: realKey })
    );
    if (typeof r.Body?.transformToByteArray === 'function') {
      return Buffer.from(await r.Body.transformToByteArray());
    }
    const chunks = [];
    for await (const chunk of r.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  const fsRead = await import('node:fs/promises');
  const realKey = withPrefix(key);
  const full = path.join(config.uploadDir, realKey);
  return fsRead.readFile(full);
}

/**
 * 从存储后端拉文本(给 m3u8 代理用)
 * @param {string} key  存进 DB 的 key(已含 KEY_PREFIX)或相对 key 都接受
 * @returns {Promise<string>}
 */
export async function getText(key) {
  if (BACKEND === 'r2') {
    const client = ensureR2();
    const bucket = process.env.R2_BUCKET;
    if (!bucket) throw new Error('R2_BUCKET not set');
    const realKey = withPrefix(key);
    const r = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: realKey })
    );
    // r.Body 是 stream,转成字符串
    if (typeof r.Body?.transformToString === 'function') {
      return await r.Body.transformToString('utf-8');
    }
    // 兼容老版本 SDK
    const chunks = [];
    for await (const chunk of r.Body) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf-8');
  }

  // local: 从盘读
  const fsRead = await import('node:fs/promises');
  const realKey = withPrefix(key);
  const full = path.join(config.uploadDir, realKey);
  return fsRead.readFile(full, 'utf-8');
}
