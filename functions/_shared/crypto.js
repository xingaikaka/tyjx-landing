/**
 * Web Crypto API - AES-256-CBC
 * 与前端 crypto-util.js (CryptoJS) 格式兼容
 */

const SALT = 'app-landing-salt';

function toHex(arr) {
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
}

async function deriveKey(secret) {
  const data = new TextEncoder().encode(secret + SALT);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(text, secret) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    new TextEncoder().encode(text)
  );
  return toHex(iv) + ':' + toHex(new Uint8Array(encrypted));
}

export async function decrypt(encryptedText, secret) {
  const parts = encryptedText.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted format');
  const key = await deriveKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: fromHex(parts[0]) },
    key,
    fromHex(parts[1])
  );
  return new TextDecoder().decode(decrypted);
}
