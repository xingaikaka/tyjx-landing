import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import config from './config.js';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch {
    return null;
  }
}

/**
 * Express 中间件:要求请求头 `Authorization: Bearer <token>`,
 * 校验通过后挂 req.user = { id, username }
 */
export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    return res.status(401).json({ ok: false, msg: 'Missing token' });
  }
  const decoded = verifyToken(m[1]);
  if (!decoded || !decoded.uid) {
    return res.status(401).json({ ok: false, msg: 'Invalid token' });
  }
  req.user = { id: decoded.uid, username: decoded.username };
  next();
}
