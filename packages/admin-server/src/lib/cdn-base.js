/**
 * 媒体 CDN 域名管理
 *
 * 设计思路:
 *   - DB 里存 system.mediaCdnBase(后台可改)
 *   - 没配则 fallback env CDN_BASE → R2_PUBLIC_BASE
 *   - 所有上传新返回的 URL 用这个值拼;所有 API 响应时把 URL 的 host
 *     重写成当前值,实现"后台一改全切",DB 历史数据不用迁移
 *
 * 暴露:
 *   - getCdnBase()           当前生效的对外 URL 前缀(无尾斜杠)
 *   - rewriteUrlByCdnBase(s) 单个 URL 字符串 host 切换
 *   - rewriteUrlsByCdnBase(o) 递归对象/数组里所有 http(s) string 都切
 */

import { configRepo } from './db.js';

/**
 * 当前生效的 CDN base(优先级:DB system.mediaCdnBase > CDN_BASE env > R2_PUBLIC_BASE env)
 * 不抛异常,没配返回 ''(调用方需自行判空)
 */
export function getCdnBase() {
  const sys = configRepo.get('system', {}) || {};
  const fromDb = typeof sys.mediaCdnBase === 'string' ? sys.mediaCdnBase.trim() : '';
  const v = fromDb || process.env.CDN_BASE || process.env.R2_PUBLIC_BASE || '';
  return v.replace(/\/+$/, '');
}

/**
 * 把单个 URL 的 host 切换为当前 cdnBase。
 *
 * **只对"媒体源 host"生效**(R2 直链 / 历史 CDN host),
 * 不会动外站 URL(如 https://t.me/xxx、https://openinstall.io/...)。
 *
 * 判定为"媒体源"的 host:
 *   1. 当前 CDN_BASE / R2_PUBLIC_BASE env 里配的 host
 *   2. 历史曾用过的 R2 域(*.r2.cloudflarestorage.com / *.r2.dev)
 *   3. 当前 system.mediaCdnBase 里配置的 host(同源切换无操作但允许通过)
 *
 * - 非字符串、非 http(s)、cdnBase 为空 → 原样返回
 * - 抛错(URL 解析失败)→ 原样返回
 * - host 不在白名单 → 原样返回(关键修复:外站 URL 不被吃掉)
 */
function isMediaHost(host) {
  if (!host) return false;
  // R2 通用 host
  if (/\.r2\.cloudflarestorage\.com$/i.test(host)) return true;
  if (/\.r2\.dev$/i.test(host)) return true;
  // env 配的可能 host(CDN_BASE / R2_PUBLIC_BASE)
  for (const envKey of ['CDN_BASE', 'R2_PUBLIC_BASE']) {
    const v = process.env[envKey];
    if (!v) continue;
    try {
      const u = new URL(v);
      if (u.host === host) return true;
    } catch { /* noop */ }
  }
  // DB 配的 mediaCdnBase
  try {
    const sys = configRepo.get('system', {}) || {};
    if (typeof sys.mediaCdnBase === 'string' && sys.mediaCdnBase) {
      const u = new URL(sys.mediaCdnBase);
      if (u.host === host) return true;
    }
  } catch { /* noop */ }
  return false;
}

export function rewriteUrlByCdnBase(input) {
  if (typeof input !== 'string') return input;
  if (!/^https?:\/\//i.test(input)) return input;
  const base = getCdnBase();
  if (!base) return input;
  try {
    const u = new URL(input);
    if (!isMediaHost(u.host)) return input; // 外站 URL 原样返回
    const nb = new URL(base);
    if (u.host === nb.host && u.protocol === nb.protocol) return input;
    u.protocol = nb.protocol;
    u.host = nb.host;
    return u.toString();
  } catch {
    return input;
  }
}

/** 递归把对象/数组中所有 string URL 都做 host 切换 */
export function rewriteUrlsByCdnBase(value) {
  if (typeof value === 'string') return rewriteUrlByCdnBase(value);
  if (Array.isArray(value)) return value.map(rewriteUrlsByCdnBase);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = rewriteUrlsByCdnBase(value[k]);
    return out;
  }
  return value;
}
