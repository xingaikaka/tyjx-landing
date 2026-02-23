/**
 * 公共工具函数
 */

export function generateSubdomain(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function parseDomains(domains, count = 2) {
  return (domains || '').split(',').map((d) => d.trim()).filter(Boolean).slice(0, count);
}
