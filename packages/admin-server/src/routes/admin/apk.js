/**
 * APK 安装包管理(参考 dp/tyjx-admin 的 saveApk)
 *
 * 设计(固定地址 + CDN 主动刷新方案):
 *   - 同一个 slug 的 R2 对象 key 永远固定 = 'downloads/<slug>.bin'
 *     新版本上传 = R2 同 key PUT(自动覆盖),URL 永不变
 *   - 通过 Content-Disposition: attachment; filename="xxx.apk"
 *     让浏览器仍按 xxx.apk 保存
 *   - 上传成功后调用腾讯云 CDN PurgeUrlsCache 刷新 CDN 缓存,
 *     用户下次下载就是新版本(异步任务,1~5 分钟全网生效)
 *   - 浏览器侧用短缓存 max-age=300 + must-revalidate,
 *     不依赖 immutable,避免老用户卡在旧版本
 *   - 落地页 Android 按钮直接 <a href download> 这个固定 URL,
 *     OpenInstall 等三方平台也填这个固定 URL
 *
 * 接口:
 *   POST   /api/admin/apk      multipart file
 *   GET    /api/admin/apk      列表(从 media 表 kind='apk' 筛)
 *   POST   /api/admin/apk/:id/purge  手动刷新 CDN
 *   DELETE /api/admin/apk/:id
 */

import express, { Router } from 'express';
import path from 'node:path';
import multer from 'multer';

import { mediaRepo, auditRepo } from '../../lib/db.js';
import {
  put as storagePut,
  del as storageDel,
  getCurrentBackend,
} from '../../lib/storage.js';
import { rewriteUrlsByCdnBase, rewriteUrlByCdnBase } from '../../lib/cdn-base.js';
import { purgeUrls } from '../../lib/tencent-cdn.js';
import logger from '../../lib/logger.js';

const router = Router();

const APK_MAX_BYTES =
  Number(process.env.MAX_APK_MB || 500) * 1024 * 1024; // 默认 500MB

// 与 media.js 同样的 latin1→utf8 重解码,处理中文 APK 文件名乱码
function decodeUtf8Filename(name) {
  if (!name) return name;
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

/**
 * 把任意输入(用户输入或 filename 派生)规范成可作为 URL 路径段的 slug。
 * 限制 ASCII 字母数字 _ -,长度 1~32,小写。空/非法 → 'tianya'。
 */
function sanitizeSlug(s) {
  const cleaned = String(s || '')
    .toLowerCase()
    .replace(/\.apk$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return cleaned || 'tianya';
}

/**
 * R2 对象 key(绝对路径,不加 STORAGE_KEY_PREFIX)
 *
 * 设计:与 dp/tyjx-admin 后台共享同一个 R2 对象,两个落地页 APK 永远是同一份。
 * 这样可以用一个 shell 脚本 PUT 一次 + EdgeOne purge 两个 CDN URL 完成发版。
 */
function r2KeyForSlug(slug) {
  return `downloads/${slug}.bin`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: APK_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    file.originalname = decodeUtf8Filename(file.originalname);
    const name = (file.originalname || '').toLowerCase();
    const okMime =
      file.mimetype === 'application/vnd.android.package-archive' ||
      file.mimetype === 'application/octet-stream' ||
      file.mimetype === ''; // 某些客户端不带
    const okExt = name.endsWith('.apk');
    if (okExt && (okMime || file.mimetype.startsWith('application/'))) {
      file.mimetype = 'application/vnd.android.package-archive';
      return cb(null, true);
    }
    cb(new Error('只支持 .apk 文件'));
  },
});

router.get('/', (_req, res) => {
  const list = mediaRepo
    .list()
    .filter((r) => r.kind === 'apk')
    .map((r) => {
      // 固定地址 = 当前生效 CDN base 重写后的 r.url
      const stable = rewriteUrlByCdnBase(r.url);
      return {
        id: r.id,
        filename: r.filename,
        url: stable,
        size: r.size,
        backend: r.backend,
        slug: r.slug || null,
        // shortLink 与 url 一致(不再走 admin 302 短链,直接 CDN 直链)
        shortLink: stable,
        created_at: r.created_at,
      };
    });
  res.json({ ok: true, data: list });
});

router.get('/_meta', (_req, res) => {
  res.json({
    ok: true,
    data: {
      backend: getCurrentBackend(),
      maxMB: APK_MAX_BYTES / 1024 / 1024,
    },
  });
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, msg: '缺少 file 字段' });
    }

    const original = req.file.originalname || 'app.apk';
    const safeName =
      path
        .basename(original)
        .replace(/[\\/]/g, '_')
        .replace(/[^\w.\-]/g, '_')
        .replace(/\.apk$/i, '') + '.apk';

    // slug:用户没填则按文件名派生;同 slug 多次上传 = 新版本,R2 同 key 自动覆盖
    const slug = sanitizeSlug(req.body?.slug || safeName);
    const relKey = r2KeyForSlug(slug); // downloads/<slug>.bin

    // 上传到 R2(同 slug = 同 key,直接覆盖)
    // absoluteKey:跳过 STORAGE_KEY_PREFIX,与 dp/tyjx-admin 共享 R2 对象
    const { key: storageKey, url, backend } = await storagePut(
      relKey,
      req.file.buffer,
      'application/vnd.android.package-archive',
      {
        absoluteKey: true,
        contentDisposition:
          /^[\w.\-]+$/.test(safeName)
            ? `attachment; filename="${safeName}"`
            : `attachment; filename="${encodeURIComponent(
                safeName
              )}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        // 固定地址方案的关键 cache 策略:
        //   max-age=0      → 浏览器每次必查 CDN(协商缓存,304 仍很轻量)
        //   s-maxage=300   → CDN 边缘节点缓存 5 分钟(降回源压力)
        //   must-revalidate → 过期后必须 revalidate,不允许给陈旧响应
        cacheControl: 'public, max-age=0, s-maxage=300, must-revalidate',
      }
    );

    // 同 slug 旧记录全部清掉(R2 同 key 已覆盖,不需要再 storageDel,只清 DB)
    const oldRows = mediaRepo
      .list()
      .filter((r) => r.kind === 'apk' && r.slug === slug);
    for (const old of oldRows) {
      mediaRepo.remove(old.id);
      auditRepo.log(req.user.id, 'apk.overwrite', {
        id: old.id,
        slug,
        oldKey: old.storage_key,
      });
    }

    const id = mediaRepo.create({
      filename: safeName,
      storage_key: storageKey,
      url,
      mime: 'application/vnd.android.package-archive',
      size: req.file.size,
      backend,
      kind: 'apk',
      slug,
    });

    // 调腾讯云 CDN 主动刷新(失败不影响上传,只 warn)
    const stableUrl = rewriteUrlByCdnBase(url);
    let purgeResult = { ok: false, msg: 'skipped' };
    if (stableUrl && /^https?:\/\//i.test(stableUrl)) {
      purgeResult = await purgeUrls([stableUrl]);
    }

    auditRepo.log(req.user.id, 'apk.upload', {
      id,
      key: storageKey,
      slug,
      backend,
      size: req.file.size,
      purge: purgeResult,
    });

    logger.info(
      `[apk] uploaded id=${id} slug=${slug} key=${storageKey} size=${req.file.size} ` +
        `backend=${backend} purge=${purgeResult.ok ? 'ok' : 'skip/fail'}`
    );

    res.json({
      ok: true,
      data: {
        id,
        url: stableUrl,
        filename: safeName,
        size: req.file.size,
        backend,
        kind: 'apk',
        slug,
        shortLink: stableUrl, // 与 url 同值,字段保留以兼容前端
        purge: purgeResult,
      },
    });
  } catch (e) {
    logger.error('[apk] upload error:', e);
    res.status(500).json({ ok: false, msg: e.message || '上传失败' });
  }
});

/* POST /:id/purge  → 手动触发腾讯云 CDN 刷新 */
router.post('/:id/purge', express.json(), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ ok: false, msg: '无效 id' });
  }
  const row = mediaRepo.findById(id);
  if (!row || row.kind !== 'apk') {
    return res.status(404).json({ ok: false, msg: '不存在' });
  }
  const stableUrl = rewriteUrlByCdnBase(row.url);
  if (!stableUrl || !/^https?:\/\//i.test(stableUrl)) {
    return res.status(400).json({ ok: false, msg: 'URL 无效,无法 purge' });
  }
  const r = await purgeUrls([stableUrl]);
  auditRepo.log(req.user.id, 'apk.purge', { id, url: stableUrl, result: r });
  return res.json({ ok: r.ok, data: { url: stableUrl, ...r } });
});

/**
 * PATCH /:id  → 修改 slug(下载固定地址里的 slug 段)
 *
 * 由于固定地址方案下 R2 key 由 slug 决定(downloads/<slug>.bin),改 slug
 * 必须把对象在 R2 内复制到新 key、删旧 key、再 purge 旧 URL。
 * 当前未实现该 R2 移动逻辑,下游若已对外公布旧地址,改名会导致旧地址失效。
 *
 * 这里只做最简单的"DB 改名 + 提示用户重新上传"。如确实需要改名,
 * 推荐:用新 slug 重新上传一次 → 拿到新固定地址 → 旧 slug 自然废弃。
 */
router.patch('/:id', express.json(), async (req, res) => {
  return res.status(400).json({
    ok: false,
    msg: '固定地址模式下不支持改 slug,请用新 slug 重新上传一次',
  });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ ok: false, msg: '无效 id' });
  }
  const row = mediaRepo.findById(id);
  if (!row || row.kind !== 'apk') {
    return res.status(404).json({ ok: false, msg: '不存在' });
  }

  try {
    await storageDel(row.storage_key, row.backend || 'local');
  } catch (e) {
    logger.warn('[apk] storage del fail:', e.message);
  }

  mediaRepo.remove(id);
  auditRepo.log(req.user.id, 'apk.delete', { id, backend: row.backend });
  res.json({ ok: true });
});

export default router;
