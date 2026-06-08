/**
 * Cloudflare Worker 部署 / 配置同步核心库。
 *
 *   - 部署 worker 代码(PUT script)
 *   - 创建 / 复用 KV namespace
 *   - 同步 vars / secrets / KV binding
 *   - 同步 zone 下的 Worker Routes(可选,默认关闭;只有在 CF 直接当 CDN 时用)
 *   - 自动给每个目标 zone 加占位 DNS(可选,默认关闭)
 *
 * 既被 CLI 脚本(scripts/cf-deploy.mjs)用,也被 admin 路由
 * (POST /api/admin/cf/sync)用。两条调用入口共用同一份逻辑。
 *
 * Cloudflare Worker 部署原理:
 *   PUT /accounts/{aid}/workers/scripts/{name}  multipart/form-data
 *     - field "metadata"  application/json   → bindings/compat date/main_module
 *     - field "<main>"    application/javascript+module  → 实际脚本
 *
 *   secrets 通过 metadata.bindings 里 type=secret_text 直接传(等价 wrangler secret put),
 *   每次 PUT 都会用新值覆盖旧的;不传就走 keep_bindings 保留。
 */

import logger from './logger.js';

const CF_API = 'https://api.cloudflare.com/client/v4';

/* ─────────── CF API 通用封装 ─────────── */

export class CfApiError extends Error {
  constructor(method, url, status, errors) {
    super(
      `CF API ${method} ${url} → ${status}: ${
        Array.isArray(errors) ? errors.map((e) => `[${e.code}] ${e.message}`).join('; ') : errors
      }`
    );
    this.status = status;
    this.errors = errors;
    this.url = url;
  }
}

async function cfFetch(token, method, url, opts = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...(opts.headers || {}) };
  const res = await fetch(`${CF_API}${url}`, { method, headers, body: opts.body });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new CfApiError(method, url, res.status, [{ code: 0, message: `non-JSON response` }]);
  }
  if (!json.success) {
    throw new CfApiError(method, url, res.status, json.errors || [{ message: 'unknown' }]);
  }
  return json;
}

async function cfJson(token, method, url, body) {
  return cfFetch(token, method, url, {
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then((j) => j.result);
}

/* ─────────── token / zones / kv 基础查询 ─────────── */

export async function verifyToken(token) {
  return cfJson(token, 'GET', '/user/tokens/verify');
}

/** 获取所有 zone(自动翻页) */
export async function listAllZones(token) {
  const out = [];
  let page = 1;
  for (;;) {
    const j = await cfFetch(token, 'GET', `/zones?per_page=50&page=${page}`);
    out.push(...j.result);
    const info = j.result_info || {};
    if (!info.total_pages || page >= info.total_pages) break;
    page += 1;
  }
  return out;
}

/** 列出账号下所有 KV namespace */
export async function listKvNamespaces(token, accountId) {
  return cfJson(token, 'GET', `/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
}

/** 创建 KV namespace(若同名已存在则返回已有的) */
export async function ensureKvNamespace(token, accountId, title) {
  const all = await listKvNamespaces(token, accountId);
  const exist = all.find((n) => n.title === title);
  if (exist) return exist;
  return cfJson(token, 'POST', `/accounts/${accountId}/storage/kv/namespaces`, { title });
}

/* ─────────── DNS:占位记录(给 worker route 让请求进 zone) ─────────── */

/**
 * 给一个 zone 加占位 AAAA 记录(orange cloud),让 worker route 能拦到请求。
 *  - apex:`<zone>` → AAAA 100::
 *  - 通配:`*.<zone>` → AAAA 100::
 *
 * Cloudflare 的"占位 IP"惯例:AAAA 100:: 或 A 192.0.2.1。
 * 真正的处理由 worker 兜住,DNS 只需要让 zone 接到请求即可。
 *
 * 这里**故意宽松**:如果该 name 上已经有任何类型的记录(CNAME 到腾讯 CDN
 * 之类),完全跳过,不动用户已有配置。worker route 在橙云记录上才生效;
 * 灰云 CNAME 到外部 CDN 的话 worker 本来就不会拦,跟我们的目标兼容。
 */
async function ensureDnsAny(token, zoneId, name, type, content) {
  // 注意:CF API 用 ?name= 时会精确匹配该 fqdn 的所有类型记录
  const exist = await cfJson(
    token,
    'GET',
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=10`
  );
  if (exist.length > 0) {
    return {
      skipped: true,
      reason: `record exists (${exist.map((e) => e.type).join(',')})`,
      records: exist,
    };
  }
  try {
    const created = await cfJson(token, 'POST', `/zones/${zoneId}/dns_records`, {
      type,
      name,
      content,
      ttl: 1,
      proxied: true,
    });
    return { skipped: false, record: created };
  } catch (e) {
    // CF 偶尔报"already exists",当成跳过
    if (String(e.message).includes('already exists')) {
      return { skipped: true, reason: 'already exists (race)' };
    }
    throw e;
  }
}

export async function ensurePlaceholderDns(token, zoneId, zoneName) {
  const placeholder = '100::';
  const apex = await ensureDnsAny(token, zoneId, zoneName, 'AAAA', placeholder);
  const wildcard = await ensureDnsAny(token, zoneId, `*.${zoneName}`, 'AAAA', placeholder);
  return { apex, wildcard };
}

/* ─────────── Worker 上传 ─────────── */

/**
 * 上传 worker 脚本。bindings 全量覆盖(每次 deploy 都会按传入的重置)。
 *
 * @param {string} token
 * @param {string} accountId
 * @param {string} workerName
 * @param {string} script             ESM 模块代码字符串
 * @param {object} opts
 * @param {string} opts.kvNamespaceId KV binding 用,空字符串=不绑 KV
 * @param {object} opts.vars          { KEY: 'value' } plain_text
 * @param {object} opts.secrets       { KEY: 'value' } secret_text
 * @param {string} opts.compatibilityDate
 */
export async function uploadWorkerScript(token, accountId, workerName, script, opts = {}) {
  const bindings = [];
  if (opts.kvNamespaceId) {
    bindings.push({
      type: 'kv_namespace',
      name: 'RUNTIME_KV',
      namespace_id: opts.kvNamespaceId,
    });
  }
  for (const [name, value] of Object.entries(opts.vars || {})) {
    bindings.push({ type: 'plain_text', name, text: String(value) });
  }
  for (const [name, value] of Object.entries(opts.secrets || {})) {
    bindings.push({ type: 'secret_text', name, text: String(value) });
  }

  const metadata = {
    main_module: 'index.js',
    compatibility_date: opts.compatibilityDate || '2025-04-01',
    bindings,
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append(
    'index.js',
    new Blob([script], { type: 'application/javascript+module' }),
    'index.js'
  );

  return cfFetch(token, 'PUT', `/accounts/${accountId}/workers/scripts/${workerName}`, {
    body: form,
  }).then((j) => j.result);
}

/** 关闭 worker 自带的 workers.dev 子域,生产推荐 false */
export async function setWorkersDevSubdomain(token, accountId, workerName, enabled) {
  return cfJson(
    token,
    'POST',
    `/accounts/${accountId}/workers/scripts/${workerName}/subdomain`,
    { enabled }
  );
}

/* ─────────── Worker Routes(按 zone 同步) ─────────── */

export async function listZoneRoutes(token, zoneId) {
  return cfJson(token, 'GET', `/zones/${zoneId}/workers/routes`);
}

export async function createZoneRoute(token, zoneId, pattern, script) {
  return cfJson(token, 'POST', `/zones/${zoneId}/workers/routes`, { pattern, script });
}

export async function deleteZoneRoute(token, zoneId, routeId) {
  return cfJson(token, 'DELETE', `/zones/${zoneId}/workers/routes/${routeId}`);
}

/**
 * 计算一个 zone 下"应该有"的 worker 路由 patterns:
 *   - apex 也要被 worker 接管:    `<zone>/*`
 *   - 任意子域都要被 worker 接管:  `*.<zone>/*`
 *
 * 注意:CF 的 route 通配符只支持 `*` 和具名前缀,不支持嵌套通配。
 */
function desiredPatternsForZone(zoneName) {
  return [`${zoneName}/*`, `*.${zoneName}/*`];
}

/**
 * 把一个 zone 的 worker 路由同步到目标状态:
 *   - 新增缺失的目标 pattern(绑到本 worker)
 *   - 删除"曾经绑过本 worker、但现在不在目标列表"的路由
 *   - 不动绑定到其他 worker 的路由
 */
export async function syncZoneRoutes(token, zoneId, zoneName, workerName) {
  const want = desiredPatternsForZone(zoneName);
  const have = await listZoneRoutes(token, zoneId);
  const haveOurs = have.filter((r) => r.script === workerName);

  const haveSet = new Set(haveOurs.map((r) => r.pattern));
  const wantSet = new Set(want);

  const toAdd = want.filter((p) => !haveSet.has(p));
  const toDel = haveOurs.filter((r) => !wantSet.has(r.pattern));

  const added = [];
  const deleted = [];

  for (const p of toAdd) {
    try {
      const r = await createZoneRoute(token, zoneId, p, workerName);
      added.push(p);
      logger.info(`[cf] route + ${p} → ${workerName} (zone=${zoneName})`);
      void r;
    } catch (e) {
      logger.error(`[cf] route + ${p} failed: ${e.message}`);
      throw e;
    }
  }
  for (const r of toDel) {
    try {
      await deleteZoneRoute(token, zoneId, r.id);
      deleted.push(r.pattern);
      logger.info(`[cf] route - ${r.pattern} (zone=${zoneName})`);
    } catch (e) {
      logger.error(`[cf] route - ${r.pattern} failed: ${e.message}`);
      throw e;
    }
  }

  return { zoneName, want, added, deleted, kept: [...haveSet].filter((p) => wantSet.has(p)) };
}

/* ─────────── 高层:从 admin 配置拉一遍域名 → zone 列表 ─────────── */

/**
 * 把 host 列表(可能是 `entry1.tyjxhotpzixm.cc` 等具体域名)
 * 归一到 "zone 根域" 集合。
 *
 *   tyjx.app                  → tyjx.app
 *   foo.tyjxhotpzixm.cc       → tyjxhotpzixm.cc
 *   a.b.tyjx7k2m9pqs4.cc      → tyjx7k2m9pqs4.cc
 *
 * 算法:对每个 host,从已知 zone 列表里找最长后缀匹配。
 * 找不到的 → 返回到 unknownHosts(用户需要先把 zone 加到 CF)。
 */
export function resolveHostsToZones(hosts, allZones) {
  const zoneNames = allZones.map((z) => z.name).sort((a, b) => b.length - a.length);
  const matchedZones = new Set();
  const unknown = [];
  for (const raw of hosts) {
    const host = String(raw || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!host) continue;
    const zoneName = zoneNames.find((z) => host === z || host.endsWith('.' + z));
    if (zoneName) matchedZones.add(zoneName);
    else unknown.push(host);
  }
  return {
    zones: allZones.filter((z) => matchedZones.has(z.name)),
    unknownHosts: unknown,
  };
}

/* ─────────── 一键全量同步入口 ─────────── */

/**
 * 完整部署流程,被 CLI / admin 路由共用。
 *
 * @param {object} ctx
 * @param {string} ctx.token            CF API Token
 * @param {string} ctx.accountId        CF account id
 * @param {string} ctx.workerName       默认 'tyjx-portal'
 * @param {string} ctx.script           worker bundle 内容(必传,由 caller 读 dist/index.js)
 * @param {string} ctx.kvTitle          KV namespace 标题,默认 'tyjx-portal-runtime'
 * @param {string} ctx.adminBaseUrl     Worker 调 admin 的 URL(http(s)://host[:port])
 * @param {string} ctx.portalApiSecret  与 admin .env PORTAL_API_SECRET 同值
 * @param {number} ctx.runtimeCacheTtl  KV 缓存秒,默认 30
 * @param {string[]} ctx.targetHosts    要绑路由的域(brand+entry+publish 全集)
 * @param {boolean} ctx.bindRoutes      是否绑 worker routes,默认 false
 *                                       (走第三方 CDN 回源 workers.dev 时不需要)
 * @param {boolean} ctx.dnsPlaceholder  是否给目标 zone 自动建占位 DNS,默认 false
 * @param {boolean} ctx.enableWorkersDev 是否打开 workers.dev 子域,默认 true
 *                                       (作为 3rd-party CDN 回源域用)
 * @returns {Promise<object>} 各阶段执行结果
 */
export async function fullDeploy(ctx) {
  const result = {
    startedAt: new Date().toISOString(),
    steps: [],
  };

  function step(name, data) {
    result.steps.push({ name, data, ts: Date.now() });
    logger.info(`[cf] step: ${name}`);
  }

  const {
    token,
    accountId,
    workerName = 'tyjx-portal',
    script,
    kvTitle = 'tyjx-portal-runtime',
    adminBaseUrl,
    portalApiSecret,
    runtimeCacheTtl = 30,
    targetHosts = [],
    bindRoutes = false,
    dnsPlaceholder = false,
    enableWorkersDev = true,
  } = ctx;

  if (!token) throw new Error('CF token 缺失');
  if (!accountId) throw new Error('CF account id 缺失');
  if (!script) throw new Error('worker script bundle 缺失');
  if (!adminBaseUrl) throw new Error('adminBaseUrl 缺失');
  if (!portalApiSecret) throw new Error('portalApiSecret 缺失');

  // 1) 验 token
  const verify = await verifyToken(token);
  step('verifyToken', verify);

  // 2) 列 zones
  const allZones = await listAllZones(token);
  step('listZones', { count: allZones.length });

  // 3) KV namespace
  const ns = await ensureKvNamespace(token, accountId, kvTitle);
  step('ensureKvNamespace', { id: ns.id, title: ns.title });

  // 4) 上传 worker(覆盖 bindings)
  await uploadWorkerScript(token, accountId, workerName, script, {
    kvNamespaceId: ns.id,
    vars: { RUNTIME_CACHE_TTL: String(runtimeCacheTtl) },
    secrets: {
      ADMIN_BASE_URL: adminBaseUrl,
      PORTAL_API_SECRET: portalApiSecret,
    },
  });
  step('uploadWorkerScript', { workerName });

  // 5) workers.dev 子域开关(默认开,作为 3rd-party CDN 回源域)
  try {
    await setWorkersDevSubdomain(token, accountId, workerName, enableWorkersDev);
    step('workersDevSubdomain', { enabled: enableWorkersDev });
  } catch (e) {
    step('workersDevSubdomain', { error: e.message });
  }

  // 6) 拿 account 的 workers.dev 子域名(给 caller 显示回源域用)
  let workersDevHost = null;
  try {
    const sd = await cfJson(token, 'GET', `/accounts/${accountId}/workers/subdomain`);
    if (sd && sd.subdomain) {
      workersDevHost = `${workerName}.${sd.subdomain}.workers.dev`;
    }
    step('workersDevHost', { host: workersDevHost });
  } catch (e) {
    step('workersDevHost', { error: e.message });
  }

  // 7) 解析 targetHosts → zones(只用来给 routes/DNS 操作做参考,跳过空列表)
  let targetZones = [];
  let unknownHosts = [];
  if (targetHosts.length > 0 && (bindRoutes || dnsPlaceholder)) {
    const r = resolveHostsToZones(targetHosts, allZones);
    targetZones = r.zones;
    unknownHosts = r.unknownHosts;
    step('resolveZones', {
      targetCount: targetZones.length,
      targetZones: targetZones.map((z) => z.name),
      unknownHosts,
    });
  }

  // 8) 占位 DNS(可选,只在 bindRoutes/dnsPlaceholder 开启时跑)
  if (dnsPlaceholder) {
    for (const z of targetZones) {
      try {
        const r = await ensurePlaceholderDns(token, z.id, z.name);
        step(`dns:${z.name}`, {
          apex: r.apex.skipped ? `skip(${r.apex.reason})` : 'created',
          wildcard: r.wildcard.skipped ? `skip(${r.wildcard.reason})` : 'created',
        });
      } catch (e) {
        step(`dns:${z.name}`, { error: e.message });
      }
    }
  }

  // 9) Worker Routes(可选,只在 bindRoutes 开启时跑)
  const routeResults = [];
  if (bindRoutes) {
    for (const z of targetZones) {
      try {
        const r = await syncZoneRoutes(token, z.id, z.name, workerName);
        routeResults.push(r);
        step(`routes:${z.name}`, { added: r.added, deleted: r.deleted });
      } catch (e) {
        routeResults.push({ zoneName: z.name, error: e.message });
        step(`routes:${z.name}`, { error: e.message });
      }
    }
  }

  result.finishedAt = new Date().toISOString();
  result.summary = {
    workerName,
    kvNamespaceId: ns.id,
    workersDevHost,
    targetZones: targetZones.map((z) => z.name),
    unknownHosts,
    routes: routeResults,
    routesBound: bindRoutes,
  };
  return result;
}
