import { Router } from 'express';
import { userRepo, auditRepo } from '../../lib/db.js';
import { verifyPassword, signToken, requireAuth, hashPassword } from '../../lib/auth.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * POST /api/admin/login
 * body: { username, password }
 * resp: { ok: true, token, user: { id, username } }
 */
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, msg: 'username/password required' });
  }
  const user = userRepo.findByUsername(String(username));
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    // 故意不区分"用户不存在"和"密码错"
    logger.warn(`login failed: ${username}`);
    return res.status(401).json({ ok: false, msg: 'Invalid credentials' });
  }
  const token = signToken({ uid: user.id, username: user.username });
  auditRepo.log(user.id, 'login', { ip: req.ip });
  res.json({
    ok: true,
    token,
    user: { id: user.id, username: user.username },
  });
});

/**
 * GET /api/admin/me
 * 用于前端启动时校验 token
 */
router.get('/me', requireAuth, (req, res) => {
  const user = userRepo.findById(req.user.id);
  if (!user) return res.status(401).json({ ok: false, msg: 'User not found' });
  res.json({ ok: true, user: { id: user.id, username: user.username } });
});

/**
 * PUT /api/admin/password
 * body: { oldPassword, newPassword }  新密码至少 8 位
 */
router.put('/password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ ok: false, msg: '新密码至少 8 位' });
  }
  const full = userRepo.findByUsername(req.user.username);
  if (!full || full.id !== req.user.id) {
    return res.status(401).json({ ok: false, msg: '用户异常' });
  }
  if (!verifyPassword(String(oldPassword), full.password_hash)) {
    return res.status(400).json({ ok: false, msg: '原密码错误' });
  }
  userRepo.updatePassword(full.id, hashPassword(String(newPassword)));
  auditRepo.log(full.id, 'password.change', null);
  res.json({ ok: true });
});

export default router;
