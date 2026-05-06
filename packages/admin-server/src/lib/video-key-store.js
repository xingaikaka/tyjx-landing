/**
 * HLS AES-128 视频 Key 存储
 *
 * 设计与 dp/tyjx-admin/server/src/lib/video-store.js 同源,做了两点不同:
 *   1. 加密算法继续用本系统的 lib/crypto.js (AES-256-CBC, 与 Worker 通信加密一致)
 *      ─ dp 用的是它自己的 aes.js (GCM),无所谓,反正只在本机解
 *   2. 落盘位置可配置 VIDEO_KEY_DIR(默认 packages/admin-server/src/data/video-keys/)
 *
 * 文件:
 *   <id>.enckey       AES-256-CBC(rawKey 16B) → "iv:cipher" hex 字符串
 *
 * 安全模型:
 *   - rawKey 永远只出现在 admin 进程内存 + 本地 .enckey 文件
 *   - Cloudflare R2 / 腾讯 CDN / Worker 都拿不到
 *   - 即使本地 .enckey 文件被偷,没有 PORTAL_API_SECRET 也解不了
 *   - 服务器上的 enckey 文件应当随服务器整体备份(丢了所有视频都无法播放)
 */

import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import config from './config.js';
import { encrypt, decrypt } from './crypto.js';
import logger from './logger.js';

const KEY_DIR =
  process.env.VIDEO_KEY_DIR ||
  path.resolve(config.rootDir, 'src/data/video-keys');

async function ensureDir() {
  if (!existsSync(KEY_DIR)) {
    await mkdir(KEY_DIR, { recursive: true });
  }
}

function keyPath(id) {
  // 防路径穿越
  if (!/^[0-9a-f]{30,40}$/i.test(id)) {
    throw new Error('invalid video id');
  }
  return path.join(KEY_DIR, `${id}.enckey`);
}

/**
 * 保存原始 16 字节 AES-128 Key
 * @param {string} id      32-hex video id
 * @param {Buffer} rawKey  16 字节
 */
export async function saveKey(id, rawKey) {
  if (!Buffer.isBuffer(rawKey) || rawKey.length !== 16) {
    throw new Error('rawKey must be 16-byte Buffer');
  }
  await ensureDir();
  // crypto.js 接受 utf8 字符串,我们把 16 字节 → hex,加密成 "iv:cipher" hex 文本存盘
  const text = encrypt(rawKey.toString('hex'), config.portalApiSecret);
  await writeFile(keyPath(id), text, 'utf-8');
  logger.info(`[video-key] saved id=${id}`);
}

/**
 * 读取并解密 → 返回 16 字节 Buffer
 * @param {string} id
 * @returns {Promise<Buffer>}
 */
export async function loadKey(id) {
  const text = (await readFile(keyPath(id), 'utf-8')).trim();
  const hex = decrypt(text, config.portalApiSecret);
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 16) {
    throw new Error(`bad key length: ${buf.length}`);
  }
  return buf;
}

/**
 * 删除某 id 的 key(media 删除时调用)
 */
export async function deleteKey(id) {
  try {
    await unlink(keyPath(id));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      logger.warn('[video-key] delete fail:', e.message);
    }
  }
}

/** 是否存在 */
export function hasKey(id) {
  try {
    return existsSync(keyPath(id));
  } catch {
    return false;
  }
}

export const VIDEO_KEY_DIR = KEY_DIR;
