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
import { esc, randomSubdomain, channelQuery } from '../lib/util.js';

export function renderPublishPage(runtime, channelCode = '') {
  const { domains, portalUI } = runtime;
  const n = Math.max(1, Math.min(20, domains.publishLinksCount || 2));
  const brand = (domains.brandDomains && domains.brandDomains[0]) || '';

  // 渠道码拼进用户最终复制的地址,落地页据此做渠道归因(OpenInstall 等)
  const q = channelQuery(channelCode);

  const pool = domains.finalLandings;
  const picked = [];
  for (let i = 0; i < n; i++) {
    const base = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
    if (!base) {
      picked.push('');
      continue;
    }
    picked.push(`https://${randomSubdomain()}.${base}/${q}`);
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
  // 同步复制:click handler 当下立即尝试,不用 await(微信/抖音/百度 webview 异步会丢失用户激活态)
  //
  // 顺序设计(iOS bug 教训):
  //   ① navigator.clipboard.writeText 优先 — iOS 13.4+/Android Chrome/桌面全支持,
  //      HTTPS + click handler 内部触发可靠;Promise 派发完写操作即返回,无需 await。
  //   ② execCommand('copy') 兜底 — 老 Android webview / 微信 X5(老版)/ UC / 360。
  //
  // ⚠️ 历史坑:execCommand 在 iOS 上对"隐身"元素(opacity:0 / width:1px / display:none)
  //   会**返回 true 但实际不写剪贴板**,造成"提示成功但粘贴为空"。textarea 必须用
  //   left:-9999px 移到屏外、保留正常尺寸,而不是 opacity:0。
  function copySync(text){
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text);
        return true;
      }
    }catch(e){}
    var ta=document.createElement('textarea');
    ta.value=text;
    ta.setAttribute('readonly','');
    ta.style.cssText='position:fixed;left:-9999px;top:0;font-size:16px';
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
    return ok;
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
