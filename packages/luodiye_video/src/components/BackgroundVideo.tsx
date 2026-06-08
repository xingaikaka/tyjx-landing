'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { decryptAssetUrl } from '@/lib/decryptAsset'

/**
 * 背景视频(只支持 AES-128 加密 HLS)
 *
 * 设计决策:落地页只播 m3u8,不播 mp4/webm。
 *   原因 ① CDN 上的 ts 全部是 AES-128 密文,源素材不可被直接 curl 下载盗用
 *        ② key 经服务端鉴权分发,Origin 限定,无法被竞品爬走
 *        ③ 统一一条播放路径,iOS/Safari/Chrome/Android WebView 行为一致
 *
 * 两条播放路径(都先把 R2 m3u8 URL 转为 admin 同源代理):
 *   - iOS / Safari       原生 HLS,直接 video.src = 代理 m3u8
 *   - 其他浏览器          动态 import hls.js,喂代理 m3u8
 *
 * 配置 backgroundVideo 不是 m3u8 时:不渲染,只显示 poster(避免黑屏)。
 *
 * hls.js 用动态 import,只在真去拉 m3u8 时才下载(~50KB gzip)。
 */

interface Props extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'poster'> {
  src: string
  /** 加密的 poster URL(.enc) */
  poster?: string
  /** 解密 key,空时不解密 poster(显示纯黑) */
  assetKey?: string
}

const FAKE_KEY_HOST = 'https://key.noaccess.invalid'
const FAKE_KEY_PREFIX = `${FAKE_KEY_HOST}/video-key/`

/** 32-hex 视频 id 模式 */
const VIDEO_ID_RE = /\/video-assets\/([0-9a-f]{30,40})\//i

// 与 useLandingConfig 同款:dev 跨端口走绝对 URL,prod 走相对(nginx 反代)
const ADMIN_BASE = (
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_ADMIN_BASE) ||
  ''
).replace(/\/+$/, '')

function adminPortal(path: string) {
  return `${ADMIN_BASE}${path}`
}

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url)
}

/**
 * 把 R2/CDN 上的 m3u8 URL 转成 admin 代理 URL
 * 例:
 *   https://tyjx.calculus.xin/tyjx/video-assets/abc123.../index.m3u8
 *   →  /api/portal/m3u8/abc123...    (prod,nginx 反代)
 *   →  http://localhost:3010/api/portal/m3u8/abc123...   (dev)
 *
 * 拿不到 id 时返回原 URL(降级:浏览器拉到的 m3u8 里 KEY URI 是假地址,
 * 但 hls.js 的 xhrSetup 还能拦下来重定向到真接口;Safari 原生 HLS 则会失败)。
 */
function toProxyM3u8(url: string): string {
  const m = url.match(VIDEO_ID_RE)
  if (!m) return url
  return adminPortal(`/api/portal/m3u8/${m[1]}`)
}

const BackgroundVideo = forwardRef<HTMLVideoElement, Props>(function BackgroundVideo(
  { src, poster, assetKey, ...rest },
  ref
) {
  const innerRef = useRef<HTMLVideoElement>(null)
  // poster 是加密的 .enc,先解密成 blob URL 再喂给 <video poster>
  const [posterBlob, setPosterBlob] = useState('')

  useEffect(() => {
    if (typeof ref === 'function') ref(innerRef.current)
    else if (ref) (ref as React.MutableRefObject<HTMLVideoElement | null>).current = innerRef.current
  }, [ref])

  useEffect(() => {
    let cancelled = false
    setPosterBlob('')
    if (!poster) return
    // 历史明文 poster(URL 不带 .enc)直接用,不解密
    if (!/\.enc(\?|$|#)/i.test(poster)) {
      setPosterBlob(poster)
      return
    }
    if (!assetKey) return
    decryptAssetUrl(poster, assetKey)
      .then((u) => { if (!cancelled) setPosterBlob(u) })
      .catch((e) => {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('[bg-video] poster decrypt fail, fallback raw:', e?.message ?? e)
        // 解密失败兜底:也直接用原 URL(可能是历史明文残留)
        setPosterBlob(poster)
      })
    return () => { cancelled = true }
  }, [poster, assetKey])

  useEffect(() => {
    const video = innerRef.current
    if (!video || !src) return

    // 不是 m3u8 就不挂 src,只让 poster 顶住,避免 mp4/webm 直链产生
    // 未授权的明文播放(也防 4xx 黑屏)。
    if (!isHls(src)) {
      // eslint-disable-next-line no-console
      console.warn('[bg-video] 仅支持 m3u8(加密 HLS),已忽略非 HLS 源:', src)
      return
    }

    const cleanup: Array<() => void> = []
    let cancelled = false

    const playUrl = toProxyM3u8(src)

    // Safari / iOS 原生支持 HLS:canPlayType 返回 'maybe' / 'probably'
    const native = video.canPlayType('application/vnd.apple.mpegurl')
    if (native) {
      // 原生 HLS 需要的是改写过 KEY URI 的真 m3u8 → 走代理
      video.src = playUrl
    } else {
      // 动态加载 hls.js
      ;(async () => {
        try {
          const Hls = (await import('hls.js')).default
          if (cancelled) return
          if (!Hls.isSupported()) {
            // 极端 fallback:浏览器既无 native HLS 又跑不了 hls.js,直挂代理 m3u8
            // (大概率播不了,但至少不会冒错误日志)
            video.src = playUrl
            return
          }
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,

            // ─── KEY URI 兜底改写 ───
            // 代理 m3u8 已经把 KEY URI 写成 /api/portal/video-key-raw/<id>,
            // hls.js 默认 keyloader 直接 GET 就行。
            // xhrSetup 只在"代理失效 / m3u8 直链 R2"时兜底:
            // 看到假 URI 就改写为真接口,跟 dp/HlsVideo.tsx 同款。
            xhrSetup: (xhr: XMLHttpRequest, url: string) => {
              if (typeof url === 'string' && url.indexOf(FAKE_KEY_PREFIX) === 0) {
                const vid = url.substring(FAKE_KEY_PREFIX.length)
                xhr.open('GET', adminPortal(`/api/portal/video-key-raw/${vid}`), true)
              }
            },

            // ─── 老 WebView (vivo / 360 / UC) 容错 ───
            // 加密 HLS 首段 PTS 通常 != 0(常见 1.4s / 0.92s),
            // currentTime=0 会落在 buffered 区间外卡死,放宽容差 + 自动 nudge
            maxBufferHole: 0.5,
            highBufferWatchdogPeriod: 2,
            nudgeOffset: 0.2,
            nudgeMaxRetry: 5,
            maxFragLookUpTolerance: 0.5,
            fragLoadingMaxRetry: 4,
            manifestLoadingMaxRetry: 4,
            levelLoadingMaxRetry: 4,
          } as any)
          hls.loadSource(playUrl)
          hls.attachMedia(video)
          cleanup.push(() => hls.destroy())
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[bg-video] hls.js load failed, fallback to native', e)
          video.src = playUrl
        }
      })()
    }

    return () => {
      cancelled = true
      cleanup.forEach((fn) => {
        try {
          fn()
        } catch {
          /* noop */
        }
      })
      try {
        video.pause()
        video.removeAttribute('src')
        video.load()
      } catch {
        /* noop */
      }
    }
  }, [src])

  return (
    <video
      ref={innerRef}
      poster={posterBlob || undefined}
      {...rest}
    />
  )
})

export default BackgroundVideo
