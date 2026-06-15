/**
 * relay-server 入口
 *
 * 设计思路:
 *   核心 handler.js 用标准 Web API(Request/Response/fetch/crypto.subtle 全 Node18+ 原生)。
 *   本文件只做两件事:
 *     1. 启动 Express 监听 HTTP
 *     2. Express req → Web Request,Web Response → Express res 的双向适配
 *
 * 部署:
 *   生产:Nginx(443/80) → 本服务(127.0.0.1:3020)
 *   - tyjx.app(brandDomain)→ 302 到随机 entryPage 子域
 *   - *.entryPages 池(*.tyjxn3k8m2p7vc.cc 等)→ 渲染入口页(图1)
 *   - *.publishPages 池(*.tyjxbn4w8fgh3.cc 等)→ 渲染发布页(图2)
 *
 *   本地 dev:
 *     pnpm --filter @tyjx/relay-server dev
 *     curl -H 'Host: tyjx.app' http://127.0.0.1:3020/
 */

import 'dotenv/config';
import express from 'express';
import { handleRequest } from './handler.js';

const PORT = parseInt(process.env.PORT || '3020', 10);
const HOST = process.env.HOST || '127.0.0.1';

const app = express();

// 跑在 nginx 后面,需要信任 X-Forwarded-* 头
app.set('trust proxy', 1);

// 不解析任何 body(中转跳转 + GET 渲染均不需要),减少内存/CPU 开销
// 也避免 multer / urlencoded 在大 body 下的尾延迟

app.disable('x-powered-by');

// 极简访问日志(生产高并发可关掉,改用 nginx access log)
app.use((req, _res, next) => {
  if (req.path !== '/api/health') {
    const xfh = req.headers['x-forwarded-host'] || '';
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.path}` +
        (xfh ? ` xfh=${xfh}` : '') +
        ` host=${req.headers.host || ''}` +
        ` ip=${req.ip}`,
    );
  }
  next();
});

// 健康检查走原生 Express,绕开 handler 不依赖 admin
// /__health 是 nginx upstream check / PM2 健康检查约定路径(对齐 dp/tyjx-relay-server)
// /healthz 保留作向后兼容
app.get(['/__health', '/healthz'], (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 兜底路由:把 Express req 包装成 Web Request,丢给 handler 处理
app.all(/.*/, async (req, res) => {
  try {
    const webReq = expressToWebRequest(req);
    const webRes = await handleRequest(webReq);
    await sendWebResponse(res, webRes);
  } catch (e) {
    console.error('[index] dispatch fail:', e?.stack || e);
    if (!res.headersSent) {
      res.status(500).type('text/plain').send('Internal Error');
    }
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[relay-server] listening on http://${HOST}:${PORT}`);
  console.log(`  ADMIN_BASE_URL = ${process.env.ADMIN_BASE_URL || '(unset)'}`);
  console.log(`  RUNTIME_CACHE_TTL = ${process.env.RUNTIME_CACHE_TTL || '30'}s`);
});

/**
 * Express req → 标准 Web Request
 *
 * 难点:
 *   - URL 必须是绝对地址(Web Request 要求);用 X-Forwarded-Proto + Host 拼最贴近"用户真实访问"的 URL
 *   - 对于 GET/HEAD,不能传 body,Web Request 会抛
 *   - 对于其他方法,需要把 Express 的 req(IncomingMessage)桥成 Web ReadableStream
 *     —— 但本服务只用 GET,简单起见非 GET 一律不带 body
 */
function expressToWebRequest(req) {
  const proto =
    (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim() ||
    (req.secure ? 'https' : 'http');
  const host = (req.headers.host || 'localhost').toString();
  const url = `${proto}://${host}${req.originalUrl || req.url}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, String(item));
    } else {
      headers.set(k, String(v));
    }
  }

  const init = { method: req.method, headers };
  // 跳过 body(GET/HEAD 必须;其他方法本服务不接收用户数据)
  return new Request(url, init);
}

/**
 * Web Response → Express res
 *
 *  - 复制状态码 + headers
 *  - 用 arrayBuffer 把全部 body 一次拿到再 res.end(本服务响应都很小:HTML/JSON/302)
 *  - hop-by-hop / 不该透传的头跳过
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // 由 express 自己控制
  'content-length',
]);

async function sendWebResponse(res, webRes) {
  res.status(webRes.status);
  webRes.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });
  if (webRes.status === 204 || webRes.status === 304) {
    return res.end();
  }
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

// 优雅关闭
function shutdown(sig) {
  console.log(`[relay-server] received ${sig}, shutting down`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
