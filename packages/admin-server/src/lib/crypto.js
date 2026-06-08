/**
 * AES-256-CBC 加解密,与 _legacy/functions/_shared/crypto.js 和前端 CryptoJS 格式兼容。
 * 格式: <iv hex>:<ciphertext hex>
 *
 * 用途:
 *   - admin-server 给 Worker 返回 runtime 数据时加密
 *   - Worker 端用同一个 secret 解密
 *
 * 不要用于密码、token 等敏感数据(前端 secret 注定会泄露,只起反爬/混淆作用)。
 */

import crypto from 'node:crypto';

const SALT = 'app-landing-salt';

function deriveKey(secret) {
  // 与 CryptoJS 实现保持一致:SHA256(secret + SALT) 取 32 字节 raw
  return crypto.createHash('sha256').update(secret + SALT).digest();
}

export function encrypt(plain, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plain, 'utf8')),
    cipher.final(),
  ]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

export function decrypt(text, secret) {
  const parts = String(text).split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted format');
  const [ivHex, encHex] = parts;
  const key = deriveKey(secret);
  const iv = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}
