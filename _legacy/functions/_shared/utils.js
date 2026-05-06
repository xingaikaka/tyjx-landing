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

export function parseDomains(domains, count = 999) {
  const list = (domains || '').split(',').map((d) => d.trim()).filter(Boolean);
  return count >= list.length ? list : list.slice(0, count);
}

/** 从数组中随机取 1 个元素 */
export function pickRandom(arr) {
  if (!arr?.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 从数组中随机取 n 个不重复元素 */
export function pickRandomN(arr, n) {
  if (!arr?.length || n <= 0) return [];
  const copy = [...arr];
  if (n >= copy.length) return shuffle(copy);
  const result = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return result;
}

/** Fisher-Yates 洗牌 */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

