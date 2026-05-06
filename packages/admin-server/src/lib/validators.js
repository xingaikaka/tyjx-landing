/**
 * 配置校验:域池 / portalUI / landing
 */

// 允许 tyjx.app、foo.bar.cc、*.cc 等常见落地域
const HOST_RE = /^(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeHost(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

function validHost(h) {
  const n = normalizeHost(h);
  if (!n || n.length > 253) return false;
  return HOST_RE.test(n);
}

export function validateDomains(body) {
  const d = body || {};
  const errors = [];

  if (!Array.isArray(d.brandDomains)) errors.push('brandDomains 必须是数组');
  else if (d.brandDomains.length < 1 || d.brandDomains.length > 10) {
    errors.push('brandDomains 数量需在 1~10');
  } else {
    d.brandDomains.forEach((h, i) => {
      if (!validHost(h)) errors.push(`brandDomains[${i}] 域名格式无效`);
    });
  }

  for (const key of ['entryPages', 'publishPages', 'finalLandings']) {
    if (!Array.isArray(d[key])) errors.push(`${key} 必须是数组`);
    else if (d[key].length > 50) errors.push(`${key} 最多 50 条`);
    else {
      d[key].forEach((h, i) => {
        if (!validHost(h)) errors.push(`${key}[${i}] 域名格式无效`);
      });
    }
  }

  const ec = Number(d.entryButtonsCount);
  const pc = Number(d.publishLinksCount);
  if (!Number.isInteger(ec) || ec < 1 || ec > 20) {
    errors.push('entryButtonsCount 需在 1~20');
  }
  if (!Number.isInteger(pc) || pc < 1 || pc > 20) {
    errors.push('publishLinksCount 需在 1~20');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      brandDomains: d.brandDomains.map(normalizeHost),
      entryPages: d.entryPages.map(normalizeHost),
      publishPages: d.publishPages.map(normalizeHost),
      finalLandings: d.finalLandings.map(normalizeHost),
      entryButtonsCount: ec,
      publishLinksCount: pc,
    },
  };
}

function str(v, max = 2000) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

export function validatePortalUI(body) {
  const p = body || {};
  const errors = [];
  if (typeof p !== 'object' || Array.isArray(p)) {
    return { ok: false, errors: ['portalUI 必须是对象'] };
  }
  const bb = p.bookmarkBlock || {};
  if (typeof bb !== 'object' || Array.isArray(bb)) {
    errors.push('bookmarkBlock 必须是对象');
  }
  const fn = p.footerNote;
  if (!Array.isArray(fn)) errors.push('footerNote 必须是字符串数组');
  else if (fn.length > 30) errors.push('footerNote 最多 30 行');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      logo: str(p.logo, 2000),
      // 浏览器 tab favicon(明文存储,Worker 直接 <link rel=icon> 渲染)
      favicon: str(p.favicon, 2000),
      siteName: str(p.siteName, 200),
      bookmarkTip: str(p.bookmarkTip, 500),
      clickPrompt: str(p.clickPrompt, 500),
      bookmarkBlock: {
        line1: str(bb.line1, 500),
        line2: str(bb.line2, 500),
        line3: str(bb.line3, 500),
      },
      footerNote: Array.isArray(fn) ? fn.map((x) => str(x, 500)) : [],
    },
  };
}

export function validateLanding(body) {
  const l = body || {};
  if (typeof l !== 'object' || Array.isArray(l)) {
    return { ok: false, errors: ['landing 必须是对象'] };
  }
  const db = l.downloadButtons || {};
  const ios = db.ios || {};
  const android = db.android || {};
  const vpn = l.vpnSection || {};
  const seo = l.seo || {};

  return {
    ok: true,
    data: {
      logo: str(l.logo, 2000),
      // 浏览器 tab favicon(.ico 明文存储,不加密、不压缩)
      favicon: str(l.favicon, 2000),
      // SEO 文案:落地页客户端 hydrate 后会动态写到 <title> / <meta>。
      // 注意爬虫(微信 / Google) 多数不跑 JS,看到的还是 build-time 兜底值。
      seo: {
        title: str(seo.title, 200),
        description: str(seo.description, 500),
        keywords: str(seo.keywords, 500),
      },
      backgroundVideo: str(l.backgroundVideo, 2000),
      backgroundVideoPoster: str(l.backgroundVideoPoster, 2000),
      telegramLink: str(l.telegramLink, 500),
      openInstallAppKey: str(l.openInstallAppKey, 100),
      // Android APK 直接下载 URL(优先级高于 OpenInstall);留空 → 走 OpenInstall
      androidApkUrl: str(l.androidApkUrl, 2000),
      androidApkFilename: str(l.androidApkFilename, 200),
      // iOS 下载链接(优先级高于 OpenInstall);留空 → 走 OpenInstall
      // 兼容多种形式:
      //   - https://apps.apple.com/...     App Store 上架
      //   - https://testflight.apple.com/.. TestFlight 内测
      //   - itms-services://?action=download-manifest&url=https://.../manifest.plist
      //                                     企业证书 / 超级签名分发
      //   - 任何 https URL                 第三方分发跳板
      iosDownloadUrl: str(l.iosDownloadUrl, 2000),
      downloadButtons: {
        ios: {
          label: str(ios.label, 100),
          enabled: Boolean(ios.enabled),
        },
        android: {
          label: str(android.label, 100),
          enabled: Boolean(android.enabled),
        },
      },
      vpnSection: {
        title: str(vpn.title, 200),
        subtitle: str(vpn.subtitle, 300),
      },
    },
  };
}
