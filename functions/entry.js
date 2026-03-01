/**
 * 入口跳转页 - GET /entry
 * 与 index.js 根路径逻辑一致，从 LANDING_DOMAINS 随机选一
 */

import { generateSubdomain, parseDomains, pickRandom } from './_shared/utils.js';

const DEFAULTS = { landingDomains: '' };

export async function onRequestGet(context) {
  const { env } = context;
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
