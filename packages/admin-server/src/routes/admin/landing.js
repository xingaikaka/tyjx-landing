import { Router } from 'express';
import { configRepo, auditRepo } from '../../lib/db.js';
import { validateLanding } from '../../lib/validators.js';
import { rewriteUrlsByCdnBase } from '../../lib/cdn-base.js';

const router = Router();

/**
 * GET  /api/admin/landing
 * PUT  /api/admin/landing
 *
 * GET 时把所有 URL host 切到当前 mediaCdnBase,这样后台预览/保存 URL
 * 自然跟随系统配置的 CDN 域,DB 历史数据无需迁移。
 */
router.get('/', (req, res) => {
  const data = configRepo.get('landing', {});
  res.json({ ok: true, data: rewriteUrlsByCdnBase(data) });
});

router.put('/', (req, res) => {
  const v = validateLanding(req.body);
  if (!v.ok) {
    return res.status(400).json({ ok: false, msg: '校验失败', errors: v.errors });
  }
  configRepo.set('landing', v.data);
  auditRepo.log(req.user.id, 'landing.update', null);
  res.json({ ok: true, data: v.data });
});

export default router;
