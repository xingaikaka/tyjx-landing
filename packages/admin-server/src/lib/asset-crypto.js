/**
 * 媒体资源加密(AES-256-GCM)
 *
 * 用途:后台上传的图片(logo / poster / 装饰图等)在写入 R2 前先加密,
 *       浏览器拉密文 → Web Crypto decrypt → Blob URL → <img src>
 *
 * 密文格式(与 dp/tyjx-admin asset-store.js 对齐):
 *   ┌──────────────┬──────────────────┬───────────────────────────┐
 *   │ IV (12 byte) │ authTag (16 byte) │ ciphertext (≥ 0 byte)    │
 *   └──────────────┴──────────────────┴───────────────────────────┘
 *
 * key 来源:env ASSET_AES_KEY(32 字节 hex,即 64 个 hex 字符)
 *   - 启动时未设置 → 自动生成并打印到日志(仅 dev 方便),prod 必须显式配
 *   - 解密失败时浏览器要看到完整错误,所以这里抛异常不吞
 *
 * 注意:GCM 的 authTag 必须随密文一起存,否则 Web Crypto 解密会直接报错。
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey = null;

/**
 * 取出 32 字节 raw key(从 env hex 解析,缓存到内存)。
 * 没配 env 时一次性生成临时 key,**重启会丢**(只能在 dev 临时跑通,prod 必须 env)。
 */
export function getAssetKey() {
  if (cachedKey) return cachedKey;
  const hex = (process.env.ASSET_AES_KEY || '').trim();
  if (hex) {
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error('ASSET_AES_KEY 必须是 64 位 hex(32 字节 256-bit AES key)');
    }
    cachedKey = Buffer.from(hex, 'hex');
    return cachedKey;
  }
  cachedKey = randomBytes(32);
  // eslint-disable-next-line no-console
  console.warn(
    '[asset-crypto] ASSET_AES_KEY 未配置,自动生成临时 key:\n  ASSET_AES_KEY=' +
      cachedKey.toString('hex') +
      '\n  (重启会丢失,所有已加密图片将无法解密!请把上行写入 .env)'
  );
  return cachedKey;
}

/** 当前 key 的 hex 表示(给 /api/portal/landing/config 返回用) */
export function getAssetKeyHex() {
  return getAssetKey().toString('hex');
}

/**
 * 加密一段 buffer(图片)。
 * @param {Buffer} plainBuf
 * @returns {Buffer} [IV(12) | tag(16) | ciphertext]
 */
export function encryptAsset(plainBuf) {
  if (!Buffer.isBuffer(plainBuf)) {
    throw new TypeError('encryptAsset: input must be Buffer');
  }
  const key = getAssetKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/**
 * 解密 [IV | tag | ciphertext](浏览器同款格式)。Node 端解密用,主要给单测/脚本。
 * 浏览器侧用 Web Crypto API,见 luodiye_video / admin-web 的 decryptAsset.ts。
 */
export function decryptAsset(combined) {
  if (!Buffer.isBuffer(combined) || combined.length < IV_LEN + TAG_LEN) {
    throw new Error('decryptAsset: bad payload');
  }
  const key = getAssetKey();
  const iv = combined.subarray(0, IV_LEN);
  const tag = combined.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = combined.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
