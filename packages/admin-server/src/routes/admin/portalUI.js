import { Router } from 'express';
import { configRepo, auditRepo } from '../../lib/db.js';
import { validatePortalUI } from '../../lib/validators.js';
import { rewriteUrlsByCdnBase } from '../../lib/cdn-base.js';

const router = Router();

/**
 * GET  /api/admin/portalUI
 * PUT  /api/admin/portalUI
 */
router.get('/', (req, res) => {
  const data = configRepo.get('portalUI', {});
  res.json({ ok: true, data: rewriteUrlsByCdnBase(data) });
});

router.put('/', (req, res) => {
  const v = validatePortalUI(req.body);
  if (!v.ok) {
    return res.status(400).json({ ok: false, msg: '校验失败', errors: v.errors });
  }
  configRepo.set('portalUI', v.data);
  auditRepo.log(req.user.id, 'portalUI.update', null);
  res.json({ ok: true, data: v.data });
});

export default router;
