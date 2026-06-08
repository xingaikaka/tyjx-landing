/**
 * 发布页(图 2)
 *
 *   M 行"网址 [复制按钮]"列表
 *   - 网址 = 随机 finalLandings 域 + 随机 subdomain
 *   - 不带 <a href> 真实跳转;按钮仅复制到剪贴板,
 *     强迫用户粘贴到浏览器打开 → 防微信/QQ/抖音内跳
 *
 *   "请将以上网址复制浏览器打开" 提示行
 */

import { renderShell } from './layout.js';
import { esc, randomSubdomain } from '../lib/util.js';

export function renderPublishPage(runtime) {
  const { domains, portalUI } = runtime;
  const n = Math.max(1, Math.min(20, domains.publishLinksCount || 2));
  const brand = (domains.brandDomains && domains.brandDomains[0]) || '';

  const pool = domains.finalLandings;
  const picked = [];
  for (let i = 0; i < n; i++) {
    const base = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
    if (!base) {
      picked.push('');
      continue;
    }
    picked.push(`https://${randomSubdomain()}.${base}/`);
  }

  const rows = picked.length === 0 || picked.every((u) => !u)
    ? '<a href="javascript:;"><span class="domain-text">暂无地址,请刷新重试</span><span class="copy-btn">复制网址</span></a>'
    : picked
        .map((url) => {
          if (!url) {
            return '<a href="javascript:;"><span class="domain-text">获取失败</span><span class="copy-btn">复制网址</span></a>';
          }
          // 显示去掉 https:// 前缀,复制时用完整 URL
          const display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
          return `<a href="javascript:;" data-copy="${esc(url)}"><span class="domain-text">${esc(display)}</span><span class="copy-btn">复制网址</span></a>`;
        })
        .join('');

  const sectionHtml = `
<div class="va-g">${rows}</div>
<div class="va-h">请将以上网址复制浏览器打开</div>
`;

  const clientJs = `
(function(){
  // 同步复制:只在 click handler 当下尝试,不走 Promise(微信/抖音 webview 异步会丢失用户激活态)
  function copySync(text){
    // ① execCommand('copy') 兼容性最广,iOS / 微信 / QQ / 抖音 webview 大多支持
    var ta=document.createElement('textarea');
    ta.value=text;
    ta.setAttribute('readonly','');
    ta.contentEditable='true';
    ta.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    var ok=false;
    try{
      if(/iP(ad|hone|od)/.test(navigator.userAgent)){
        // iOS:必须 Range + selectNodeContents 才能真选中
        var range=document.createRange();
        range.selectNodeContents(ta);
        var sel=window.getSelection();
        sel.removeAllRanges();sel.addRange(range);
        ta.setSelectionRange(0,text.length);
      }else{
        ta.focus();ta.select();
      }
      ok=document.execCommand('copy');
    }catch(e){}
    document.body.removeChild(ta);
    if(ok)return true;
    // ② 同步 fallback:Clipboard API 同步触发(异步结果忽略,主要靠浏览器在用户激活态下立即写入)
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text);
        return true;
      }
    }catch(e){}
    return false;
  }
  // 自动选中行内网址文字,让用户可以"长按 → 复制"
  function selectInRow(a){
    var span=a.querySelector('.domain-text');
    if(!span)return;
    span.style.webkitUserSelect='text';
    span.style.userSelect='text';
    span.style.webkitTouchCallout='default';
    try{
      var range=document.createRange();
      range.selectNodeContents(span);
      var sel=window.getSelection();
      sel.removeAllRanges();sel.addRange(range);
    }catch(e){}
  }
  document.querySelectorAll('.va-g a').forEach(function(a){
    // 提前给 .domain-text 打开 user-select,即使 JS 失败用户也能手动长按选中
    var span=a.querySelector('.domain-text');
    if(span){span.style.webkitUserSelect='text';span.style.userSelect='text';span.style.webkitTouchCallout='default';}
    a.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();
      var u=a.getAttribute('data-copy');
      if(!u)return showToast('暂无可复制的地址');
      if(copySync(u)){
        showToast('复制成功,请打开浏览器粘贴访问');
      }else{
        selectInRow(a);
        showToast('请长按已选网址 → 复制');
      }
    });
  });
})();
`;

  return renderShell({
    runtime,
    brandDomain: brand,
    title: portalUI.siteName,
    sectionHtml,
    clientJs,
  });
}
