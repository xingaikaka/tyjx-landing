/**
 * tyjx-portal Worker 入口
 *
 * 路由策略:
 *   - host 命中 brandDomains       → 302 到随机 entryPage
 *   - host 命中 entryPages 池      → 渲染入口页(图 1)
 *   - host 命中 publishPages 池    → 渲染发布页(图 2)
 *   - path 命中 /api/*             → 内部 API
 *   - 其他                         → 404
 *
 * 配置 / 加密 / 缓存 在 lib/runtime.js;HTML 在 templates/。
 */

import { getRuntime } from './lib/runtime.js';
import { classifyHost, pickRandom, pickRandomN } from './lib/router.js';
import {
  htmlResponse,
  jsonResponse,
  notFound,
  redirect,
  pickScheme,
  randomSubdomain,
} from './lib/util.js';
import { renderEntryPage } from './templates/entry.js';
import { renderPublishPage } from './templates/publish.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // 优先取 X-Forwarded-Host(第三方 CDN 如腾讯/EdgeOne 回源 workers.dev 时,
    // 通过这个 header 把用户真正访问的域名带过来),其次 Host header,最后 url.hostname。
    // 注意:Host header 在 workers.dev 直接访问时是 *.workers.dev,要把那种过滤掉。
    const xfh = req.headers.get('x-forwarded-host') || '';
    const hostHeader = (req.headers.get('host') || '').toLowerCase();
    const urlHost = url.hostname.toLowerCase();
    const host = pickEffectiveHost(xfh, hostHeader, urlHost);
    const path = url.pathname;
    const scheme = pickScheme(url);

    try {
      const runtime = await getRuntime(env, ctx);

      // ── 内部 API ──────────────────────────────────────────
      if (path.startsWith('/api/')) {
        return handleApi(req, url, runtime);
      }

      // ── host 分发 ────────────────────────────────────────
      const cls = classifyHost(host, runtime.domains);

      if (cls === 'brand') {
        const next = pickRandom(runtime.domains.entryPages);
        if (!next) return notFound('No entry pages configured');
        // 入口/发布池都是 cdn666 + 灰云 + 泛域名,zone apex 没记录,
        // 直接跳裸 zone 会失败,所以加随机子域。
        return redirect(`${scheme}//${randomSubdomain()}.${next}/`, 302);
      }

      if (cls === 'entry') {
        return htmlResponse(renderEntryPage(runtime));
      }

      if (cls === 'publish') {
        return htmlResponse(renderPublishPage(runtime));
      }

      return notFound(`Unknown host: ${host}`);
    } catch (e) {
      console.error('worker error', e?.stack || e);
      return new Response('Internal Error', { status: 500 });
    }
  },
};

/**
 * 内部 API
 *  GET /api/r?type=entry|publish&n=N      → 返回随机 N 个域(JSON)
 *  GET /api/jump?n=N                       → 返回随机 N 个 finalLandings
 *  GET /api/health                         → ok
 */
function handleApi(req, url, runtime) {
  const path = url.pathname;

  if (path === '/api/health') {
    return jsonResponse({
      ok: true,
      ts: Math.floor(Date.now() / 1000),
      runtimeTs: runtime.ts || 0,
      pool: {
        brand: runtime.domains.brandDomains.length,
        entry: runtime.domains.entryPages.length,
        publish: runtime.domains.publishPages.length,
        landings: runtime.domains.finalLandings.length,
      },
    });
  }
  if (path === '/api/_debug') {
    return jsonResponse({
      hasAdminBaseUrl: typeof runtime !== 'undefined',
      runtimeTs: runtime.ts || 0,
      poolCounts: {
        brand: runtime.domains.brandDomains.length,
        entry: runtime.domains.entryPages.length,
        publish: runtime.domains.publishPages.length,
      },
      sample: {
        firstBrand: runtime.domains.brandDomains[0] || null,
        firstEntry: runtime.domains.entryPages[0] || null,
        firstPublish: runtime.domains.publishPages[0] || null,
      },
      siteName: runtime.portalUI.siteName || '',
    });
  }

  if (path === '/api/r') {
    const type = url.searchParams.get('type');
    const n = clampInt(url.searchParams.get('n'), 1, 20);
    let pool = [];
    if (type === 'entry') pool = runtime.domains.entryPages;
    else if (type === 'publish') pool = runtime.domains.publishPages;
    else return jsonResponse({ ok: false, msg: 'bad type' }, { status: 400 });
    return jsonResponse({ ok: true, list: pickRandomN(pool, n) });
  }

  if (path === '/api/jump') {
    const n = clampInt(url.searchParams.get('n'), 1, 20);
    return jsonResponse({
      ok: true,
      list: pickRandomN(runtime.domains.finalLandings, n),
    });
  }

  return jsonResponse({ ok: false, msg: 'not found' }, { status: 404 });
}

function clampInt(s, min, max) {
  const n = parseInt(s || '', 10);
  if (!Number.isFinite(n)) return 1;
  return Math.max(min, Math.min(max, n));
}

/**
 * 选最有效的 host:
 *   - X-Forwarded-Host:第三方 CDN 一般会带,这是用户真正访问的域名
 *   - Host header:CDN 没设 X-Forwarded-Host 但保留了原 Host,也用它
 *   - url.hostname:走 CF 直连(无中间 CDN)时用
 *
 * 任何看着像 *.workers.dev 的都跳过(那是 CDN 回源的目标域,不是用户感知的)。
 * 含端口的 (:8080) 会被截掉。
 */
function pickEffectiveHost(xfh, hostHeader, urlHost) {
  const candidates = [xfh, hostHeader, urlHost];
  for (const raw of candidates) {
    const h = String(raw || '')
      .toLowerCase()
      .split(',')[0]   // X-Forwarded-Host 可能多值,取第一
      .trim()
      .split(':')[0]; // 去 port
    if (!h) continue;
    if (h.endsWith('.workers.dev')) continue;
    return h;
  }
  return urlHost;
}
