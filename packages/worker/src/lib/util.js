/**
 * Worker 通用工具:HTML escape / Response helpers / scheme 推断
 */

const HTML_ESC = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

export function htmlResponse(html, init = {}) {
  return new Response(html, {
    status: 200,
    ...init,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow',
      ...(init.headers || {}),
    },
  });
}

export function jsonResponse(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      ...(init.headers || {}),
    },
  });
}

export function notFound(msg = 'Not Found') {
  return new Response(msg, {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export function redirect(url, status = 302) {
  return new Response(null, {
    status,
    headers: {
      Location: url,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

/**
 * 推请求 url 该走 https 还是 http。本系统所有线上域都走 https。
 * 仅在本地 dev 时可能 http。
 */
export function pickScheme(url) {
  return url.protocol === 'http:' ? 'http:' : 'https:';
}

/**
 * 生成随机子域(默认 12 位字母+数字)。
 * 入口/发布池里的 zone 都配的是泛域名,需要任意子域来访问;
 * 直接跳 zone apex 在 cdn666 + DNS 灰云的部署下不可用。
 */
export function randomSubdomain(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
