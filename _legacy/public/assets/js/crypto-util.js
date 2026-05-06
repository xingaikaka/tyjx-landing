/**
 * 前端加密工具 - 与 functions/_shared/crypto.js 保持一致
 * 使用 CryptoJS (需引入 crypto-js)
 * 密钥需与后端 API_SECRET 一致
 */

(function (global) {
  const SALT = 'app-landing-salt';

  function deriveKey(secret) {
    const hash = CryptoJS.SHA256(secret + SALT).toString(CryptoJS.enc.Hex);
    return CryptoJS.enc.Hex.parse(hash);
  }

  function encrypt(text, secret) {
    const key = deriveKey(secret);
    const iv = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(text, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    return iv.toString(CryptoJS.enc.Hex) + ':' + encrypted.ciphertext.toString(CryptoJS.enc.Hex);
  }

  function decrypt(encryptedText, secret) {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) throw new Error('Invalid encrypted format');
    const iv = CryptoJS.enc.Hex.parse(parts[0]);
    const encrypted = CryptoJS.enc.Hex.parse(parts[1]);
    const key = deriveKey(secret);
    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: encrypted },
      key,
      { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    );
    return decrypted.toString(CryptoJS.enc.Utf8);
  }

  global.cryptoUtil = { encrypt, decrypt };
})(typeof window !== 'undefined' ? window : this);
