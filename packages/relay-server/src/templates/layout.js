/**
 * 入口/发布页共用的页面骨架。
 *
 * 设计目标:
 *   - HTML 自包含(CSS 内联,不依赖任何外部 CDN/JS)
 *   - 页内不出现完整域池,只渲染本次该用户看到的少量域
 *     (扫描器拿到一份 HTML 只能拿到 N 个域,不是池子全集)
 *   - 没有任何 <a href> 直接跳到 finalLandings,降低被自动跟踪的概率
 *
 * 数据来源:
 *   - portalUI:  admin Tab2 配置的文案 / Logo
 *   - section:   各页面自己渲染(按钮列表 / 复制行列表)
 *
 * 注意:
 *   不要添加任何 <script src="...crypto.js"> 之类的外链,会暴露相似性。
 */

import { esc } from '../lib/util.js';

/**
 * @param {object} runtime
 * @param {string} brandDomain  用于"收藏块"占位符替换
 * @param {string} title       <title>
 * @param {string} sectionHtml 主区域 HTML
 * @param {string} clientJs    客户端 <script> 内容(可选)
 * @returns {string}
 */
export function renderShell({ runtime, brandDomain, title, sectionHtml, clientJs = '' }) {
  const { portalUI } = runtime;
  const blk = portalUI.bookmarkBlock || {};

  const replaceBrand = (s) =>
    String(s || '').replace(/<brandDomain>/g, brandDomain || '');

  const decorateLine = (s) => {
    // 把 <brandDomain> 替换为带样式的 b 标签
    if (!s) return '';
    const safe = esc(s);
    return safe.replace(
      /&lt;brandDomain&gt;/g,
      `<b>${esc(brandDomain || '')}</b>`
    );
  };

  const footer = (portalUI.footerNote || [])
    .map((l) => `<div>${esc(replaceBrand(l))}</div>`)
    .join('');

  // logo:加载失败时整个容器(空圆)隐藏,避免在不支持当前 mime 的浏览器留个空占位
  const logo = portalUI.logo
    ? `<div class="va-a"><img src="${esc(portalUI.logo)}" alt="logo" onerror="this.parentNode&&(this.parentNode.style.display='none')" /></div>`
    : '';

  // favicon:多 link 标签兼容浏览器/iOS。
  //   - rel="icon" + rel="shortcut icon" → 老 IE / 国产浏览器
  //   - apple-touch-icon → iOS 加书签 / 主屏图标
  //   - type 必填(根据 URL 后缀推断),不写部分浏览器(夸克/UC)直接忽略 link
  function pickIconType(u) {
    if (/\.ico(\?|#|$)/i.test(u)) return 'image/x-icon';
    if (/\.png(\?|#|$)/i.test(u)) return 'image/png';
    if (/\.jpe?g(\?|#|$)/i.test(u)) return 'image/jpeg';
    if (/\.webp(\?|#|$)/i.test(u)) return 'image/webp';
    if (/\.svg(\?|#|$)/i.test(u)) return 'image/svg+xml';
    return 'image/x-icon';
  }
  const faviconLink = portalUI.favicon
    ? (() => {
        const fav = esc(portalUI.favicon);
        const ftype = pickIconType(portalUI.favicon);
        return `<link rel="icon" type="${ftype}" href="${fav}" />\n<link rel="shortcut icon" type="${ftype}" href="${fav}" />\n<link rel="apple-touch-icon" href="${fav}" />`;
      })()
    : '';

  return `<!DOCTYPE html>
<html lang="zh" style="font-size:37.5px">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="apple-touch-fullscreen" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="theme-color" content="#16151B">
<meta name="format-detection" content="telephone=no">
<meta name="format-detection" content="email=no">
<meta name="robots" content="noindex,nofollow">
${faviconLink}
<title>${esc(title)}</title>
<style>
*,*:after,*:before{margin:0;padding:0;outline:none;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
ol,ul{list-style:none}
ins,a{text-decoration:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;color:var(--text-color)}
img{border:none;vertical-align:middle}
:root{--bg-color:#16151B;--text-color:#8F8F8F;--color-primary:#f70}
/* 背景兼容性策略(对齐 X5/UC/QQ/360/百度等国产 WebView):
 *   ① html + body 都写 background-color:#16151B 兜底纯色 → 任何场景至少有底色,不会出现透明
 *   ② 渐变拆成独立 background-image,角度用标准正向(135deg = -135deg 等价但兼容性好得多)
 *   ③ background-attachment 不写 fixed,改成默认 scroll;
 *      fixed + viewport 在 iOS Safari 地址栏伸缩时还会引发渲染抖动,且部分 WebView 直接黑屏
 *   ④ html 同时也铺一层渐变,防止内容不足撑高时 body 高度小于视口看到 html 透明 */
html{min-height:100%;background-color:#16151B;background-image:linear-gradient(135deg,#16151B 0%,#0f0b19 100%);background-repeat:no-repeat;background-size:100% 100%}
body,html{font-size:.37333rem;font-family:PingFang SC,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overscroll-behavior:none}
body{display:flex;flex-direction:column;min-height:100%;min-height:100vh;min-height:100dvh;background-color:#16151B;background-image:linear-gradient(135deg,#16151B 0%,#0f0b19 100%);background-repeat:no-repeat;background-size:100% 100%;color:var(--text-color);padding-bottom:env(safe-area-inset-bottom,0);-webkit-text-size-adjust:100%}
.page{flex:1 1 auto;width:100%;max-width:11.41333rem;margin:0 auto;padding:.53333rem;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-left:max(.53333rem,env(safe-area-inset-left,0));padding-right:max(.53333rem,env(safe-area-inset-right,0))}
.page::-webkit-scrollbar{display:none}
.nav-a{position:relative;border-radius:.32rem;padding:1.33333rem .26667rem .26667rem;margin-top:.8rem;background-color:rgba(255,255,255,.05);border:.02667rem solid rgba(255,255,255,.1);width:100%}
.nav-a .va-a{position:absolute;top:-.8rem;left:calc((100% - 1.70667rem)/2);width:1.70667rem;height:1.70667rem}
.nav-a .va-a img{width:100%;height:100%;border-radius:50%;object-fit:cover;background:#16151B}
.nav-a .va-b{font-size:.64rem;color:#fff;font-weight:800;text-align:center}
.nav-a .va-c{padding:.13333rem 0;text-align:center;font-size:.34667rem}
.nav-a .va-d{font-weight:600;color:#fff;text-align:center;font-size:.4rem}
.nav-a .va-e,.nav-a .va-g{margin:.8rem 0;display:grid;grid-template-columns:1fr;gap:.26667rem}
.nav-a .va-e a{background-color:rgba(255,255,255,.05);border:.02667rem solid rgba(255,255,255,.1);color:var(--color-primary);padding:0 .26667rem;height:1.06667rem;line-height:1.06667rem;border-radius:10.66667rem;text-align:center;cursor:pointer;font-weight:500;font-size:.34667rem}
.nav-a .va-g a{background-color:rgba(255,255,255,.05);border:.02667rem solid rgba(255,255,255,.1);color:#fff;padding:0 .05333rem 0 .26667rem;height:1.06667rem;line-height:1.06667rem;border-radius:10.66667rem;cursor:pointer;font-size:.34667rem;display:flex;justify-content:space-between;align-items:center}
.nav-a .va-g a .domain-text{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;color:#fff;line-height:1.06667rem;-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}
.nav-a .va-g a .copy-btn{flex-shrink:0;height:.96rem;line-height:.96rem;border-radius:.96rem;padding:0 .26667rem;text-align:center;background-color:var(--color-primary);color:#fff;font-size:.32rem}
.nav-a .va-f{text-align:center;line-height:1.6;padding:.4rem 0 .26667rem;font-size:.34667rem}
.nav-a .va-f .va-f-line{display:block;margin-bottom:.32rem}
.nav-a .va-f .va-f-line b{color:var(--color-primary);white-space:nowrap}
.nav-a .va-h{color:var(--color-primary);text-align:center;padding:.26667rem 0;margin-bottom:.32rem;font-size:.34667rem}
.nav-b{margin-top:.53333rem;background-color:rgba(255,255,255,.05);border:.02667rem solid rgba(255,255,255,.1);border-radius:.32rem;text-align:center;padding:.4rem;width:100%;font-size:.34667rem;line-height:1.6}
.toast{position:fixed;bottom:calc(1.2rem + env(safe-area-inset-bottom,0));left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:.4rem .8rem;border-radius:.26667rem;font-size:.34667rem;opacity:0;transition:opacity .2s;z-index:9999;max-width:90vw;pointer-events:none}
.toast.show{opacity:1}
</style>
</head>
<body>
<div class="page">
<div class="nav-a">
${logo}
<div class="va-b">${esc(portalUI.siteName)}</div>
<div class="va-c">${esc(portalUI.bookmarkTip)}</div>
<div class="va-d">${esc(portalUI.clickPrompt)}</div>
${sectionHtml}
<div class="va-f">
<span class="va-f-line">${decorateLine(blk.line1)}</span>
<span class="va-f-line">${decorateLine(blk.line2)}</span>
<span class="va-f-line">${decorateLine(blk.line3)}</span>
</div>
</div>
${footer ? `<div class="nav-b">${footer}</div>` : ''}
</div>
<div class="toast" id="toast"></div>
<script>
(function(d,w){var e=d.documentElement;function r(){var c=e.clientWidth;if(!c)return;if(c>428)c=428;e.style.fontSize=c/10+'px'}r();w.addEventListener('resize',r);w.addEventListener('orientationchange',r)})(document,window);
function showToast(m){var t=document.getElementById('toast');if(!t)return;t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},2000)}
${clientJs}
</script>
</body>
</html>`;
}
