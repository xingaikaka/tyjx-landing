/**
 * 公开下载短链:/d/:slug.bin → 302 到该 slug 当前最新一份 apk(R2/CDN URL)
 *
 * 设计要点:
 *   - 用户/openinstall 等第三方平台只需贴一次这个稳定 URL
 *     (例:https://admin-route.tyjx7k2m9pqs4.cc/d/app.bin)
 *   - 上传新版本后,短链自动指向最新 R2 对象;旧版本 R2 文件保留(可回滚)
 *   - 浏览器收到 302 后跟到真实 R2 URL,Content-Disposition 已在 R2 元数据上
 *     设好 attachment; filename="xxx.apk",自动按 .apk 落地保存
 *   - .bin 后缀仅作为 URL 形态对齐 R2 命名规则(避免基于扩展名的特征匹配),
 *     不强制要求与 R2 key 一致
 *
 * 同时挂在 /api/d/:slug.bin(走现有 nginx /api/ 代理,不必改 nginx)
 * 和 /d/:slug.bin(更短,需要 nginx 单独加 location /d/ 转到 admin-server)
 */

import { Router } from 'express';
import { mediaRepo } from '../lib/db.js';
import { rewriteUrlByCdnBase } from '../lib/cdn-base.js';
import logger from '../lib/logger.js';

const router = Router();

/** 给 :slug 校验,只接受 [a-z0-9_-]{1,32};.bin 后缀可有可无,最多接受 .apk/.ipa */
function parseSlugParam(raw) {
  const m = String(raw || '').match(/^([a-z0-9_-]{1,32})(?:\.bin|\.apk|\.ipa)?$/i);
  if (!m) return null;
  return m[1].toLowerCase();
}

router.get('/:slug', (req, res) => {
  const slug = parseSlugParam(req.params.slug);
  if (!slug) {
    return res.status(400).type('text/plain').send('Bad slug');
  }

  // 目前只支持 apk;以后扩展 ipa 时,可以根据 Accept-Encoding/UA 或额外参数分流。
  const row = mediaRepo.findLatestBySlugKind(slug, 'apk');
  if (!row) {
    return res.status(404).type('text/plain').send('Not Found');
  }

  // R2 存的是绝对 URL(已含 R2_PUBLIC_BASE),走 rewriteUrlByCdnBase 替换为 CDN_BASE
  const target = rewriteUrlByCdnBase(row.url);

  // 下载链最重要的是"指向哪个文件",CDN 缓存 302 没意义,反而会卡住版本切换。
  // 所以这里强制 no-store + 短 redirect cache header,让客户端总是问一次 admin。
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // 透传 Content-Disposition 给客户端,即使他们不跟 302 也能拿到正确文件名提示
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${row.filename || 'app.apk'}"`
  );

  logger.info(`[download] slug=${slug} → id=${row.id} target=${target}`);
  return res.redirect(302, target);
});

export default router;
