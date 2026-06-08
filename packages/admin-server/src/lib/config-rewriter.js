/**
 * 在 config 表的所有 JSON value 里把旧 URL 字符串替换为新 URL。
 *
 * 上传图片走"覆盖语义"时,旧 R2 对象会被物理删除。如果配置(landing / portalUI 等)
 * 里仍引用着旧 URL,刷新后预览会 404。这里负责把这些引用同步切到新 URL。
 *
 * 用法:
 *   import db, { configRepo } from './db.js';
 *   replaceUrlInAllConfigs(['old1', 'old2'], 'new');
 */

import db, { configRepo } from './db.js';
import logger from './logger.js';

/**
 * @param {string[]} oldUrls  老 URL 列表(任意一个匹配就替换)
 * @param {string}   newUrl   替换目标
 * @returns {{key:string, count:number}[]} 每个被改的 config key 和替换次数
 */
export function replaceUrlInAllConfigs(oldUrls, newUrl) {
  const olds = (oldUrls || []).filter((s) => typeof s === 'string' && s);
  if (!olds.length || typeof newUrl !== 'string') return [];

  const allKeys = db.prepare('SELECT key FROM config').all().map((r) => r.key);
  const changed = [];

  for (const k of allKeys) {
    const cur = configRepo.get(k);
    if (cur === null || cur === undefined) continue;

    let count = 0;
    const next = JSON.parse(
      JSON.stringify(cur, (_jk, v) => {
        if (typeof v !== 'string') return v;
        let out = v;
        for (const o of olds) {
          if (out.includes(o)) {
            out = out.split(o).join(newUrl);
            count++;
          }
        }
        return out;
      })
    );

    if (count > 0) {
      configRepo.set(k, next);
      logger.info(`[config-rewriter] ${k}: replaced ${count} url ref(s)`);
      changed.push({ key: k, count });
    }
  }
  return changed;
}
