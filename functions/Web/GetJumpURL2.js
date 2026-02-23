/**
 * 获取跳转地址 API - POST /Web/GetJumpURL2
 */

import { encrypt, decrypt } from '../_shared/crypto.js';
import { generateSubdomain, parseDomains } from '../_shared/utils.js';

const DEFAULTS = {
  apiSecret: 'change-me-in-production-32bytes!!',
  jumpDomains: 'a1b2c3d4.cc,e5f6g7h8.cc',
};

function checkOrigin(request, allowedOrigins) {
  if (!allowedOrigins || !String(allowedOrigins).trim()) return true;
  const origin = request.headers.get('origin') || request.headers.get('referer') || '';
  return String(allowedOrigins).split(',').some((o) => o.trim() && origin.startsWith(o.trim()));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiSecret = env.API_SECRET || DEFAULTS.apiSecret;
  const jumpDomains = env.JUMP_DOMAINS || DEFAULTS.jumpDomains;
  const allowedOrigins = env.ALLOWED_ORIGINS || '';

  if (!checkOrigin(request, allowedOrigins)) {
    return new Response(JSON.stringify({ code: -1, msg: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.text();
    const decrypted = await decrypt(body, apiSecret);
    const params = JSON.parse(decrypted);
    const domains = parseDomains(jumpDomains);
    const urls = domains.map((base) => `https://${generateSubdomain()}.${base}`);

    const response = {
      code: 0,
      data: { jumpDomains: urls.join(','), domain: params.Domain || '' },
    };

    const encryptedResponse = await encrypt(JSON.stringify(response), apiSecret);
    return new Response(encryptedResponse, {
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ code: -1, msg: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ code: -1, msg: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return onRequestPost(context);
}
