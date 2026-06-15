/**
 * AES-256-CBC 解密(Web Crypto API)
 *
 * 与 admin-server 的 lib/crypto.js 输出格式完全一致:
 *   <iv hex>:<ciphertext hex>
 * key = SHA-256(secret + "app-landing-salt")
 *
 * 本服务只需要 decrypt;runtime 是 admin → relay-server 单向流。
 */

const SALT = 'app-landing-salt';
const enc = new TextEncoder();
const dec = new TextDecoder();

function hexToBytes(hex) {
  if (hex.length % 2) throw new Error('bad hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function deriveKey(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret + SALT));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, [
    'decrypt',
  ]);
}

export async function decrypt(text, secret) {
  const parts = String(text).split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted format');
  const [ivHex, ctHex] = parts;
  const iv = hexToBytes(ivHex);
  const ct = hexToBytes(ctHex);
  const key = await deriveKey(secret);
  const buf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct);
  return dec.decode(buf);
}
