/**
 * 入口跳转页 - GET /entry
 */

import { generateSubdomain } from './_shared/utils.js';

const DEFAULTS = { landingDomains: 'tyjxnf0skf9h.cc' };

export async function onRequestGet(context) {
  const { env } = context;
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
