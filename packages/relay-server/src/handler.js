/**
 * 中转/入口/发布 核心 Handler
 *
 * 接受标准 Web Request,返回标准 Web Response。
 * Node 18+ 原生支持 Request / Response / fetch / crypto.subtle。
 *
 * 路由策略:
 *   - host 命中 brandDomains      → 302 → 随机 entryPage 子域(图1)
 *   - host 命中 entryPages 池     → 渲染入口页(图1)
 *   - host 命中 publishPages 池   → 渲染发布页(图2)
 *   - path 命中 /api/*           → 内部 API
 *   - 其他                        → 404
 *
 * 注意 Host 选择(pickEffectiveHost):
 *   入站可能是直连 / 走 cdn666 / 走 nginx,我们要选最反映"用户真实访问域"的那个。
 *   优先级:X-Forwarded-Host > Host > url.hostname,跳过 *.localhost。
 */

import { getRuntime, forceRefresh, inspectCache } from './lib/runtime.js';
import { classifyHost, pickRandom, pickRandomN } from './lib/router.js';
import {
  htmlResponse,
  jsonResponse,
  notFound,
  redirect,
  randomSubdomain,
  sanitizeChannelCode,
  channelQuery,
} from './lib/util.js';
import { renderEntryPage } from './templates/entry.js';
import { renderPublishPage } from './templates/publish.js';

/**
 * @param {Request} req  标准 Web Request(由 src/index.js 适配 Express 后构造)
 * @returns {Promise<Response>}
 */
export async function handleRequest(req) {
  const url = new URL(req.url);

  const xfh = req.headers.get('x-forwarded-host') || '';
  const hostHeader = (req.headers.get('host') || '').toLowerCase();
  const urlHost = url.hostname.toLowerCase();
  const host = pickEffectiveHost(xfh, hostHeader, urlHost);
  const path = url.pathname;
  // 多层代理下 Node 收到的实际是 http,要看 X-Forwarded-Proto 拼跳转 URL
  // (cdn666 → nginx → relay-server,nginx 已 set X-Forwarded-Proto $scheme)
  const proto =
    (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase() ||
    (url.protocol === 'http:' ? 'http' : 'https');
  const scheme = `${proto}:`;

  try {
    // 内部 API(无关 host,任意域都可访问;鉴权由调用方/网关保证)
    if (path.startsWith('/api/')) {
      const runtime = await getRuntime();
      return handleApi(req, url, runtime);
    }

    const runtime = await getRuntime();
    const cls = classifyHost(host, runtime.domains);

    // 渠道码:入口域(tyjx.app?channelCode=xxx)带入,逐跳透传到用户最终复制的地址
    const channelCode = sanitizeChannelCode(url.searchParams.get('channelCode'));

    if (cls === 'brand') {
      const next = pickRandom(runtime.domains.entryPages);
      if (!next) return notFound('No entry pages configured');
      // 入口/发布池都是泛域名 + 灰云 / 第三方 CDN,zone apex 没记录 → 加随机子域
      // 渠道码透传给入口页,后续每跳继续往下带
      return redirect(`${scheme}//${randomSubdomain()}.${next}/${channelQuery(channelCode)}`, 302);
    }

    if (cls === 'entry') {
      return htmlResponse(renderEntryPage(runtime, channelCode));
    }

    if (cls === 'publish') {
      return htmlResponse(renderPublishPage(runtime, channelCode));
    }

    return notFound(`Unknown host: ${host}`);
  } catch (e) {
    console.error('[handler] error', e?.stack || e);
    return new Response('Internal Error', { status: 500 });
  }
}

function handleApi(req, url, runtime) {
  const path = url.pathname;
  const probeToken = process.env.RUNTIME_PROBE_TOKEN || '';

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
    if (!probeToken || url.searchParams.get('token') !== probeToken) {
      return notFound('not found');
    }
    return jsonResponse({
      runtimeTs: runtime.ts || 0,
      cache: inspectCache(),
      poolCounts: {
        brand: runtime.domains.brandDomains.length,
        entry: runtime.domains.entryPages.length,
        publish: runtime.domains.publishPages.length,
        finalLandings: runtime.domains.finalLandings.length,
      },
      sample: {
        firstBrand: runtime.domains.brandDomains[0] || null,
        firstEntry: runtime.domains.entryPages[0] || null,
        firstPublish: runtime.domains.publishPages[0] || null,
        firstLanding: runtime.domains.finalLandings[0] || null,
      },
      siteName: runtime.portalUI.siteName || '',
    });
  }

  if (path === '/api/_reload') {
    if (!probeToken || url.searchParams.get('token') !== probeToken) {
      return notFound('not found');
    }
    return forceRefresh()
      .then(() =>
        jsonResponse({ ok: true, msg: 'runtime reloaded', cache: inspectCache() }),
      )
      .catch((e) =>
        jsonResponse({ ok: false, msg: e.message }, { status: 500 }),
      );
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
 *   - X-Forwarded-Host:第三方 CDN (cdn666 / 腾讯) 一般会带,这是用户真正访问的域名
 *   - Host header:CDN 没设 X-Forwarded-Host 但保留了原 Host,也用它
 *   - url.hostname:直连(无中间 CDN)时用
 *
 * 任何看着像 localhost 的都跳过(那是回源的目标域,不是用户感知的)。
 * 含端口的 (:8080) 会被截掉。
 */
function pickEffectiveHost(xfh, hostHeader, urlHost) {
  const candidates = [xfh, hostHeader, urlHost];
  for (const raw of candidates) {
    const h = String(raw || '')
      .toLowerCase()
      .split(',')[0]   // X-Forwarded-Host 可能多值,取第一
      .trim()
      .split(':')[0];  // 去 port
    if (!h) continue;
    if (h === 'localhost' || h.endsWith('.localhost')) continue;
    return h;
  }
  return urlHost;
}
