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

  return new Response(null, {
    status: 302,
    headers: {
      'Location': jumpUrl,
      'Cache-Control': 'no-store',
    },
  });
}
