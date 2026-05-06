'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { decryptAssetUrl } from '@/lib/decryptAsset'
import { attachHlsDebug, attachVideoDebug, dbgPush } from '@/lib/dbgBus'

/**
 * 背景视频:加密 HLS 播放器
 *
 * 视觉结构:
 *   <wrapper>
 *     ├ <video>          ← MSE / 原生 HLS 解码层
 *     ├ <img poster>     ← video 出帧前顶住,出帧后淡出(避免"格式不支持"图标)
 *     └ <div mask>       ← 透明触摸蒙层,吃掉点击/触摸,防国产浏览器接管成全屏
 *
 * 设备路由:
 *   - Apple 设备(iOS Safari / iPadOS / Mac Safari):video.src = m3u8 走原生 HLS
 *   - 其他全部(Android 国产浏览器、桌面 Chrome 等):hls.js + MSE
 *
 * 注意:页面只能挂载一个 BackgroundVideo,Android 国产浏览器有"同一时刻只允许
 * 一个 video 处于 playing 状态"的潜规则,后启动会 pause 先启动的(在 page.tsx
 * 里通过 isDesktop 条件渲染单实例解决)。
 */

interface Props extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'poster'> {
  src: string
  /** 加密 poster URL(.enc),非加密则原样作为 <img src=> */
  poster?: string
  /** 解密 key(hex),空时不解密 poster */
  assetKey?: string
}

const VIDEO_ID_RE = /\/video-assets\/([0-9a-f]{30,40})\//i

const ADMIN_BASE = (
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_ADMIN_BASE) ||
  ''
).replace(/\/+$/, '')

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url)
}

/**
 * Apple 设备识别 — 只有它们才信任 video.canPlayType('application/vnd.apple.mpegurl')。
 *
 * Android 国产浏览器(华为/荣耀 / OPPO / vivo / 小米)对 .m3u8 也返回 'maybe',浏览器
 * 自以为懂 HLS,但**只懂明文 HLS,不懂 AES-128 加密 HLS**(没内置 keyloader)→ 直接
 * 喂会报"格式不支持"。所以 Android 强制走 hls.js(JS keyloader + decrypt)。
 */
function isAppleDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { platform?: string; vendor?: string; maxTouchPoints?: number }
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1) ||
    (typeof nav.vendor === 'string' && nav.vendor.indexOf('Apple') === 0)
  )
}

/**
 * 防国产浏览器接管 video 的内联属性 — 必须 SSR 直出在 JSX 上,水合后再 setAttribute
 * 已经被 X5/T7/UC 识别成"独立播放器"接管了。
 *
 * - webkit-playsinline / x5-playsinline:微信 X5 内核
 * - x5-video-player-type=h5-page:不接管(h5 = 强制全屏,要避免)
 * - x5-video-player-fullscreen=false:阻止 X5 自动全屏
 * - t7-video-player-type=inline:UC 内核
 * - x-webkit-airplay=allow:iOS Safari AirPlay
 * - controls360=no:360 浏览器禁用内置控件接管
 */
const inlinePlaybackAttrs = {
  'webkit-playsinline': '',
  'x5-video-player-type': 'h5-page',
  'x5-video-player-fullscreen': 'false',
  'x5-playsinline': '',
  't7-video-player-type': 'inline',
  'x-webkit-airplay': 'allow',
  controls360: 'no',
} as Record<string, string>

/** R2/CDN m3u8 URL → admin 同源代理(代理会把 KEY URI 改写为绝对地址) */
function toProxyM3u8(url: string): string {
  const m = url.match(VIDEO_ID_RE)
  if (!m) return url
  return `${ADMIN_BASE}/api/portal/m3u8/${m[1]}`
}

const HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  maxBufferHole: 0.5,
  nudgeOffset: 0.2,
  nudgeMaxRetry: 5,
  fragLoadingMaxRetry: 4,
  manifestLoadingMaxRetry: 4,
  levelLoadingMaxRetry: 4,
} as const

const BackgroundVideo = forwardRef<HTMLVideoElement, Props>(function BackgroundVideo(
  { src, poster, assetKey, className, style, ...rest },
  ref
) {
  const innerRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<{ destroy: () => void } | null>(null)
  const [posterBlob, setPosterBlob] = useState('')
  const [videoPlaying, setVideoPlaying] = useState(false)

  // 暴露内部 video ref 给父组件
  useEffect(() => {
    if (typeof ref === 'function') ref(innerRef.current)
    else if (ref) (ref as React.MutableRefObject<HTMLVideoElement | null>).current = innerRef.current
  }, [ref])

  /* poster 解密(独立于 video,提前出图) */
  useEffect(() => {
    setPosterBlob('')
    if (!poster) return
    if (!/\.enc(\?|$|#)/i.test(poster)) {
      setPosterBlob(poster)
      return
    }
    if (!assetKey) return
    let cancelled = false
    decryptAssetUrl(poster, assetKey)
      .then((u) => { if (!cancelled) setPosterBlob(u) })
      .catch(() => { if (!cancelled) setPosterBlob(poster) })
    return () => { cancelled = true }
  }, [poster, assetKey])

  /* 视频播放 */
  useEffect(() => {
    const video = innerRef.current
    if (!video || !src || !isHls(src)) return

    setVideoPlaying(false)
    let destroyed = false

    /* poster → video 淡出探测:
     *   优先 rVFC(浏览器把帧推到合成器后回调,时机最准,无闪烁)
     *   fallback playing 事件(rVFC 不可用时立即淡出)
     */
    let faded = false
    const fadeOnce = () => {
      if (faded || destroyed) return
      faded = true
      setVideoPlaying(true)
    }
    const onPlaying = () => {
      type V = HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { presentedFrames?: number }) => void) => void
      }
      const v = video as V
      if (typeof v.requestVideoFrameCallback === 'function') {
        v.requestVideoFrameCallback((_now, meta) => {
          if ((meta?.presentedFrames ?? 0) > 0) fadeOnce()
        })
      } else {
        fadeOnce()
      }
    }
    video.addEventListener('playing', onPlaying)

    /* dbg 桥接(?dbg=1 才挂,否则 no-op) */
    const dbgTag = 'BgVid'
    const detachVideoDbg = attachVideoDebug(video, dbgTag)
    dbgPush(dbgTag, 'info', `mount src=${src}`)

    const playUrl = toProxyM3u8(src)
    const useNativeHls = isAppleDevice() && video.canPlayType('application/vnd.apple.mpegurl') !== ''

    if (useNativeHls) {
      video.src = playUrl
      video.play().catch(() => { /* 极少触发,muted+playsInline+autoPlay 时基本必过 */ })
    } else {
      // Android 全家桶 + 桌面 Chrome:hls.js + MSE
      ;(async () => {
        try {
          const { default: Hls } = await import('hls.js')
          if (destroyed) return
          if (!Hls.isSupported()) {
            video.src = playUrl
            return
          }
          const hls = new Hls(HLS_CONFIG)
          hlsRef.current = hls
          attachHlsDebug(hls, Hls.Events, dbgTag)
          hls.loadSource(playUrl)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play()
              .then(() => dbgPush(dbgTag, 'ok', 'play() resolved'))
              .catch((e: Error) => dbgPush(dbgTag, 'warn', `play() rejected: ${e.name} ${e.message}`))
          })
          hls.on(Hls.Events.ERROR, (_e, d) => {
            if (d?.fatal) {
              dbgPush(dbgTag, 'error', 'fatal → destroy hls')
              try { hls.destroy() } catch { /* noop */ }
              hlsRef.current = null
            }
          })
        } catch (e) {
          // hls.js 加载失败 — poster 永远叠在 video 之上,自然兜底
          dbgPush(dbgTag, 'error', `hls.js import fail: ${(e as Error).message}`)
        }
      })()
    }

    return () => {
      destroyed = true
      video.removeEventListener('playing', onPlaying)
      detachVideoDbg()
      try { hlsRef.current?.destroy() } catch { /* noop */ }
      hlsRef.current = null
      try {
        video.pause()
        video.removeAttribute('src')
        video.load()
      } catch { /* noop */ }
    }
  }, [src])

  // src 切换时立刻把 poster 复位顶住,避免旧帧残留
  useEffect(() => { setVideoPlaying(false) }, [src])

  // 从父级 style 取 objectFit/Position(PC contain / 移动 cover),video + poster 共用
  const objectFit = (style as React.CSSProperties | undefined)?.objectFit ?? 'cover'
  const objectPosition = (style as React.CSSProperties | undefined)?.objectPosition ?? 'center'

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#000',
        ...style,
      }}
    >
      <video
        ref={innerRef}
        playsInline
        crossOrigin="anonymous"
        disablePictureInPicture
        disableRemotePlayback
        controls={false}
        tabIndex={-1}
        aria-hidden="true"
        {...inlinePlaybackAttrs}
        {...rest}
        style={{
          width: '100%',
          height: '100%',
          objectFit,
          objectPosition,
          display: 'block',
          background: '#000',
          // 阻止用户触摸 video 元素本身,防点击劫持成全屏播放器
          pointerEvents: 'none',
        }}
      />

      {posterBlob && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterBlob}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit,
            objectPosition,
            opacity: videoPlaying ? 0 : 1,
            transition: 'opacity 0.18s linear',
            pointerEvents: 'none',
            zIndex: 2,
            // 强制独立合成层,避免与 video 抢 paint 资源造成抖动
            willChange: 'opacity',
            transform: 'translateZ(0)',
          }}
        />
      )}

      {/* 透明触摸蒙层 — 双重保险吃掉所有点击/触摸,防国产浏览器在用户点击时
          把 video 接管成全屏播放器 */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 3,
          background: 'transparent',
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.preventDefault()}
        onTouchStart={(e) => e.preventDefault()}
      />
    </div>
  )
})

export default BackgroundVideo
