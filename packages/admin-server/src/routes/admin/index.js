/**
 * 汇总所有 admin(私有)路由,统一挂在 /api/admin 下。
 */

import { Router } from 'express';
import { requireAuth } from '../../lib/auth.js';

import authRouter from './auth.js';
import domainsRouter from './domains.js';
import portalUIRouter from './portalUI.js';
import landingRouter from './landing.js';
import mediaRouter from './media.js';
import apkRouter from './apk.js';
import systemRouter from './system.js';
import cfRouter from './cf.js';

const router = Router();

// 登录 / me / 改密(路由自带鉴权) — 必须放在全局 requireAuth 之前
router.use('/', authRouter);

// 以下全部需要 JWT
router.use(requireAuth);
router.use('/domains', domainsRouter);
router.use('/portalUI', portalUIRouter);
router.use('/landing', landingRouter);
router.use('/media', mediaRouter);
router.use('/apk', apkRouter);
router.use('/system', systemRouter);
router.use('/cf', cfRouter);

export default router;
