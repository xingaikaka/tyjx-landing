/**
 * 腾讯云缓存刷新客户端(支持 CDN + EdgeOne 自动识别)
 *
 * 文档:
 *   - 老 CDN (cdn.tencentcloudapi.com / 服务 cdn)
 *     PurgeUrlsCache: https://cloud.tencent.com/document/api/228/41873
 *   - EdgeOne (teo.tencentcloudapi.com / 服务 teo)
 *     CreatePurgeTask: https://cloud.tencent.com/document/api/1552/80165
 *     DescribeZones:   https://cloud.tencent.com/document/api/1552/80713
 *
 * 鉴权:TC3-HMAC-SHA256(只用 node:crypto 实现,不依赖腾讯 SDK)
 *
 * 使用:
 *    import { purgeUrls } from './tencent-cdn.js';
 *    await purgeUrls(['https://tyjx.calculus.xin/tyjx/downloads/app.bin']);
 *
 * 自动识别:
 *   - TENCENT_PROVIDER=cdn  → 走老 CDN 的 PurgeUrlsCache
 *   - TENCENT_PROVIDER=teo  → 走 EdgeOne 的 CreatePurgeTask
 *   - 不显式配置:默认 'teo'(本项目 tyjx.calculus.xin 实际就是 EdgeOne)
 *
 * EdgeOne 需要 ZoneId,可显式 TENCENT_EDGEONE_ZONE_ID=<zone-id>;
 * 不填会自动调 DescribeZones 按 host 的 apex(例 calculus.xin) 查并缓存 1 小时。
 *
 * env:
 *    TENCENT_SECRET_ID
 *    TENCENT_SECRET_KEY
 *    TENCENT_PROVIDER          (cdn | teo,默认 teo)
 *    TENCENT_EDGEONE_ZONE_ID   (teo 模式下可选,不填自动发现)
 *    TENCENT_CDN_REGION        (cdn 模式下可不填;teo 模式建议留空)
 */

import crypto from 'node:crypto';
import logger from './logger.js';

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function hmacSha256(key, msg, enc) {
  return crypto.createHmac('sha256', key).update(msg).digest(enc);
}

/**
 * TC3-HMAC-SHA256 通用请求(适用于 cdn / teo / 其他腾讯云产品)
 *
 * @param {string} host    例 'cdn.tencentcloudapi.com' / 'teo.tencentcloudapi.com'
 * @param {string} service 例 'cdn' / 'teo'(必须与 host 对应,否则签名 fail)
 * @param {string} version 例 '2018-06-06' / '2022-09-01'
 * @param {string} action  例 'PurgeUrlsCache' / 'CreatePurgeTask'
 * @param {object} payload 请求 JSON
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] 默认 15000
 */
async function tencentRequest(host, service, version, action, payload, opts = {}) {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('TENCENT_SECRET_ID / TENCENT_SECRET_KEY not set');
  }

  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);

  const body = JSON.stringify(payload);
  const ct = 'application/json; charset=utf-8';

  // canonical request
  const canonicalHeaders =
    `content-type:${ct}\n` +
    `host:${host}\n` +
    `x-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join('\n');

  // string to sign
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(ts),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // signing key
  const kDate = hmacSha256(`TC3${secretKey}`, date);
  const kService = hmacSha256(kDate, service);
  const kSigning = hmacSha256(kService, 'tc3_request');
  const signature = hmacSha256(kSigning, stringToSign, 'hex');

  const authorization =
    `TC3-HMAC-SHA256 ` +
    `Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  let resp;
  try {
    resp = await fetch(`https://${host}/`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': ct,
        Host: host,
        Authorization: authorization,
        'X-TC-Action': action,
        'X-TC-Timestamp': String(ts),
        'X-TC-Version': version,
        ...(process.env.TENCENT_CDN_REGION
          ? { 'X-TC-Region': process.env.TENCENT_CDN_REGION }
          : {}),
      },
      body,
    });
  } finally {
    clearTimeout(t);
  }

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`tencent ${action} bad response: ${text.slice(0, 200)}`);
  }
  if (json?.Response?.Error) {
    const e = json.Response.Error;
    throw new Error(`${e.Code}: ${e.Message}`);
  }
  return json.Response || {};
}

/* ───── 老 CDN ───── */
function cdnRequest(action, payload) {
  return tencentRequest(
    'cdn.tencentcloudapi.com',
    'cdn',
    '2018-06-06',
    action,
    payload
  );
}

/* ───── EdgeOne ───── */
const TEO_HOST = 'teo.tencentcloudapi.com';
const TEO_SERVICE = 'teo';
const TEO_VERSION = '2022-09-01';

function teoRequest(action, payload) {
  return tencentRequest(TEO_HOST, TEO_SERVICE, TEO_VERSION, action, payload);
}

/**
 * 取 url host 对应的 apex(顶级注册域),例:
 *   'tyjx.calculus.xin' → 'calculus.xin'
 *   'a.b.c.example.com' → 'example.com'
 *   'example.com'       → 'example.com'
 *   'example.com.cn'    → 'example.com.cn'(简化未识别二级公共后缀,EdgeOne 站点一般 zone-name 就是 apex)
 */
function apexOf(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  // 简单识别二级后缀(.com.cn / .net.cn / .org.cn / .co.uk),不全但够用
  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  const ccTLD2 = new Set(['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'co.uk', 'co.jp']);
  return ccTLD2.has(last2) ? last3 : last2;
}

/* zoneId 缓存(按 zoneName) */
const _zoneCache = new Map(); // zoneName → { zoneId, expireAt }

async function resolveZoneIdForUrl(url) {
  // 1) 显式 env 优先
  const fromEnv = (process.env.TENCENT_EDGEONE_ZONE_ID || '').trim();
  if (fromEnv) return fromEnv;

  let zoneName;
  try {
    zoneName = apexOf(new URL(url).hostname);
  } catch {
    throw new Error('invalid url for zone lookup: ' + url);
  }

  // 2) 1h cache
  const cached = _zoneCache.get(zoneName);
  if (cached && cached.expireAt > Date.now()) return cached.zoneId;

  // 3) DescribeZones 按 zone-name 过滤
  const r = await teoRequest('DescribeZones', {
    Filters: [{ Name: 'zone-name', Values: [zoneName] }],
    Limit: 5,
  });
  const zones = r?.Zones || [];
  const hit = zones.find((z) => z.ZoneName === zoneName) || zones[0];
  if (!hit?.ZoneId) {
    throw new Error(
      `EdgeOne zone not found for "${zoneName}";` +
        ` 请到 EdgeOne 控制台确认站点已接入,或在 .env 显式指定 TENCENT_EDGEONE_ZONE_ID`
    );
  }
  _zoneCache.set(zoneName, {
    zoneId: hit.ZoneId,
    expireAt: Date.now() + 60 * 60 * 1000,
  });
  logger.info(`[cdn] resolved EdgeOne zone "${zoneName}" → ${hit.ZoneId}`);
  return hit.ZoneId;
}

/* ───── public ───── */

/**
 * 刷新若干 URL(按 TENCENT_PROVIDER 路由到 cdn / teo)
 *
 * 失败不抛错,改 logger.warn + 返回 { ok:false, msg } —— 上传流程不会被阻塞。
 *
 * @param {string|string[]} urls
 * @returns {Promise<{ok:boolean, taskId?:string, msg?:string, count?:number, provider?:string}>}
 */
export async function purgeUrls(urls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  if (list.length === 0) return { ok: false, msg: 'empty urls' };

  const provider = (process.env.TENCENT_PROVIDER || 'teo').toLowerCase();

  try {
    if (provider === 'cdn') {
      const r = await cdnRequest('PurgeUrlsCache', { Urls: list });
      logger.info(`[cdn] purge ok provider=cdn urls=${list.length} taskId=${r.TaskId || ''}`);
      return { ok: true, provider: 'cdn', taskId: r.TaskId, count: list.length };
    }

    // EdgeOne 路径
    const zoneId = await resolveZoneIdForUrl(list[0]);
    const r = await teoRequest('CreatePurgeTask', {
      ZoneId: zoneId,
      Type: 'purge_url',
      Targets: list,
    });
    logger.info(`[cdn] purge ok provider=teo zone=${zoneId} urls=${list.length} jobId=${r.JobId || ''}`);
    return { ok: true, provider: 'teo', taskId: r.JobId, count: list.length };
  } catch (e) {
    logger.warn(`[cdn] purge fail (${provider}): ${e.message}`);
    return { ok: false, provider, msg: e.message };
  }
}
