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
    const jumpUrl = entryJumpUrl || (baseDomain ? `https://${generateSubdomain()}.${baseDomain}` : null);
    if (!jumpUrl) {
      return new Response('LANDING_DOMAINS 未配置', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta http-equiv="refresh" content="0;url=${jumpUrl}"/><title>天涯精选 - 跳转中</title></head><body><p>正在跳转...</p><script>window.location.href='${jumpUrl}';</script></body></html>`;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return env.ASSETS.fetch(request);
}
