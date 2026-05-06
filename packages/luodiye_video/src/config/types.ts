/**
 * 与 tyjx-landing/packages/admin-server 的 LandingConfig schema 保持同步
 */

export interface LandingConfig {
  logo: string
  /**
   * 浏览器 tab 图标(.ico)。空字符串 → 不渲染 <link rel="icon">,沿用 next 默认。
   * 必须明文(浏览器无法解密 .enc),由 admin 单独以明文路径上传。
   */
  favicon: string
  /**
   * SEO 元信息(浏览器标签页 / 分享卡片)。客户端 hydrate 后注入到 <head>。
   * 任一字段空字符串 → 沿用 layout.tsx 里的 build-time 默认值,不覆盖。
   * 注意:不跑 JS 的爬虫(微信/Google)看到的还是默认值,改完想让爬虫认新文案需要重新部署。
   */
  seo: {
    title: string
    description: string
    keywords: string
  }
  backgroundVideo: string
  /** 视频首帧封面(poster):视频加载/缓冲时显示,避免黑屏 */
  backgroundVideoPoster: string
  telegramLink: string
  openInstallAppKey: string
  /**
   * Android APK 直接下载 URL(R2 + 腾讯 CDN,改名 .bin,Content-Disposition 强制 .apk 落地)
   * 非空 → Android 按钮 <a href download> 直链下载
   * 空    → 走 OpenInstall(原 SDK 行为)
   */
  androidApkUrl: string
  /** APK 文件名(展示用 + 备用 download attr) */
  androidApkFilename: string
  /**
   * iOS 下载链接(空 = 走 OpenInstall)。兼容:
   *   - https://apps.apple.com/...     App Store 上架
   *   - https://testflight.apple.com/. TestFlight 内测
   *   - itms-services://?action=download-manifest&url=https://.../manifest.plist
   *   - 任何 https URL                 第三方分发跳板
   * 非空 → iOS 按钮 <a href> 直跳;系统自动处理 itms-services 协议跳出到 App Store。
   */
  iosDownloadUrl: string
  downloadButtons: {
    ios: { label: string; enabled: boolean }
    android: { label: string; enabled: boolean }
  }
  vpnSection: {
    title: string
    subtitle: string
  }
  /**
   * 媒体资源 AES-256-GCM 解密 key(64 hex)。
   * 由 admin-server /api/portal/landing/config 注入,后台改 ASSET_AES_KEY 后下次拉就拿到新的。
   * 空字符串 → 加密资源都无法解密(后台还没配 key 或后端启动报错)。
   */
  assetAesKey: string
}

/**
 * 兜底默认值:
 *  - admin-server 不可用时使用
 *  - SSR/初次渲染前(还没拉到接口)用作"零闪烁"占位
 */
export const DEFAULT_LANDING_CONFIG: LandingConfig = {
  // 全部默认空:本地不再放任何素材,所有图片/视频走后台 R2 + 腾讯 CDN。
  //   - logo 空 → 不渲染 <img>,header 区留空
  //   - backgroundVideo 空 → BackgroundVideo 不渲染 <video>,黑底 + poster 顶住
  //   - backgroundVideoPoster 空 → 视频加载前是纯黑屏(可接受)
  logo: '',
  favicon: '',
  seo: {
    title: '',
    description: '',
    keywords: '',
  },
  backgroundVideo: '',
  backgroundVideoPoster: '',
  telegramLink: '',
  openInstallAppKey: 'ecedok',
  androidApkUrl: '',
  androidApkFilename: '',
  iosDownloadUrl: '',
  downloadButtons: {
    ios: { label: '苹果手机下载', enabled: true },
    android: { label: '安卓手机下载', enabled: true },
  },
  vpnSection: {
    title: '全网首家，自带免费VPN',
    subtitle: '安全稳定，高速畅享全球网络',
  },
  assetAesKey: '',
}
