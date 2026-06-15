/**
 * tyjx-portal admin-server 主入口
 *
 *   /api/portal/*       公开 API(relay-server / luodiye_video 拉)
 *   /api/admin/*        私有 API(JWT 认证,admin UI 用)
 *   /uploads/*          媒体静态服务
 *   /healthz            健康检查
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';

import config from './lib/config.js';
import logger from './lib/logger.js';
import { runSeed } from './seed/run.js';

import publicRouter from './routes/public.js';
import adminRouter from './routes/admin/index.js';
import downloadRouter from './routes/download.js';

const app = express();

/* ─────────── 通用中间件 ─────────── */

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// CORS:对公开 API 必须开,否则 relay-server / 落地页拉不到
app.use(
  cors({
    origin: (origin, cb) => {
      // 没 origin 头(curl、同源)直接通过
      if (!origin) return cb(null, true);
      if (config.allowedOrigins.includes('*')) return cb(null, true);
      if (config.allowedOrigins.some((o) => matchOrigin(o, origin))) {
        return cb(null, true);
      }
      cb(new Error(`CORS not allowed: ${origin}`));
    },
    credentials: false,
  })
);

function matchOrigin(pattern, origin) {
  // 支持 *.example.com 风格通配符
  if (pattern === origin) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".example.com"
    try {
      const host = new URL(origin).hostname;
      return host.endsWith(suffix);
    } catch {
      return false;
    }
  }
  return false;
}

// 简单访问日志
app.use((req, _res, next) => {
  if (req.path !== '/healthz') {
    logger.debug(`${req.method} ${req.path}`);
  }
  next();
});

/* ─────────── Routes ─────────── */

// 媒体静态服务(后续 Phase 加 token 鉴权,目前简单暴露)
//
// downloads/*.bin 是 APK 安装包(改后缀避免基于扩展名的特征匹配)。
// R2 后端已经在对象元数据上写好了 Content-Disposition,
// local 后端这里 setHeaders 兜一下:强制 mime + attachment 让浏览器按 .apk 保存。
//
// 注意:better-sqlite3 同步可读,但 db.js 是 ESM,setHeaders 同步钩子无法 await import,
// 这里不查 DB 拿原始 filename,统一落地为 'app-<8位短 id>.apk',体验上够用。
app.use(
  '/uploads',
  express.static(config.uploadDir, {
    maxAge: '30d',
    immutable: true,
    setHeaders: (res, filePath) => {
      const m = /[\\/]downloads[\\/]([0-9a-f]+)\.bin$/i.exec(filePath);
      if (!m) return;
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="app-${m[1].slice(0, 8)}.apk"`
      );
    },
  })
);

// 公开
app.use('/api/portal', publicRouter);

// 公开下载短链(对外稳定地址,可贴 openinstall 等)
//   /api/d/:slug.bin → 走现有 nginx /api/ 代理(无需改 nginx)
//   /d/:slug.bin     → 更短(*.tyjx7k2m9pqs4.cc 上需要 nginx 加 location /d/ 转 admin-server)
app.use('/api/d', downloadRouter);
app.use('/d', downloadRouter);

// 私有
app.use('/api/admin', adminRouter);

// 健康检查
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, msg: 'Not Found', path: req.path });
});

// Multer 上传错误
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ ok: false, msg: '文件超过大小限制' });
    }
    return res.status(400).json({ ok: false, msg: err.message });
  }
  if (err && err.message && req.path?.startsWith('/api/admin/media')) {
    return res.status(400).json({ ok: false, msg: err.message });
  }
  next(err);
});

// 错误兜底
app.use((err, _req, res, _next) => {
  logger.error('unhandled error:', err);
  res.status(500).json({ ok: false, msg: err.message || 'Internal Server Error' });
});

/* ─────────── 启动 ─────────── */

// 启动前 seed,确保有默认账号 + 默认 config
try {
  runSeed();
} catch (e) {
  logger.error('seed failed:', e);
  process.exit(1);
}

app.listen(config.port, () => {
  logger.info(`admin-server listening on http://0.0.0.0:${config.port}`);
  logger.info(`  public:  GET  /api/portal/runtime`);
  logger.info(`  public:  GET  /api/portal/landing/config`);
  logger.info(`  admin:   POST /api/admin/login  PUT /password  GET /me`);
  logger.info(`  admin:   GET/PUT /domains /portalUI /landing  GET/POST/DELETE /media /apk`);
  logger.info(`  uploads: GET  /uploads/*`);
});

// 优雅关闭
function shutdown(sig) {
  logger.info(`Received ${sig}, shutting down...`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
