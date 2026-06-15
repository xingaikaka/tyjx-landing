import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '../..'); // packages/admin-server/

function required(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function int(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} is not a number: ${v}`);
  return n;
}

const config = {
  port: int('PORT', 3010),
  rootDir: ROOT,

  // 路径
  dbPath: path.resolve(ROOT, process.env.DB_PATH || 'src/data/portal.db'),
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || 'src/data/uploads'),

  // 认证
  jwt: {
    secret: required('JWT_SECRET', 'dev-only-jwt-secret-please-replace-32bytes!'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  adminDefault: {
    user: process.env.ADMIN_DEFAULT_USER || 'admin',
    password: process.env.ADMIN_DEFAULT_PASSWORD || 'admin123456',
  },

  // relay-server 通信
  portalApiSecret: required(
    'PORTAL_API_SECRET',
    'dev-only-portal-api-secret-32bytes-please-replace!'
  ),

  // 公开 URL(媒体地址前缀)
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${int('PORT', 3010)}`,

  // CORS
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // 限频(管理 API)
  adminRateLimit: int('ADMIN_RATE_LIMIT', 60),

  // 媒体上传上限(字节),默认 200MB
  maxUploadBytes: int('MAX_UPLOAD_MB', 200) * 1024 * 1024,

  // 标识(开发/生产)
  isProd: process.env.NODE_ENV === 'production',
};

// 确保目录存在
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

export default config;
