/* 与 admin-server validators.js / DB schema 保持同步 */

export interface DomainsConfig {
  brandDomains: string[];
  entryPages: string[];
  publishPages: string[];
  finalLandings: string[];
  entryButtonsCount: number;
  publishLinksCount: number;
}

export interface PortalUIConfig {
  logo: string;
  /** 浏览器 tab 图标(可选,明文存储) */
  favicon: string;
  siteName: string;
  bookmarkTip: string;
  clickPrompt: string;
  bookmarkBlock: {
    line1: string;
    line2: string;
    line3: string;
  };
  footerNote: string[];
}

export interface LandingConfig {
  logo: string;
  /** 浏览器 tab 图标(.ico 明文存储,不加密;为空则不渲染 <link rel="icon">) */
  favicon: string;
  /**
   * SEO 文案。落地页客户端 hydrate 后会同步写到 <title>/<meta name=description>/<meta name=keywords>。
   * 注意:微信/Google 等不跑 JS 的爬虫看到的仍是 build-time 默认值。
   */
  seo: {
    title: string;
    description: string;
    keywords: string;
  };
  backgroundVideo: string;
  /** 视频首帧 jpg(背景视频加载前的占位,避免黑屏) */
  backgroundVideoPoster: string;
  telegramLink: string;
  openInstallAppKey: string;
  /** Android APK 直接下载 URL(空 = 走 OpenInstall) */
  androidApkUrl: string;
  /** APK 文件名(供 UI 展示用) */
  androidApkFilename: string;
  /**
   * iOS 下载链接(空 = 走 OpenInstall)。兼容:
   *   - https://apps.apple.com/...     App Store 上架
   *   - https://testflight.apple.com/. TestFlight 内测
   *   - itms-services://?action=download-manifest&url=https://.../manifest.plist
   *   - 任何 https URL                 第三方分发跳板
   */
  iosDownloadUrl: string;
  downloadButtons: {
    ios: { label: string; enabled: boolean };
    android: { label: string; enabled: boolean };
  };
  vpnSection: {
    title: string;
    subtitle: string;
  };
}

export interface ApkItem {
  id: number;
  filename: string;
  /** 固定地址 = CDN 直链(R2 同 key 覆盖,新版本上传后此 URL 内容会变) */
  url: string;
  size: number;
  backend?: 'local' | 'r2';
  /** R2 path 段,固定地址里的 slug:downloads/<slug>.bin */
  slug?: string | null;
  /** 与 url 同值(老字段保留,固定地址方案下不再有"短链跳转"概念) */
  shortLink?: string | null;
  /** 上传完调用腾讯云 CDN PurgeUrlsCache 的结果 */
  purge?: {
    ok: boolean;
    taskId?: string;
    msg?: string;
    count?: number;
  };
  created_at: number;
}

export interface MediaItem {
  id: number;
  filename: string;
  storage_key: string;
  url: string;
  mime: string;
  size: number;
  /** 服务端字段:'file' | 'hls'(视频转码产物) */
  kind?: 'file' | 'hls';
  /** 视频首帧 jpg(后端 ffmpeg 截图,可能为空) */
  poster_url?: string | null;
  duration?: number | null;
  storage_prefix?: string | null;
  backend?: 'local' | 'r2';
  created_at: number;
}

export interface UploadResp {
  id: number;
  url: string;
  posterUrl?: string;
  filename: string;
  size: number;
  mime: string;
  duration?: number;
  segmentCount?: number;
  kind?: 'file' | 'hls';
  backend?: 'local' | 'r2';
}

export interface AdminUser {
  id: number;
  username: string;
}

export interface ApiResp<T> {
  ok: boolean;
  data?: T;
  msg?: string;
  errors?: string[];
}
