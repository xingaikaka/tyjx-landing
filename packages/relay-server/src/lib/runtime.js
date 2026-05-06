/**
 * 拉 admin-server 的 runtime 配置(domains + portalUI),三层缓存:
 *
 *   in-memory  → 本地文件  → admin
 *
 *  - in-memory:  RUNTIME_CACHE_TTL 秒内直接命中,~0ms
 *  - 本地文件:    跨进程重启兜底(进程崩溃后读到上一次成功值)
 *  - admin:      真源,失败时回退本地文件 → FALLBACK_POOL → 硬编码空池
 *
 * 与 worker 版区别:
 *  - 用 fs 替代 Cloudflare KV
 *  - admin 拉取加超时控制(避免 admin 卡住时全站雪崩)
 *  - in-flight dedup:多请求并发同时刷新只会发出 1 个 fetch
 *  - stale-while-revalidate:命中过期值时立即返回旧值并后台刷新
 *
 * 与 admin-server 的 lib/crypto.js 完全对齐(<iv hex>:<ciphertext hex>),
 * 复用 worker/src/lib/crypto.js(Web Crypto,Node 18+ 原生支持)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decrypt } from './crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let memCache = null;        // { exp:number, data:object, fetchedAt:number }
let inflight = null;        // Promise<RuntimeData> | null
let fileCacheLoaded = false;

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
    favicon: '',
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

function ttlSec() {
  const n = parseInt(process.env.RUNTIME_CACHE_TTL || '30', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function adminFetchTimeoutMs() {
  const n = parseInt(process.env.ADMIN_FETCH_TIMEOUT_MS || '4000', 10);
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

function cachePath() {
  // 默认相对 packages/relay-server/.cache/runtime.json
  const dir = process.env.RUNTIME_CACHE_DIR
    ? path.resolve(process.cwd(), process.env.RUNTIME_CACHE_DIR)
    : path.resolve(__dirname, '../../.cache');
  return { dir, file: path.join(dir, 'runtime.json') };
}

function readFileCache() {
  try {
    const { file } = cachePath();
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && obj.data) return obj; // { exp, data }
    return null;
  } catch (e) {
    console.warn('[runtime] read file cache fail:', e.message);
    return null;
  }
}

function writeFileCache(payload) {
  try {
    const { dir, file } = cachePath();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch (e) {
    console.warn('[runtime] write file cache fail:', e.message);
  }
}

async function fetchFromAdmin() {
  const baseUrl = process.env.ADMIN_BASE_URL;
  const secret = process.env.PORTAL_API_SECRET;
  if (!baseUrl || !secret) {
    throw new Error('ADMIN_BASE_URL / PORTAL_API_SECRET 未配置');
  }
  const url = baseUrl.replace(/\/+$/, '') + '/api/portal/runtime';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), adminFetchTimeoutMs());
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
      signal: ctl.signal,
    });
    if (!resp.ok) throw new Error(`admin runtime ${resp.status}`);
    const cipher = await resp.text();
    const plain = await decrypt(cipher, secret);
    return normalize(JSON.parse(plain));
  } finally {
    clearTimeout(timer);
  }
}

function normalize(obj) {
  const r = { ...DEFAULT_RUNTIME, ...(obj || {}) };
  r.domains = { ...DEFAULT_RUNTIME.domains, ...(obj?.domains || {}) };
  r.portalUI = { ...DEFAULT_RUNTIME.portalUI, ...(obj?.portalUI || {}) };
  r.portalUI.bookmarkBlock = {
    ...DEFAULT_RUNTIME.portalUI.bookmarkBlock,
    ...(obj?.portalUI?.bookmarkBlock || {}),
  };
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

function loadFileCacheOnce() {
  if (fileCacheLoaded) return;
  fileCacheLoaded = true;
  const cached = readFileCache();
  if (cached?.data) {
    // 进程刚启动:用文件值垫底,exp 给 0 表示"立即可被刷新但已可用"
    memCache = {
      exp: 0,
      data: cached.data,
      fetchedAt: Number(cached.fetchedAt) || 0,
    };
    console.log(
      `[runtime] bootstrap from file cache (fetchedAt=${new Date(memCache.fetchedAt * 1000).toISOString()})`,
    );
  }
}

async function refresh() {
  if (inflight) return inflight; // 同时只有 1 个 fetch
  inflight = (async () => {
    try {
      const data = await fetchFromAdmin();
      const ts = nowSec();
      memCache = { exp: ts + ttlSec(), data, fetchedAt: ts };
      writeFileCache({ exp: memCache.exp, data, fetchedAt: ts });
      return data;
    } catch (e) {
      console.warn('[runtime] admin fetch fail:', e.message);
      // 失败也要清掉 inflight,但保留旧 mem(让外层判断 stale)
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * 取运行时配置。
 *  - 命中新鲜 mem → 直接返回
 *  - mem 过期但有值 → 立即返回旧值,后台异步刷新(stale-while-revalidate)
 *  - 完全无 mem → 同步刷新一次;再失败用 FALLBACK_POOL / 默认空池
 */
export async function getRuntime() {
  loadFileCacheOnce();
  const now = nowSec();

  if (memCache && memCache.exp > now) return memCache.data;

  if (memCache?.data) {
    // stale → 后台刷,立即返
    refresh().catch(() => {});
    return memCache.data;
  }

  // 冷启动 → 同步等
  try {
    return await refresh();
  } catch (_) {
    // 仍取不到:fallback
    if (process.env.FALLBACK_POOL) {
      try {
        const fb = JSON.parse(process.env.FALLBACK_POOL);
        return normalize({ domains: fb });
      } catch (_) { /* ignore */ }
    }
    return DEFAULT_RUNTIME;
  }
}

/** 主动刷新接口,给 /api/_reload 用 */
export async function forceRefresh() {
  return refresh();
}

/** 调试:返回缓存元信息 */
export function inspectCache() {
  return {
    hasMem: !!memCache,
    memExp: memCache?.exp || 0,
    memFetchedAt: memCache?.fetchedAt || 0,
    nowSec: nowSec(),
    ttlSec: ttlSec(),
    inflight: !!inflight,
  };
}
