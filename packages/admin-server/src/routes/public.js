/**
 * 公开 API:供 relay-server / luodiye_video 拉取,无需登录。
 *
 *  GET /api/portal/runtime              → AES 加密的 { domains, portalUI }      (relay-server 拉)
 *  GET /api/portal/landing/config       → 明文的 landing 配置                    (落地页拉)
 *  GET /api/portal/m3u8/:id             → 改写过 KEY URI 的真 m3u8              (落地页 hls.js 拉)
 *  GET /api/portal/video-key-raw/:id    → 16 字节 AES-128 raw key(二进制)      (hls.js 拉)
 *
 * 安全模型(完全对齐 dp/tyjx-admin):
 *   - 上传到 R2/CDN 的 m3u8 内 #EXT-X-KEY URI 是假地址 https://key.noaccess.invalid/...
 *     → 即便 m3u8 被偷,CDN 拿不到真 key,无法解密 ts
 *   - 真 raw key 只在 admin 本地 video-keys/<id>.enckey,AES-256-CBC 加密落盘
 *   - 客户端通过本接口拿真 m3u8(改写后的 KEY URI 指向 video-key-raw)
 *   - hls.js 默认 keyloader 拉 video-key-raw → 拿到 16B raw → 解密 ts
 */

import { Router } from 'express';
import { configRepo } from '../lib/db.js';
import { encrypt } from '../lib/crypto.js';
import { getText as storageGetText } from '../lib/storage.js';
import { loadKey as loadVideoKey } from '../lib/video-key-store.js';
import { FAKE_KEY_HOST } from '../lib/video-processor.js';
import { getCdnBase, rewriteUrlsByCdnBase } from '../lib/cdn-base.js';
import { getAssetKeyHex } from '../lib/asset-crypto.js';
import { encryptApiResponse } from '../lib/api-crypto.js';
import config from '../lib/config.js';
import logger from '../lib/logger.js';

const router = Router();

/**
 * GET /api/portal/runtime
 * relay-server 拉:返回加密包。响应体是纯文本(AES "iv:cipher" 格式)。
 *
 * 仅返回 relay-server 需要的字段(domains + portalUI),landing 不放这里(那是 luodiye_video 的事)。
 */
router.get('/runtime', (req, res) => {
  const domains = configRepo.get('domains', {});
  const portalUI = configRepo.get('portalUI', {});
  const payload = JSON.stringify({
    ts: Math.floor(Date.now() / 1000),
    domains,
    portalUI: rewriteUrlsByCdnBase(portalUI),
  });
  const cipher = encrypt(payload, config.portalApiSecret);
  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  });
  res.send(cipher);
});

/**
 * GET /api/portal/landing/config
 * luodiye_video 落地页拉。
 *
 * 响应整体走 AES-256-CBC 加密(对齐 dp/tyjx-landing-page apiDecrypt.ts):
 *   body = { "e": "<base64(iv(16) || ciphertext)>" }
 *
 * 客户端解密后得到原始的 { ok:true, data:{...} },等价于明文版。
 * 加密只起反爬/反逆向门槛作用,key 在客户端 bundle 里可见,不是真敏感保护。
 *
 * URL 字段(logo / backgroundVideo / backgroundVideoPoster)的 host 会被替换
 * 为后台配置的 mediaCdnBase(若没配则用入库时的原 host),实现"后台一改全切"。
 */
router.get('/landing/config', (req, res) => {
  const landing = configRepo.get('landing', {});
  const payload = {
    ok: true,
    data: {
      ...rewriteUrlsByCdnBase(landing),
      // 给落地页用于解密 .enc 图片(AES-256-GCM key,64 hex)
      assetAesKey: getAssetKeyHex(),
    },
  };
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=10',
    // 落地页可能来自任意 *.tyjxxxx.cc 域,简单起见全开
    'Access-Control-Allow-Origin': '*',
  });
  res.json(encryptApiResponse(payload));
});

/* ─────────── HLS 加密视频:m3u8 代理 + key 分发 ─────────── */

const VIDEO_ID_RE = /^[0-9a-f]{30,40}$/i;

/**
 * GET /api/portal/video-key-raw/:id
 * 返回 16 字节 AES-128 raw key(application/octet-stream)。
 * hls.js 默认 keyloader 期待的就是裸二进制。
 *
 * 缓存策略:no-store(每次都重新解密本地 enckey,确保密钥即时撤销有效)
 *   + ACAO * (落地页可能在 *.tyjx7k2m9pqs4.cc 等多个域,简单起见全开)
 */
router.get('/video-key-raw/:id', async (req, res) => {
  const id = req.params.id;
  if (!id || !VIDEO_ID_RE.test(id)) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  try {
    const buf = await loadVideoKey(id);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store, no-cache, private',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buf);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      logger.warn('[video-key] load fail', id, e.message);
    }
    res.status(404).type('text/plain').send('Not Found');
  }
});

/**
 * GET /api/portal/m3u8/:id
 * 拉 R2 上的原 m3u8,把 KEY URI 从假地址改写成**同源绝对 URL**(基于当前请求 host),
 * 把相对 ts 路径改写为绝对 CDN 路径(让 hls.js / 原生 HLS 直连 CDN,不走 admin 中转占带宽)。
 *
 * 与 dp/tyjx-admin 完全对齐:
 *   - 改写 FAKE_KEY URI → ${myOrigin}/api/portal/video-key-raw/:vid
 *   - 落地页可能挂在 *.tyjxlh2wyxr9.cc 等任意 host,用请求 host 而不是写死,多落地域都能正常
 *   - 绝对 URL 比相对路径在 iOS Safari 原生 HLS / 国产 WebView 兼容更稳
 *     (相对路径在原生 HLS 偶发被解析成相对页面 URL 而不是相对 m3u8 URL)
 *
 * 缓存:5 分钟内存。**cacheKey 包含 host**,因为不同 host 写出的 m3u8 内容不同。
 */
const M3U8_CACHE = new Map(); // `${id}|${origin}` → { text, expireAt }
const M3U8_CACHE_TTL_MS = 5 * 60 * 1000;

router.get('/m3u8/:id', async (req, res) => {
  const id = req.params.id;
  if (!id || !VIDEO_ID_RE.test(id)) {
    return res.status(404).type('text/plain').send('Not Found');
  }

  // 当前请求的 origin(用于改写 m3u8 内的 key URL)
  // ⚠️ admin 在 nginx 后面: 用户 https → cdn666 → 源站 nginx (http 回源) → admin
  //    单看 req.protocol/connection.encrypted 是 'http',要看 X-Forwarded-Proto。
  //    nginx 配置已 set proxy_set_header X-Forwarded-Proto $scheme;
  const proto =
    req.headers['x-forwarded-proto'] ||
    req.headers['x-forwarded-protocol'] ||
    (req.secure ? 'https' : 'http');
  const host = req.headers.host;
  const myOrigin = `${proto}://${host}`;

  const cacheKey = `${id}|${myOrigin}`;
  const now = Date.now();
  const cached = M3U8_CACHE.get(cacheKey);
  if (cached && cached.expireAt > now) {
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      'X-Proxy-Cache': 'HIT',
    });
    return res.send(cached.text);
  }

  try {
    const original = await storageGetText(`video-assets/${id}/index.m3u8`);

    const fakeRe = new RegExp(
      `URI="${FAKE_KEY_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/video-key/([0-9a-f]+)"`,
      'g'
    );

    // ts 路径改写为 CDN 绝对 URL(让浏览器直连 CDN)
    const tsBase = pickTsBase(id);

    let text = original
      .replace(fakeRe, (_, vid) => `URI="${myOrigin}/api/portal/video-key-raw/${vid}"`)
      .replace(/^(?!#)([^\r\n]+\.ts)\s*$/mg, (_, ts) =>
        ts.startsWith('http') ? ts : `${tsBase}${ts}`
      );

    M3U8_CACHE.set(cacheKey, { text, expireAt: now + M3U8_CACHE_TTL_MS });

    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      'X-Proxy-Cache': 'MISS',
    });
    res.send(text);
  } catch (e) {
    logger.warn('[m3u8 proxy] fail', id, e.message);
    res.status(404).type('text/plain').send('Source Not Found');
  }
});

/** 删除视频时调用,清缓存(否则改写后的 m3u8 还会存活 5min) */
export function invalidateM3u8Cache(id) {
  if (id) M3U8_CACHE.delete(id);
  else M3U8_CACHE.clear();
}

function pickTsBase(id) {
  const cdn = getCdnBase();
  const keyPrefix = (process.env.STORAGE_KEY_PREFIX || '').replace(/^\/+|\/+$/g, '');
  if (cdn) {
    return keyPrefix
      ? `${cdn}/${keyPrefix}/video-assets/${id}/`
      : `${cdn}/video-assets/${id}/`;
  }
  // local 兜底
  const pub = (config.publicUrl || '').replace(/\/+$/, '');
  return keyPrefix
    ? `${pub}/uploads/${keyPrefix}/video-assets/${id}/`
    : `${pub}/uploads/video-assets/${id}/`;
}

export default router;
