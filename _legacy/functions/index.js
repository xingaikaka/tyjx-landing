/**
 * 根路径 - 主域名跳转到随机泛域名（91jx 风格）
 * ENTRY_DOMAINS（tyjx.com 等）→ 跳转到 *.LANDING_DOMAINS
 * 泛域名 *.xxx.cc/ → 透传静态 index.html
 */

import { generateSubdomain, parseDomains, pickRandom } from './_shared/utils.js';

const DEFAULTS = {
  entryDomains: '',
  landingDomains: '',
};

function getEntryHosts(env) {
  const entryDomains = env.ENTRY_DOMAINS || DEFAULTS.entryDomains;
  return String(entryDomains).split(',').map((d) => d.trim()).filter(Boolean);
}

function isEntryDomain(host, env) {
  return getEntryHosts(env).some((h) => host === h || host.endsWith('.' + h));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const forwardedHost = request.headers.get('X-Forwarded-Host');
  const host = forwardedHost || new URL(request.url).hostname;

  if (isEntryDomain(host, env)) {
    const entryJumpUrl = env.ENTRY_JUMP_URL || '';
    const landingList = parseDomains(env.LANDING_DOMAINS || DEFAULTS.landingDomains, 20);
    const baseDomain = pickRandom(landingList) || landingList[0];
    let jumpUrl = entryJumpUrl || (baseDomain ? `https://${generateSubdomain()}.${baseDomain}` : null);
    if (!jumpUrl) {
      return new Response('LANDING_DOMAINS 未配置', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const reqUrl = new URL(request.url);
    if (reqUrl.search) {
      jumpUrl += (jumpUrl.includes('?') ? '&' : '?') + reqUrl.search.slice(1);
    }

    return new Response(null, {
      status: 302,
      headers: {
        'Location': jumpUrl,
        'Cache-Control': 'no-store',
      },
    });
  }

  return env.ASSETS.fetch(request);
}
