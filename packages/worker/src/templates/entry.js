/**
 * 入口页(图 1)
 *
 *   N 个圆角按钮:"最新地址 1"、"最新地址 2" ...
 *   点击 → 跳到随机 publishPage 的随机子域 / 路径
 *
 *   每次刷新随机生成,HTML 里只有 N 个被选中的域,不暴露池子全集。
 */

import { renderShell } from './layout.js';
import { pickRandomN } from '../lib/router.js';
import { esc, randomSubdomain } from '../lib/util.js';

export function renderEntryPage(runtime) {
  const { domains, portalUI } = runtime;
  const n = Math.max(1, Math.min(20, domains.entryButtonsCount || 2));
  const brand = (domains.brandDomains && domains.brandDomains[0]) || '';

  // 优先用 publishPages,空时退化到 brandDomain(自跳让用户重抽,避免死链)
  const pool = domains.publishPages.length > 0 ? domains.publishPages : domains.brandDomains;

  const picked = [];
  for (let i = 0; i < n; i++) {
    const base = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
    if (!base) {
      picked.push('');
      continue;
    }
    picked.push(`https://${randomSubdomain()}.${base}/`);
  }

  // 不留空的池子(全部域都没配置时)→ 友好降级为占位
  const buttons = picked.length === 0 || picked.every((u) => !u)
    ? '<a href="javascript:;">暂无地址,请刷新重试</a>'
    : picked
        .map((url, i) => {
          if (!url) return `<a href="javascript:;">最新地址${i + 1}</a>`;
          return `<a href="${esc(url)}">最新地址${i + 1}</a>`;
        })
        .join('');

  const sectionHtml = `<div class="va-e">${buttons}</div>`;

  return renderShell({
    runtime,
    brandDomain: brand,
    title: portalUI.siteName,
    sectionHtml,
  });
}
