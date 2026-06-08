/**
 * Cloudflare 同步路由
 *
 *   GET  /api/admin/cf/status           查 token 是否有效 + worker 是否已部署 + 路由现状
 *   POST /api/admin/cf/sync             触发一键同步:上传 worker + 同步 KV + 同步 routes
 *   POST /api/admin/cf/sync/routes-only  仅同步 routes(域池变了但代码没变时)
 *
 * 所有动作都要鉴权(继承 admin/index.js 里的 requireAuth)。
 */

import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import config from '../../lib/config.js';
import logger from '../../lib/logger.js';
import { configRepo, auditRepo } from '../../lib/db.js';
import {
  fullDeploy,
  verifyToken,
  listAllZones,
  resolveHostsToZones,
  syncZoneRoutes,
  CfApiError,
} from '../../lib/cf-deploy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const WORKER_NAME = process.env.CF_WORKER_NAME || 'tyjx-portal';

function requireToken(res) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    res.status(400).json({
      ok: false,
      msg: 'CLOUDFLARE_API_TOKEN 未配置,先在 admin-server/.env 里填好再重启',
    });
    return null;
  }
  return token;
}

function requireAccountId(res) {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) {
    res.status(400).json({ ok: false, msg: 'CLOUDFLARE_ACCOUNT_ID 未配置' });
    return null;
  }
  return id;
}

function getDistPath() {
  // 相对 admin-server/(注意 admin-server 启动时 cwd 可能不是这里)
  const rel = process.env.CF_WORKER_DIST_PATH || '../worker/dist/index.js';
  return path.resolve(config.rootDir, rel);
}

function adminBaseUrl() {
  return process.env.CF_WORKER_ADMIN_BASE_URL || 'http://43.128.4.201:8889';
}

function getTargetHosts() {
  const d = configRepo.get('domains', {}) || {};
  return [
    ...(Array.isArray(d.brandDomains) ? d.brandDomains : []),
    ...(Array.isArray(d.entryPages) ? d.entryPages : []),
    ...(Array.isArray(d.publishPages) ? d.publishPages : []),
  ];
}

/* ─────────── GET /status ─────────── */

router.get('/status', async (_req, res) => {
  const token = requireToken(res);
  if (!token) return;

  const out = {
    workerName: WORKER_NAME,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    adminBaseUrl: adminBaseUrl(),
    distPath: getDistPath(),
    distExists: false,
    distSize: 0,
    targetHosts: getTargetHosts(),
    token: { ok: false },
    workerDeployed: false,
    workersDevHost: null, // tyjx-portal.<sub>.workers.dev,3rd-party CDN 回源用
    workersDevEnabled: null,
    zones: [], // [{ name, id, routes: [{pattern, script}] }]
    unknownHosts: [],
  };

  // dist 检查
  try {
    const st = await fs.stat(getDistPath());
    out.distExists = true;
    out.distSize = st.size;
    out.distMtime = st.mtime.toISOString();
  } catch {
    out.distExists = false;
  }

  // 检查 token
  try {
    const v = await verifyToken(token);
    out.token = { ok: v.status === 'active', id: v.id };
  } catch (e) {
    out.token = { ok: false, error: e.message };
    return res.json({ ok: true, data: out });
  }

  const accountId = requireAccountId(res);
  if (!accountId) return;

  // 检查 worker 是否已部署
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    out.workerDeployed = r.ok;
  } catch (e) {
    out.workerDeployed = false;
    out.workerCheckError = e.message;
  }

  // 拿 workers.dev 子域(3rd-party CDN 回源用)
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const j = await r.json();
    if (j.success && j.result?.subdomain) {
      out.workersDevHost = `${WORKER_NAME}.${j.result.subdomain}.workers.dev`;
    }
  } catch {
    /* ignore */
  }

  // 单个 worker 的 workers.dev 开关
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/subdomain`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const j = await r.json();
    if (j.success) out.workersDevEnabled = !!j.result?.enabled;
  } catch {
    /* ignore */
  }

  // 检查每个 target zone 的路由现状
  try {
    const allZones = await listAllZones(token);
    const { zones, unknownHosts } = resolveHostsToZones(out.targetHosts, allZones);
    out.unknownHosts = unknownHosts;
    out.zones = await Promise.all(
      zones.map(async (z) => {
        try {
          const r = await fetch(
            `https://api.cloudflare.com/client/v4/zones/${z.id}/workers/routes`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const j = await r.json();
          return {
            name: z.name,
            id: z.id,
            routes: r.ok
              ? (j.result || []).map((rt) => ({ pattern: rt.pattern, script: rt.script }))
              : [],
            error: r.ok ? undefined : (j.errors?.[0]?.message || `HTTP ${r.status}`),
          };
        } catch (e) {
          return { name: z.name, id: z.id, routes: [], error: e.message };
        }
      })
    );
  } catch (e) {
    out.zonesError = e.message;
  }

  res.json({ ok: true, data: out });
});

/* ─────────── POST /sync(完整同步) ─────────── */

router.post('/sync', async (req, res) => {
  const token = requireToken(res);
  if (!token) return;
  const accountId = requireAccountId(res);
  if (!accountId) return;

  const portalApiSecret = process.env.PORTAL_API_SECRET;
  if (!portalApiSecret) {
    return res.status(400).json({ ok: false, msg: 'PORTAL_API_SECRET 未配置' });
  }

  let script;
  try {
    script = await fs.readFile(getDistPath(), 'utf8');
  } catch (e) {
    return res.status(400).json({
      ok: false,
      msg: `读不到 worker bundle: ${getDistPath()}。改完 worker 代码后请先在 packages/worker 下跑: pnpm exec wrangler deploy --dry-run --outdir=dist`,
    });
  }

  // body 可选:{ bindRoutes?: boolean, dnsPlaceholder?: boolean }
  // 默认走"3rd-party CDN 回源 workers.dev"路线,不动用户的 zone DNS / 路由
  const bindRoutes = Boolean(req.body?.bindRoutes);
  const dnsPlaceholder = Boolean(req.body?.dnsPlaceholder);
  const targetHosts = bindRoutes || dnsPlaceholder ? getTargetHosts() : [];

  try {
    const result = await fullDeploy({
      token,
      accountId,
      workerName: WORKER_NAME,
      script,
      adminBaseUrl: adminBaseUrl(),
      portalApiSecret,
      runtimeCacheTtl: Number(process.env.RUNTIME_CACHE_TTL || 30),
      targetHosts,
      bindRoutes,
      dnsPlaceholder,
      enableWorkersDev: true,
    });
    auditRepo.log(req.user.id, 'cf.sync.full', {
      bindRoutes,
      dnsPlaceholder,
      targetZones: result.summary.targetZones,
      unknownHosts: result.summary.unknownHosts,
      workersDevHost: result.summary.workersDevHost,
    });
    res.json({ ok: true, data: result });
  } catch (e) {
    logger.error('[cf] sync failed:', e);
    res.status(500).json({
      ok: false,
      msg: e.message,
      detail: e instanceof CfApiError ? e.errors : undefined,
    });
  }
});

/* ─────────── POST /sync/routes-only(只同步路由) ─────────── */

router.post('/sync/routes-only', async (req, res) => {
  const token = requireToken(res);
  if (!token) return;

  try {
    const allZones = await listAllZones(token);
    const targetHosts = getTargetHosts();
    const { zones, unknownHosts } = resolveHostsToZones(targetHosts, allZones);

    const results = [];
    for (const z of zones) {
      try {
        results.push(await syncZoneRoutes(token, z.id, z.name, WORKER_NAME));
      } catch (e) {
        results.push({ zoneName: z.name, error: e.message });
      }
    }
    auditRepo.log(req.user.id, 'cf.sync.routes', {
      zones: zones.map((z) => z.name),
    });
    res.json({ ok: true, data: { zones: results, unknownHosts } });
  } catch (e) {
    logger.error('[cf] sync routes-only failed:', e);
    res.status(500).json({ ok: false, msg: e.message });
  }
});

export default router;
