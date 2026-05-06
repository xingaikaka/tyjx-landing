/**
 * Host 分类路由:
 *   brandDomain   → 'brand'   (302 → 入口页)
 *   entryPages 池 → 'entry'   (渲染入口页 HTML)
 *   publishPages 池 → 'publish' (渲染发布页 HTML)
 *   其他          → 'unknown' (404)
 *
 * 匹配规则:host === pool[i] || host endsWith '.' + pool[i]
 * 即支持把 pool 里的写成根域(`tyjxn3k8m2p7vc.cc`),subdomain 也能命中。
 */

export function classifyHost(host, domains) {
  const h = String(host || '').toLowerCase();
  if (!h) return 'unknown';

  if (matches(h, domains.brandDomains)) return 'brand';
  if (matches(h, domains.entryPages)) return 'entry';
  if (matches(h, domains.publishPages)) return 'publish';

  return 'unknown';
}

export function matches(host, pool) {
  if (!Array.isArray(pool) || pool.length === 0) return false;
  for (const d of pool) {
    const lc = String(d || '').toLowerCase();
    if (!lc) continue;
    if (host === lc || host.endsWith('.' + lc)) return true;
  }
  return false;
}

export function pickRandom(pool) {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 不重复抽 n 个;不够时返回所有 */
export function pickRandomN(pool, n) {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  if (n >= pool.length) return shuffle(pool.slice());
  return shuffle(pool.slice()).slice(0, n);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
