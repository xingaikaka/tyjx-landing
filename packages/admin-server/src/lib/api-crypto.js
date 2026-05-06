/**
 * 公开 API 响应加密(AES-256-CBC)。
 *
 * 与 dp/tyjx-landing-page/app/lib/apiDecrypt.ts 完全对齐:
 *   响应体 = { "e": base64(iv(16) || ciphertext) }
 *   解密时:前 16 字节是 IV,剩下是密文,key 是 raw 32 byte。
 *
 * 用途:把 /api/portal/* 的明文 JSON 包一层,让 burp/wireshark/curl 看到的就是
 * `{"e":"..."}` 一坨乱码,提高反爬/反逆向门槛。
 *
 * 不要用于真正敏感的数据:NEXT_PUBLIC_PORTAL_API_AES_KEY 会被打进客户端 bundle,
 * 任何人 view-source 都能拿到 key。这只是混淆,不是真加密保护。
 *
 * key 来源:env PORTAL_API_AES_KEY(64 hex)。未配置时一次性生成临时 key + 警告日志。
 *   - dev: 重启会丢,客户端缓存的密文也对不上,需要清缓存
 *   - prod: 必须显式配,且与 luodiye_video 的 NEXT_PUBLIC_PORTAL_API_AES_KEY 同值
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALG = 'aes-256-cbc';
const IV_LEN = 16;

let cachedKey = null;

export function getApiKey() {
  if (cachedKey) return cachedKey;
  const hex = (process.env.PORTAL_API_AES_KEY || '').trim();
  if (hex) {
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error(
        'PORTAL_API_AES_KEY 必须是 64 位 hex(32 字节 256-bit AES key)'
      );
    }
    cachedKey = Buffer.from(hex, 'hex');
    return cachedKey;
  }
  cachedKey = randomBytes(32);
  // eslint-disable-next-line no-console
  console.warn(
    '[api-crypto] PORTAL_API_AES_KEY 未配置,自动生成临时 key:\n' +
      '  PORTAL_API_AES_KEY=' +
      cachedKey.toString('hex') +
      '\n' +
      '  ↑ 把上行同时写入 admin-server/.env 和 luodiye_video/.env.development(prefix NEXT_PUBLIC_)\n' +
      '  否则:重启后落地页解密会失败、sync-seo 会报错。'
  );
  return cachedKey;
}

export function getApiKeyHex() {
  return getApiKey().toString('hex');
}

/**
 * 把任意可序列化对象编码成 dp 同款 `{ e: "<base64(iv|ct)>" }`。
 * 调用方负责 res.json 包一层。
 *
 * @param {unknown} payload   要加密的对象
 * @returns {{ e: string }}    同 dp apiDecrypt.tryDecryptResponse 的输入格式
 */
export function encryptApiResponse(payload) {
  const json = JSON.stringify(payload);
  const key = getApiKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const combined = Buffer.concat([iv, enc]);
  return { e: combined.toString('base64') };
}

/**
 * 解密 `{ e }` → 原始字符串(给 sync-seo 等 node 脚本/单测用)。
 * 浏览器侧用 Web Crypto,见 luodiye_video/src/lib/decryptApi.ts。
 */
export function decryptApiResponse(b64) {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length <= IV_LEN) throw new Error('decryptApiResponse: bad payload');
  const key = getApiKey();
  const iv = raw.subarray(0, IV_LEN);
  const ct = raw.subarray(IV_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf8');
}
