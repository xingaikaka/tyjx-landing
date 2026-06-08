/**
 * 拉 admin-server 的 runtime 配置(domains + portalUI),并加 3 层缓存:
 *
 *   in-memory  → KV  → admin
 *
 * - in-memory: 命中同一个 isolate 多次请求,几毫秒级
 * - KV:        命中跨 isolate / 重启,30 秒级
 * - admin:     真源,失败回退 KV / FALLBACK_POOL
 *
 * 命名:
 *   RUNTIME_CACHE_TTL  vars,默认 30 秒
 *   ADMIN_BASE_URL     secret
 *   PORTAL_API_SECRET  secret
 *   FALLBACK_POOL      secret(可选,JSON,字段同 domains)
 *
 * 返回结构:
 *   {
 *     domains: {
 *       brandDomains: string[],
 *       entryPages: string[],
 *       publishPages: string[],
 *       finalLandings: string[],
 *       entryButtonsCount: number,
 *       publishLinksCount: number,
 *     },
 *     portalUI: {...},
 *     ts: number,
 *   }
 */

import { decrypt } from './crypto.js';

const KV_KEY = 'runtime:v1';
let memCache = null; // { exp: number, data: object }

// 仅在 admin 挂 + KV 空 + FALLBACK_POOL 未设的极端场景才会被用到。
// 正常运行链路 100% 是从 admin 后台域池配置拉的,这里不要硬编码任何业务域名/文案。
const DEFAULT_RUNTIME = {
  ts: 0,
  domains: {
    brandDomains: [],
    entryPages: [],
    publishPages: [],
    finalLandings: [],
    entryButtonsCount: 2,
    publishLinksCount: 2,
  },
  portalUI: {
    logo: '',
    siteName: '',
    bookmarkTip: '',
    clickPrompt: '',
    bookmarkBlock: { line1: '', line2: '', line3: '' },
    footerNote: [],
  },
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function ttlSec(env) {
  const n = parseInt(env.RUNTIME_CACHE_TTL || '30', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

async function fetchFromAdmin(env) {
  if (!env.ADMIN_BASE_URL || !env.PORTAL_API_SECRET) {
    throw new Error('ADMIN_BASE_URL / PORTAL_API_SECRET 未配置');
  }
  const url = env.ADMIN_BASE_URL.replace(/\/+$/, '') + '/api/portal/runtime';
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'text/plain' },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!resp.ok) {
    throw new Error(`admin runtime ${resp.status}`);
  }
  const cipher = await resp.text();
  const plain = await decrypt(cipher, env.PORTAL_API_SECRET);
  const json = JSON.parse(plain);
  return normalize(json);
}

function normalize(obj) {
  const r = { ...DEFAULT_RUNTIME, ...(obj || {}) };
  r.domains = { ...DEFAULT_RUNTIME.domains, ...(obj?.domains || {}) };
  r.portalUI = { ...DEFAULT_RUNTIME.portalUI, ...(obj?.portalUI || {}) };
  r.portalUI.bookmarkBlock = {
    ...DEFAULT_RUNTIME.portalUI.bookmarkBlock,
    ...(obj?.portalUI?.bookmarkBlock || {}),
  };
  // 都强制成数组/数字
  for (const k of ['brandDomains', 'entryPages', 'publishPages', 'finalLandings']) {
    if (!Array.isArray(r.domains[k])) r.domains[k] = [];
  }
  for (const k of ['entryButtonsCount', 'publishLinksCount']) {
    const n = Number(r.domains[k]);
    r.domains[k] = Number.isInteger(n) && n > 0 ? n : 2;
  }
  if (!Array.isArray(r.portalUI.footerNote)) r.portalUI.footerNote = [];
  return r;
}

export async function getRuntime(env, ctx) {
  const ttl = ttlSec(env);
  const now = nowSec();

  // 1) memory
  if (memCache && memCache.exp > now) return memCache.data;

  // 2) KV
  if (env.RUNTIME_KV) {
    try {
      const cached = await env.RUNTIME_KV.get(KV_KEY, { type: 'json' });
      if (cached && cached.exp > now) {
        memCache = { exp: Math.min(cached.exp, now + ttl), data: cached.data };
        return cached.data;
      }
    } catch (e) {
      console.warn('KV read fail', e?.message || e);
    }
  }

  // 3) admin
  try {
    const data = await fetchFromAdmin(env);
    const exp = now + ttl;
    memCache = { exp, data };
    if (env.RUNTIME_KV) {
      // 写 KV 不阻塞响应
      const writeP = env.RUNTIME_KV.put(
        KV_KEY,
        JSON.stringify({ exp, data }),
        { expirationTtl: Math.max(ttl * 4, 120) }
      );
      if (ctx?.waitUntil) ctx.waitUntil(writeP);
    }
    return data;
  } catch (e) {
    console.warn('admin fetch fail, fallback', e?.message || e);

    // 3a) KV 旧值(过期也用)
    if (env.RUNTIME_KV) {
      try {
        const cached = await env.RUNTIME_KV.get(KV_KEY, { type: 'json' });
        if (cached?.data) {
          memCache = { exp: now + 5, data: cached.data }; // 短缓存,避免风暴
          return cached.data;
        }
      } catch (_) {
        /* ignore */
      }
    }

    // 3b) FALLBACK_POOL secret
    if (env.FALLBACK_POOL) {
      try {
        const fb = JSON.parse(env.FALLBACK_POOL);
        return normalize({ domains: fb });
      } catch (_) {
        /* ignore */
      }
    }

    // 3c) hard default
    return DEFAULT_RUNTIME;
  }
}
