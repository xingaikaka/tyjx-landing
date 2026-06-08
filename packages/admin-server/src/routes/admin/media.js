import { Router } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';

import config from '../../lib/config.js';
import { mediaRepo, auditRepo } from '../../lib/db.js';
import {
  put as storagePut,
  del as storageDel,
  delPrefix as storageDelPrefix,
  getCurrentBackend,
  getBytes as storageGetBytes,
} from '../../lib/storage.js';
import { processMp4ToHls } from '../../lib/video-processor.js';
import { deleteKey as deleteVideoKey } from '../../lib/video-key-store.js';
import { invalidateM3u8Cache } from '../public.js';
import { getCdnBase, rewriteUrlsByCdnBase } from '../../lib/cdn-base.js';
import {
  encryptAsset,
  decryptAsset,
  getAssetKeyHex,
} from '../../lib/asset-crypto.js';
import { replaceUrlInAllConfigs } from '../../lib/config-rewriter.js';
import logger from '../../lib/logger.js';

const router = Router();

// 视频只接受 mp4 作为输入素材,服务器转码为加密 HLS;落地页只播 m3u8。
// 不再支持 webm 直传(老 webm 媒体仍可在列表里删除,但无法新建)。
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // favicon (.ico):浏览器要直链,所以**明文存储**(走 handleFavicon,不加密不压缩)
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'video/mp4',
]);

// 浏览器没设 mime(curl / 某些客户端)时按扩展名补上
const EXT_TO_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
};

// favicon 判定:.ico 用浏览器原生标签加载,不能加密,且 sharp 不支持 ico 输出格式
function isFaviconMime(m) {
  return m === 'image/x-icon' || m === 'image/vnd.microsoft.icon';
}

function inferMime(file) {
  const m = (file.mimetype || '').toLowerCase();
  if (ALLOWED_MIME.has(m)) return m;
  if (!m || m === 'application/octet-stream') {
    const ext = path.extname(file.originalname || '').toLowerCase();
    return EXT_TO_MIME[ext] || '';
  }
  return '';
}

// multer 默认按 latin1 读 multipart filename;实际多数浏览器/curl 用 utf8 字节流,
// 中文文件名(如 "4月23日.mp4")会被读成乱码 "4æ23æ¥.mp4"。在 fileFilter 里
// 统一 latin1→utf8 重新解码,后续日志、DB、R2 key 都拿到正确 utf8。
function decodeUtf8Filename(name) {
  if (!name) return name;
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    file.originalname = decodeUtf8Filename(file.originalname);
    const real = inferMime(file);
    if (real) {
      file.mimetype = real;
      return cb(null, true);
    }
    cb(new Error(`不支持的文件类型: ${file.mimetype || 'unknown'}`));
  },
});

router.get('/', (_req, res) => {
  // APK 由 /api/admin/apk 独立管理,不在 media 列表里出现
  const list = mediaRepo.list().filter((r) => r.kind !== 'apk');
  // host 切换为当前后台配置的 mediaCdnBase,DB 历史 URL 一并跟随
  res.json({ ok: true, data: rewriteUrlsByCdnBase(list) });
});

/**
 * GET /api/admin/media/raw?url=<encrypted url>
 *
 * 后台预览专用:服务端从 R2 拉密文 → AES-GCM 解密 → 流式返回明文。
 * 用法:admin-web 的 <EncryptedImage> 直接 fetch 这个端点拿到原始 png/jpg,
 *      不再依赖浏览器 Web Crypto(IP / HTTP 访问也能预览)。
 *
 * 安全:
 *   1. requireAuth 已在父路由挂上(必须 JWT)
 *   2. 入参必须是当前 cdnBase 或 r2PublicBase 下的 .enc URL,防 SSRF
 *   3. 解密失败直接 500,不会泄露密文
 *
 * 与 dp/tyjx-admin GET /api/admin/upload/image-raw/<id> 同一思路。
 */
router.get('/raw', async (req, res) => {
  try {
    const url = String(req.query.url || '');
    if (!url) return res.status(400).json({ ok: false, msg: '缺少 url 参数' });
    if (!/\.enc(\?|$|#)/i.test(url)) {
      return res.status(400).json({ ok: false, msg: 'url 不是 .enc 资源' });
    }

    // 白名单:只允许当前 cdnBase / r2PublicBase 下的资源(防 SSRF)
    const cdnBase = getCdnBase();
    const r2Pub = (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
    const allowed = [cdnBase, r2Pub].filter(Boolean);
    if (!allowed.some((b) => url.startsWith(b + '/'))) {
      return res.status(400).json({ ok: false, msg: 'url 不在允许的资源域内' });
    }

    // URL path 即 storage key(已含 KEY_PREFIX,如 'tyjx/uploads/abc.png.enc')
    const objectKey = new URL(url).pathname.replace(/^\/+/, '');
    const cipher = await storageGetBytes(objectKey);

    let plain;
    try {
      plain = decryptAsset(cipher);
    } catch (e) {
      logger.warn(`[media-raw] decrypt fail key=${objectKey}: ${e.message}`);
      return res.status(500).json({ ok: false, msg: '解密失败:' + e.message });
    }

    // 从 .ext.enc 推断原 mime
    const m = objectKey.match(/\.(png|jpe?g|webp|gif)\.enc$/i);
    const ext = (m?.[1] || 'jpg').toLowerCase();
    const mime =
      ext === 'png' ? 'image/png' :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif' ? 'image/gif' :
      'image/jpeg';

    res.set('Content-Type', mime);
    // 浏览器侧可缓存 5 分钟,后台改图片后用 CDN 域不同 / DB url 变化即天然失效
    res.set('Cache-Control', 'private, max-age=300');
    res.send(plain);
  } catch (e) {
    logger.error('[media-raw] error:', e);
    res.status(500).json({ ok: false, msg: e.message || '内部错误' });
  }
});

router.get('/_meta', (_req, res) => {
  // cdnBase 实际生效值(后台配置 > env CDN_BASE > env R2_PUBLIC_BASE)
  // r2PublicBase 是 R2 公网域硬值,仅供前端在 CDN 不可达时兜底显示
  // assetAesKey 给 admin 预览用于解密 .enc 图片
  const cdnBase = getCdnBase();
  const r2PublicBase = (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
  res.json({
    ok: true,
    data: {
      backend: getCurrentBackend(),
      cdnBase,
      r2PublicBase,
      assetAesKey: getAssetKeyHex(),
    },
  });
});

/**
 * POST /api/admin/media  multipart field: file
 *
 * mp4  → ffmpeg 转 AES-128 加密 HLS + 截 poster + storage.put 整套(kind='hls')
 * 图片 → sharp 压缩 + 直传(kind='file')
 *
 * 不再支持 webm / 其他视频格式直传:落地页统一只播 m3u8。
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, msg: '缺少 file 字段' });
    }

    const original = req.file.originalname || 'upload';
    const mime = req.file.mimetype;

    if (mime === 'video/mp4') {
      return await handleVideoMp4(req, res, original);
    }

    return await handleSimpleAsset(req, res, original);
  } catch (e) {
    logger.error('media upload error:', e);
    res.status(500).json({ ok: false, msg: e.message || '上传失败' });
  }
});

/**
 * 按 row 彻底删除一条 media:
 *   - HLS  → storage prefix 全删 + poster 单删 + 本地 raw key 删 + m3u8 cache 失效
 *   - 其他 → 单文件删
 *   - DB row 删
 *
 * 调用方负责审计。失败不抛(尽力清理),DB 行总会删。
 */
async function purgeMediaRow(row) {
  if (!row) return;
  const backend = row.backend || 'local';
  try {
    if (row.kind === 'hls' && row.storage_prefix) {
      await storageDelPrefix(row.storage_prefix);
      if (row.poster_key) {
        await storageDel(row.poster_key, backend);
      }
      const m = /([0-9a-f]{30,40})\/?$/.exec(row.storage_prefix.replace(/\/$/, ''));
      if (m) {
        await deleteVideoKey(m[1]).catch(() => {});
        invalidateM3u8Cache(m[1]);
      }
    } else if (row.storage_key) {
      await storageDel(row.storage_key, backend);
    }
  } catch (e) {
    logger.warn('storage del fail:', e.message);
  }
  mediaRepo.remove(row.id);
}

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ ok: false, msg: '无效 id' });
  }
  const row = mediaRepo.findById(id);
  if (!row) return res.status(404).json({ ok: false, msg: '不存在' });

  await purgeMediaRow(row);
  auditRepo.log(req.user.id, 'media.delete', {
    id,
    backend: row.backend,
    kind: row.kind,
  });
  res.json({ ok: true });
});

/**
 * "上传同名文件覆盖" 语义:
 * 接收新上传前,把 DB 里所有 (filename, kind) 相同的旧记录连物理文件一起清掉。
 * 这样媒体库里同一份 logo / 同一支视频不会越堆越多;落地页配置里的旧 url 自动指向最新版。
 *
 * 关键:**返回所有被清理的旧 URL**(含 url + poster_url),
 * 上传成功后调用方需要用 replaceUrlInAllConfigs(oldUrls, newUrl) 同步配置引用,
 * 否则 config 里残留的旧 URL 会在刷新后 404(老 R2 对象已被物理删除)。
 *
 * 注意:用户复用 picker 选择已有 url 时不走这里(直接选 m.url 不上传),老记录不会被误清。
 *
 * @returns {Promise<string[]>}  被清理的所有 R2 URL(用于 config 引用同步)
 */
async function purgeOldByFilename(req, filename, kind) {
  const dupes = mediaRepo.findByFilenameKind(filename, kind);
  const oldUrls = [];
  for (const old of dupes) {
    if (old.url) oldUrls.push(old.url);
    if (old.poster_url) oldUrls.push(old.poster_url);
    logger.info(
      `[media] overwrite: purge old id=${old.id} filename=${old.filename} kind=${old.kind}`
    );
    await purgeMediaRow(old);
    auditRepo.log(req.user.id, 'media.overwrite', {
      id: old.id,
      filename,
      kind,
    });
  }
  return oldUrls;
}

/* ──────────────── handlers ──────────────── */

async function handleSimpleAsset(req, res, original) {
  let buffer = req.file.buffer;
  let mime = req.file.mimetype;
  const ext = (path.extname(original).toLowerCase() || '.bin');

  // favicon 跳过 sharp(ico 是多分辨率合体格式,sharp 输出不支持) + 跳过加密
  // 因为浏览器通过 <link rel="icon" href> 直链加载,不能解密。
  const isFavicon = isFaviconMime(mime);

  // ?plain=1 强制明文(用于 portalUI.logo 等 Worker 直接 <img src> 渲染的资产):
  //   浏览器收到 .enc 二进制无法识别图片格式,所以这类图必须明文。
  //   走 sharp 压缩,但**不加密 + URL 不带 .enc**,跟 favicon 同等待遇。
  const forcePlain = req.query?.plain === '1' || req.query?.plain === 'true';

  if (!isFavicon && mime.startsWith('image/') && mime !== 'image/gif') {
    try {
      const baseBuf = await sharp(buffer)
        .rotate()
        .resize({
          width: 2560,
          height: 2560,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();

      if (ext === '.png') {
        buffer = await sharp(baseBuf).png({ compressionLevel: 9 }).toBuffer();
        mime = 'image/png';
      } else if (ext === '.webp') {
        buffer = await sharp(baseBuf).webp({ quality: 85 }).toBuffer();
        mime = 'image/webp';
      } else {
        buffer = await sharp(baseBuf).jpeg({ quality: 85 }).toBuffer();
        mime = 'image/jpeg';
      }
    } catch (e) {
      logger.warn('sharp process skipped:', e.message);
    }
  }

  const finalExt =
    isFavicon              ? '.ico' :
    mime === 'image/jpeg'  ? '.jpg' :
    mime === 'image/png'   ? '.png' :
    mime === 'image/webp'  ? '.webp' :
    mime === 'image/gif'   ? '.gif' :
    ext;

  // 同名旧文件先清(R2/local 物理 + DB 行 + 审计 overwrite)
  // 拿到旧 URL 列表,稍后上传成功后用来同步 config 引用,避免引用残留 → R2 404
  const purgedUrls = await purgeOldByFilename(req, original, 'file');

  // ─── 图片走加密路径 ───
  // 普通图片在写入 R2 前用 ASSET_AES_KEY 做 AES-256-GCM,
  // R2 上看到的就是 [IV(12) | tag(16) | ciphertext] 二进制密文。
  // 落地页 / admin 拉密文用 Web Crypto 解密成 Blob URL 显示。
  // **favicon 例外**:浏览器原生 <link rel="icon"> 不能解密,只能明文。
  const shouldEncrypt = mime.startsWith('image/') && !isFavicon && !forcePlain;
  // forcePlain && 非 favicon 时走 ".js 伪装":
  //   R2 落地后缀 = <原后缀>.js,Content-Type = application/javascript。
  //   浏览器靠 magic bytes sniffing 能正常渲染(不看 URL 后缀也不严格验 mime),
  //   按扩展名扫站的第三方爬虫 / 机审会跳过。favicon 不参与(浏览器 <link rel=icon> 必须正常 mime)。
  const shouldDisguiseAsJs = forcePlain && mime.startsWith('image/') && !isFavicon;
  const plainSize = buffer.length;
  let uploadBuf = buffer;
  let uploadMime = mime;
  let storeExt = finalExt;
  if (shouldEncrypt) {
    uploadBuf = encryptAsset(buffer);
    uploadMime = 'application/octet-stream';
    storeExt = finalExt + '.enc';
  } else if (shouldDisguiseAsJs) {
    // URL 后缀 .js(反爬虫按扩展名扫站漏掉)
    // 但 Content-Type 仍用真实图片 mime —— 兼容严格的移动浏览器/WebView
    // (有些不做 magic-byte sniffing,Content-Type 不是 image/* 就拒绝渲染 <img>)
    storeExt = finalExt + '.js';
  }

  const relKey = `uploads/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${storeExt}`;
  const { key: storageKey, url, backend } = await storagePut(relKey, uploadBuf, uploadMime);

  const id = mediaRepo.create({
    filename: original,
    storage_key: storageKey,
    url,
    // mime 字段存"原始"类型(image/png 等),便于前端 EncryptedImage 拿到后还原
    mime,
    size: plainSize,
    backend,
    kind: 'file',
  });

  // 把 config 表里所有引用了"被覆盖删除的旧 URL"的字段切到新 URL
  // 这样 LandingPage / PortalUIPage 里的 logo / poster 等字段无须用户手动重选
  if (purgedUrls.length) {
    replaceUrlInAllConfigs(purgedUrls, url);
  }

  auditRepo.log(req.user.id, 'media.upload', { id, key: storageKey, backend });
  res.json({
    ok: true,
    data: {
      id,
      url,
      filename: original,
      size: buffer.length,
      mime,
      backend,
      kind: 'file',
    },
  });
}

async function handleVideoMp4(req, res, original) {
  logger.info(`[media] mp4 → HLS start: ${original} (${req.file.size} bytes)`);

  // 同名旧视频先清(R2 整 prefix + 本地 raw key + m3u8 cache + DB 行)
  // 注意:覆盖在转码 *之前*,转码失败的话 DB 已经没了旧记录,用户得重传 — 接受这个 trade-off。
  const purgedUrls = await purgeOldByFilename(req, original, 'hls');

  const result = await processMp4ToHls(req.file.buffer);

  // m3u8 mime: application/vnd.apple.mpegurl
  const id = mediaRepo.create({
    filename: original,
    storage_key: `${result.prefix}index.m3u8`,
    url: result.playbackUrl,
    mime: 'application/vnd.apple.mpegurl',
    size: req.file.size,
    backend: result.backend,
    poster_url: result.posterUrl || null,
    poster_key: result.posterKey || null,
    duration: result.duration,
    storage_prefix: result.prefix,
    kind: 'hls',
  });

  // 同步 config 引用:旧视频 m3u8 / poster 在 config 里的引用切到新 URL
  // (旧 m3u8 → result.playbackUrl;旧 poster → result.posterUrl)
  //
  // 重要:先分类再分别替换,不能先无脑全替换成 playbackUrl —— 否则旧 poster URL
  // 在第一步就被改成 m3u8 URL,第二步再去找旧 poster 来替换 posterUrl 时已经找不到。
  if (purgedUrls.length) {
    const isPosterUrl = (u) =>
      /\.(jpe?g|png|webp)\.enc(\?|$|#)/i.test(u) || /\/poster-/i.test(u);
    const oldPosters = purgedUrls.filter(isPosterUrl);
    const oldVideos = purgedUrls.filter((u) => !isPosterUrl(u));

    if (oldVideos.length) {
      replaceUrlInAllConfigs(oldVideos, result.playbackUrl);
    }
    if (oldPosters.length && result.posterUrl) {
      replaceUrlInAllConfigs(oldPosters, result.posterUrl);
    }
  }

  auditRepo.log(req.user.id, 'media.upload.video', {
    id,
    prefix: result.prefix,
    duration: result.duration,
    segs: result.segmentCount,
  });

  res.json({
    ok: true,
    data: {
      id,
      url: result.playbackUrl,
      posterUrl: result.posterUrl,
      filename: original,
      size: req.file.size,
      mime: 'application/vnd.apple.mpegurl',
      backend: result.backend,
      duration: result.duration,
      segmentCount: result.segmentCount,
      kind: 'hls',
    },
  });
}

export default router;
