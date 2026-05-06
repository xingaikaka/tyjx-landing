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
  // 同步复制:click handler 当下立即尝试,不用 Promise(微信/抖音/百度 webview 异步会丢失用户激活态)
  function copySync(text){
    // ① execCommand('copy') 兼容性最广,iOS / 微信 / QQ / 抖音 大多支持
    var ta=document.createElement('textarea');
    ta.value=text;
    ta.setAttribute('readonly','');
    ta.contentEditable='true';
    ta.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    var ok=false;
    try{
      if(/iP(ad|hone|od)/.test(navigator.userAgent)){
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
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text);
        return true;
      }
    }catch(e){}
    return false;
  }
  // 兜底:打开复制助手浮层 —— 不依赖任何 clipboard API,只让浏览器原生选中文本,
  // 用户长按能拿到原生"复制"菜单。百度 App / UC / QQ 浏览器等都能用。
  function escHtml(s){return String(s).replace(/[<>&"']/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c];});}
  function showCopyAssist(url){
    var old=document.getElementById('__copy_assist__');
    if(old&&old.parentNode)old.parentNode.removeChild(old);
    var mask=document.createElement('div');
    mask.id='__copy_assist__';
    mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;-webkit-tap-highlight-color:transparent';
    mask.innerHTML='<div style="background:#fff;color:#333;border-radius:14px;padding:18px;max-width:360px;width:100%;box-shadow:0 12px 50px rgba(0,0,0,.6);font-size:14px;line-height:1.5">'
      +'<div style="font-size:13px;color:#888;margin-bottom:10px;text-align:center">长按下方网址,选择 <b style="color:#f70">复制</b></div>'
      +'<div id="__copy_assist_url__" style="border:2px dashed #f70;border-radius:8px;padding:14px 12px;font-size:16px;color:#f70;background:#fff8f0;word-break:break-all;line-height:1.45;-webkit-user-select:text;user-select:text;-webkit-touch-callout:default;text-align:center;font-weight:600">'+escHtml(url)+'</div>'
      +'<div style="margin-top:10px;font-size:12px;color:#aaa;text-align:center">复制成功后请粘贴到浏览器打开</div>'
      +'<button id="__copy_assist_close__" style="margin-top:14px;width:100%;border:0;background:#f70;color:#fff;height:44px;border-radius:8px;font-size:15px;font-weight:600">关闭</button>'
      +'</div>';
    document.body.appendChild(mask);
    // 尝试自动选中(用户什么都不用做就能直接长按出复制菜单)
    setTimeout(function(){
      try{
        var node=document.getElementById('__copy_assist_url__');
        var range=document.createRange();
        range.selectNodeContents(node);
        var sel=window.getSelection();
        sel.removeAllRanges();sel.addRange(range);
      }catch(e){}
    },80);
    function close(){if(mask.parentNode)mask.parentNode.removeChild(mask);}
    mask.querySelector('#__copy_assist_close__').addEventListener('click',close);
    mask.addEventListener('click',function(e){if(e.target===mask)close();});
  }
  document.querySelectorAll('.va-g a').forEach(function(a){
    var span=a.querySelector('.domain-text');
    if(span){span.style.webkitUserSelect='text';span.style.userSelect='text';span.style.webkitTouchCallout='default';}
    a.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();
      var u=a.getAttribute('data-copy');
      if(!u)return showToast('暂无可复制的地址');
      if(copySync(u)){
        showToast('复制成功,请打开浏览器粘贴访问');
      }else{
        showCopyAssist(u);
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
