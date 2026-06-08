import { Router } from 'express';
import { configRepo, auditRepo } from '../../lib/db.js';
import { validateDomains } from '../../lib/validators.js';

const router = Router();

/**
 * GET  /api/admin/domains
 * PUT  /api/admin/domains  body: 完整 domains 对象
 */
router.get('/', (req, res) => {
  const data = configRepo.get('domains', {});
  res.json({ ok: true, data });
});

router.put('/', (req, res) => {
  const v = validateDomains(req.body);
  if (!v.ok) {
    return res.status(400).json({ ok: false, msg: '校验失败', errors: v.errors });
  }
  configRepo.set('domains', v.data);
  auditRepo.log(req.user.id, 'domains.update', { entryCount: v.data.entryPages.length });
  res.json({ ok: true, data: v.data });
});

export default router;
