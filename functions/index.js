/**
 * 根路径 - 主域名跳转到随机泛域名（91jx 风格）
 * tyjx.app/、tycg.app/ → 跳转到 *.tyjxnf0skf9h.cc
 * 泛域名 *.xxx.cc/ → 透传静态 index.html
 */

import { generateSubdomain } from './_shared/utils.js';

const ENTRY_HOSTS = ['tyjx.app', 'tycg.app', 'tyjx-landing.pages.dev'];
const DEFAULTS = { landingDomains: 'tyjxnf0skf9h.cc' };

function isEntryDomain(host) {
  return ENTRY_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const host = new URL(request.url).hostname;

  if (isEntryDomain(host)) {
    const entryJumpUrl = env.ENTRY_JUMP_URL || '';
    const landingDomains = env.LANDING_DOMAINS || env.JUMP_DOMAINS || DEFAULTS.landingDomains;
    const baseDomain = String(landingDomains).split(',')[0]?.trim();
    const jumpUrl = entryJumpUrl || (baseDomain ? `https://${generateSubdomain()}.${baseDomain}` : '/');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta http-equiv="refresh" content="0;url=${jumpUrl}"/><title>天涯精选 - 跳转中</title></head><body><p>正在跳转...</p><script>window.location.href='${jumpUrl}';</script></body></html>`;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return env.ASSETS.fetch(request);
}
