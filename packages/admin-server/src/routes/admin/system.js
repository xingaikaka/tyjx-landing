/**
 * 系统级配置:目前仅一项 mediaCdnBase(媒体 CDN 域名)
 *
 *   GET  /api/admin/system            读当前配置 + 兜底 env(只读)
 *   PUT  /api/admin/system            写 mediaCdnBase
 *
 * 改这个值后:
 *   - 新上传文件直接用新 base 拼 URL
 *   - 历史 URL 在 /landing/config / /m3u8 等响应时被 host 重写
 *   - m3u8 内存缓存被清,确保下一次请求拿到新 ts 前缀
 */

import { Router } from 'express';
import { configRepo, auditRepo } from '../../lib/db.js';
import { invalidateM3u8Cache } from '../public.js';

const router = Router();

const HTTP_RE = /^https?:\/\//i;

function readEffective() {
  const sys = configRepo.get('system', {}) || {};
  return {
    mediaCdnBase: typeof sys.mediaCdnBase === 'string' ? sys.mediaCdnBase : '',
    envCdnBase: (process.env.CDN_BASE || '').trim(),
    envR2PublicBase: (process.env.R2_PUBLIC_BASE || '').trim(),
  };
}

router.get('/', (_req, res) => {
  res.json({ ok: true, data: readEffective() });
});

router.put('/', (req, res) => {
  let v = '';
  if (typeof req.body?.mediaCdnBase === 'string') {
    v = req.body.mediaCdnBase.trim().replace(/\/+$/, '');
  }
  if (v && !HTTP_RE.test(v)) {
    return res
      .status(400)
      .json({ ok: false, msg: 'mediaCdnBase 必须是 http(s):// 开头的完整 URL,或留空恢复 env 默认' });
  }
  // 单独验证 host 解析有效
  if (v) {
    try {
      const u = new URL(v);
      if (!u.host) throw new Error('no host');
    } catch {
      return res.status(400).json({ ok: false, msg: 'mediaCdnBase 不是合法 URL' });
    }
  }

  const old = configRepo.get('system', {}) || {};
  configRepo.set('system', { ...old, mediaCdnBase: v });
  invalidateM3u8Cache(); // m3u8 内的 ts URL 跟着配置变,清缓存
  auditRepo.log(req.user.id, 'system.update', { mediaCdnBase: v });

  res.json({ ok: true, data: readEffective() });
});

export default router;
