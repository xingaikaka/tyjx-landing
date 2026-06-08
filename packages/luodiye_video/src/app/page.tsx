'use client'

import { useState, useEffect, useMemo } from 'react'
import { SiAndroid } from 'react-icons/si'
import OpenInstallScript from '@/components/OpenInstallScript'
import BackgroundVideo from '@/components/BackgroundVideo'
import EncryptedImage from '@/components/EncryptedImage'
import { useLandingConfig } from '@/hooks/useLandingConfig'

/**
 * 动态 favicon:把后台配置的 .ico URL 写进 <link rel="icon">
 *
 * 必须客户端注入(static export 模式 metadata.icons 会在 build 时定值,
 * 改 admin 不会即时生效)。每次 url 变就替换;清空就移除节点。
 */
function DynamicFavicon({ url }: { url: string }) {
  useEffect(() => {
    const SELECTOR = 'link[rel="icon"][data-dynamic="1"]'
    const head = document.head
    let link = head.querySelector<HTMLLinkElement>(SELECTOR)

    if (!url) {
      if (link) head.removeChild(link)
      return
    }

    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      link.dataset.dynamic = '1'
      // 不锁 type,浏览器会按响应 Content-Type / 内容嗅探(.ico 不一定是 image/x-icon)
      head.appendChild(link)
    }
    if (link.href !== url) link.href = url
  }, [url])
  return null
}

/**
 * 动态 SEO:落地页拿到后台配置后,同步覆盖 <title> / <meta description / keywords>
 * 以及 og:title / og:description。空值不覆盖,沿用 layout.tsx 里的 build-time 默认。
 *
 * 限制:微信 / Google / FB 等不跑 JS 的爬虫看到的仍是 build 时的兜底值。
 * 真人浏览器在 hydrate 后立刻看到最新文案。
 */
function DynamicSEO({
  seo,
}: {
  seo: { title: string; description: string; keywords: string }
}) {
  useEffect(() => {
    if (typeof document === 'undefined') return

    if (seo.title) document.title = seo.title

    const setMeta = (selector: string, attr: 'name' | 'property', key: string, content: string) => {
      if (!content) return
      let el = document.head.querySelector<HTMLMetaElement>(selector)
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute(attr, key)
        el.dataset.dynamic = '1'
        document.head.appendChild(el)
      }
      if (el.content !== content) el.content = content
    }

    setMeta('meta[name="description"]', 'name', 'description', seo.description)
    setMeta('meta[name="keywords"]', 'name', 'keywords', seo.keywords)
    setMeta('meta[property="og:title"]', 'property', 'og:title', seo.title)
    setMeta(
      'meta[property="og:description"]',
      'property',
      'og:description',
      seo.description
    )
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', seo.title)
    setMeta(
      'meta[name="twitter:description"]',
      'name',
      'twitter:description',
      seo.description
    )
  }, [seo.title, seo.description, seo.keywords])

  return null
}

const APPLE_ICON_PATH = "M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
const BUTTON_STYLE = { width: '140px', height: '40px' }

/**
 * 下载按钮:
 *   Android — apkHref 非空 → <a href download>;留空 → <button data-openinstall>
 *   iOS     — iosHref 非空 → <a href>(支持 App Store / TestFlight / itms-services);
 *                            留空 → <button data-openinstall>(SDK 内部跳 App Store)
 *
 * iOS 不加 download 属性:
 *   - itms-services:// 走系统协议,download 会被忽略
 *   - https://apps.apple.com / testflight 是浏览器跳转,加 download 反而会被
 *     某些 in-app webview 当成下载非法资源拦截
 */
const DownloadButton = ({
  type,
  label,
  apkHref,
  apkFilename,
  iosHref,
}: {
  type: 'ios' | 'android'
  label: string
  apkHref?: string
  apkFilename?: string
  iosHref?: string
}) => {
  const inner = (
    <div
      className="bg-gradient-to-r from-pink-500 to-red-600 rounded-lg px-3 py-2.5 md:px-4 md:py-3 flex items-center gap-2 text-white shadow-lg hover:opacity-90 transition-opacity"
      style={BUTTON_STYLE}
    >
      {type === 'ios' ? (
        <svg className="w-6 h-6 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
          <path d={APPLE_ICON_PATH} />
        </svg>
      ) : (
        <SiAndroid className="w-6 h-6 flex-shrink-0" />
      )}
      <div className="flex flex-col flex-1 min-w-0 justify-center">
        <p className="text-xs font-bold leading-[1.2] whitespace-nowrap">{label}</p>
      </div>
    </div>
  )

  if (type === 'android' && apkHref) {
    return (
      <a
        href={apkHref}
        download={apkFilename || true}
        rel="noopener"
        className="cursor-pointer android no-underline"
      >
        {inner}
      </a>
    )
  }

  if (type === 'ios' && iosHref) {
    // itms-services 必须同窗口跳,App Store / TestFlight 也是同窗口体验最佳
    return (
      <a
        href={iosHref}
        rel="noopener"
        className="cursor-pointer iphone no-underline"
      >
        {inner}
      </a>
    )
  }

  return (
    <button
      type="button"
      data-openinstall
      className={`cursor-pointer border-none bg-transparent ${type === 'ios' ? 'iphone' : 'android'}`}
    >
      {inner}
    </button>
  )
}

const OfficialCooperationButton = ({ link }: { link: string }) => (
  <div className="pointer-events-auto">
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-gray-900/80 backdrop-blur-sm text-white px-3 py-4 rounded-lg flex flex-col items-center gap-2 hover:bg-gray-800/90 transition-colors shadow-lg"
    >
      <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
      </svg>
      <span className="text-sm font-medium flex flex-col items-center leading-tight">
        <span>官</span>
        <span>方</span>
        <span>合</span>
        <span>作</span>
      </span>
    </a>
  </div>
)

export default function Home() {
  const { config, loaded } = useLandingConfig()
  const [isIOS, setIsIOS] = useState(false)
  const [isAndroid, setIsAndroid] = useState(false)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
    setIsIOS(/iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream)
    setIsAndroid(/android/i.test(userAgent))
  }, [])

  const downloadButtons = useMemo(() => {
    if (!isMounted) return null

    const iosBtn = config.downloadButtons.ios.enabled ? (
      <DownloadButton
        type="ios"
        label={config.downloadButtons.ios.label}
        iosHref={config.iosDownloadUrl || undefined}
      />
    ) : null
    const androidBtn = config.downloadButtons.android.enabled ? (
      <DownloadButton
        type="android"
        label={config.downloadButtons.android.label}
        apkHref={config.androidApkUrl || undefined}
        apkFilename={config.androidApkFilename || undefined}
      />
    ) : null

    if (!iosBtn && !androidBtn) return null

    if (isIOS) return iosBtn || androidBtn
    if (isAndroid) return androidBtn || iosBtn

    return (
      <>
        {iosBtn}
        {androidBtn}
      </>
    )
  }, [isMounted, isIOS, isAndroid, config])

  return (
    <main className="relative w-full h-screen overflow-hidden bg-black">
      <DynamicFavicon url={config.favicon} />
      <DynamicSEO seo={config.seo} />
      <div className="fixed inset-0 z-0 w-full h-full bg-black">
        {/*
          BackgroundVideo 永久静音(muted):
          - autoplay 必须 muted,否则浏览器拦截(Chrome/Safari 自动播放策略)
          - 落地页定位是"轻量首屏视频墙",不放静音切换按钮以保持 UI 干净
        */}
        <BackgroundVideo
          key={`m-${config.backgroundVideo}`}
          src={config.backgroundVideo}
          poster={config.backgroundVideoPoster}
          assetKey={config.assetAesKey}
          autoPlay
          loop
          playsInline
          muted
          className="lg:hidden w-full h-full object-cover"
          style={{
            objectFit: 'cover',
            objectPosition: 'center center',
          }}
        />

        <div className="hidden lg:flex absolute inset-0 items-center justify-center">
          <div className="relative h-full">
            <BackgroundVideo
              key={`pc-${config.backgroundVideo}`}
              src={config.backgroundVideo}
              poster={config.backgroundVideoPoster}
              assetKey={config.assetAesKey}
              autoPlay
              loop
              playsInline
              muted
              className="h-full w-auto object-contain"
              style={{
                maxHeight: '100vh',
              }}
            />

            {config.logo && (
              <div className="absolute top-4 left-4 z-40 pointer-events-none">
                <div className="pointer-events-auto">
                  <EncryptedImage
                    src={config.logo}
                    assetKey={config.assetAesKey}
                    alt="Logo"
                    className="h-16 w-16 object-contain"
                  />
                </div>
              </div>
            )}

            {config.telegramLink && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 z-40 pointer-events-none">
                <OfficialCooperationButton link={config.telegramLink} />
              </div>
            )}

          </div>
        </div>
      </div>

      {config.logo && (
        <header className="lg:hidden fixed top-0 left-0 z-40 p-4 pointer-events-none">
          <div className="pointer-events-auto">
            <EncryptedImage
              src={config.logo}
              assetKey={config.assetAesKey}
              alt="Logo"
              className="h-12 w-12 object-contain"
            />
          </div>
        </header>
      )}

      {config.telegramLink && (
        <div className="lg:hidden fixed right-4 top-1/2 -translate-y-1/2 z-40 pointer-events-none">
          <OfficialCooperationButton link={config.telegramLink} />
        </div>
      )}

      <footer className="fixed bottom-0 left-0 right-0 z-50 bg-transparent py-4 px-4 md:py-6 md:px-6">
        <div className="max-w-full mx-auto">
          <div className="text-center mb-4 md:mb-6">
            <h2 className="text-white text-lg md:text-2xl font-bold mb-1 md:mb-2 drop-shadow-lg">
              {config.vpnSection.title}
            </h2>
            <p className="text-white/90 text-sm md:text-base drop-shadow-md">
              {config.vpnSection.subtitle}
            </p>
          </div>

          {downloadButtons && (
            <div className="flex flex-row items-center justify-center gap-3 md:gap-4">
              {downloadButtons}
            </div>
          )}
        </div>
      </footer>

      {loaded && config.openInstallAppKey ? (
        <OpenInstallScript appKey={config.openInstallAppKey} />
      ) : null}
    </main>
  )
}
