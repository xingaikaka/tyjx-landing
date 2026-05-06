'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchPortalJson } from '@/lib/decryptApi'

/**
 * 视频/落地页诊断页面
 *
 * 在出问题的设备/浏览器里直接打开 https://<finalLanding>/debug/
 * 自动跑一系列检测,把每一步结果按时间戳输出。
 *
 * 用户点"复制"按钮 → 全部日志拷到剪贴板,发回来分析。
 *
 * 检测项:
 *   1. 设备 UA / Apple 判定 / MediaSource / crypto.subtle / canPlayType
 *   2. 拉 /api/portal/landing/config + 解密
 *   3. 单独探 m3u8 proxy / key / ts 三个端点的响应
 *   4. 用 hls.js 实试播,监听所有关键事件(MANIFEST_PARSED / ERROR / FRAG_LOADED 等)
 */

interface LogEntry {
  ts: number
  level: 'info' | 'ok' | 'warn' | 'error'
  msg: string
}

function fmt(ts: number) {
  const d = new Date(ts)
  return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function isAppleDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { platform?: string; vendor?: string; maxTouchPoints?: number }
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1) ||
    (typeof nav.vendor === 'string' && nav.vendor.indexOf('Apple') === 0)
  )
}

const ADMIN_BASE = (
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_ADMIN_BASE) ||
  ''
).replace(/\/+$/, '')

export default function DebugPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const startedRef = useRef(false)

  function log(level: LogEntry['level'], msg: string) {
    setLogs((prev) => [...prev, { ts: Date.now(), level, msg }])
  }

  async function runAll() {
    /* 1. 设备 / 环境 */
    log('info', '════ 1. 设备 / 环境 ════')
    log('info', `UA: ${navigator.userAgent}`)
    const nav = navigator as Navigator & { platform?: string; vendor?: string; maxTouchPoints?: number }
    log('info', `vendor: ${nav.vendor || '(empty)'}`)
    log('info', `platform: ${nav.platform || '(empty)'}`)
    log('info', `maxTouchPoints: ${nav.maxTouchPoints ?? '?'}`)
    log('info', `language: ${nav.language}`)
    log('info', `screen: ${window.screen.width}×${window.screen.height} dpr=${window.devicePixelRatio}`)
    log('info', `location: ${location.href}`)
    log('info', `protocol: ${location.protocol}`)
    log(isAppleDevice() ? 'ok' : 'info', `isAppleDevice: ${isAppleDevice()}`)
    log(window.MediaSource ? 'ok' : 'warn', `MediaSource: ${typeof window.MediaSource}`)
    log(window.crypto?.subtle ? 'ok' : 'error', `crypto.subtle: ${!!window.crypto?.subtle}`)
    log('info', `canPlayType('application/vnd.apple.mpegurl'): "${document.createElement('video').canPlayType('application/vnd.apple.mpegurl')}"`)
    log('info', `canPlayType('video/mp4; codecs="avc1.640028"'): "${document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"')}"`)

    /* 2. 拉 config */
    log('info', '════ 2. /api/portal/landing/config ════')
    const cfgUrl = `${ADMIN_BASE}/api/portal/landing/config?_=${Date.now()}`
    let bgVideo = ''
    let bgPoster = ''
    try {
      const t0 = Date.now()
      const json = await fetchPortalJson<{ ok?: boolean; data?: Record<string, unknown> }>(cfgUrl, {
        cache: 'no-cache',
      })
      log('ok', `config 拉取 + 解密成功 in ${Date.now() - t0}ms`)
      const d = (json.data || (json as Record<string, unknown>)) as Record<string, unknown>
      bgVideo = String(d.backgroundVideo || '')
      bgPoster = String(d.backgroundVideoPoster || '')
      log('info', `backgroundVideo: ${bgVideo}`)
      log('info', `backgroundVideoPoster: ${bgPoster}`)
    } catch (e) {
      log('error', `config 拉取/解密失败: ${(e as Error).message}`)
      return
    }

    if (!bgVideo) {
      log('warn', '没配 backgroundVideo,跳过视频检测')
      return
    }

    const vidMatch = bgVideo.match(/\/video-assets\/([0-9a-f]{30,40})\//i)
    if (!vidMatch) {
      log('error', `bgVideo 不含 video id: ${bgVideo}`)
      return
    }
    const vid = vidMatch[1]
    const proxyM3u8 = `${ADMIN_BASE}/api/portal/m3u8/${vid}`
    const keyUrl = `${ADMIN_BASE}/api/portal/video-key-raw/${vid}`

    /* 3. 探各端点 */
    log('info', '════ 3. 各端点连通性 ════')
    try {
      const t0 = Date.now()
      const r = await fetch(`${proxyM3u8}?_=${Date.now()}`, { cache: 'no-cache' })
      const txt = await r.text()
      log(r.ok ? 'ok' : 'error', `m3u8 proxy status=${r.status} in ${Date.now() - t0}ms`)
      log('info', `m3u8 内容(前 5 行):`)
      txt.split('\n').slice(0, 8).forEach((l) => log('info', `  ${l}`))
    } catch (e) {
      log('error', `m3u8 proxy 失败: ${(e as Error).message}`)
    }
    try {
      const t0 = Date.now()
      const r = await fetch(`${keyUrl}?_=${Date.now()}`, { cache: 'no-cache' })
      const buf = await r.arrayBuffer()
      log(r.ok && buf.byteLength === 16 ? 'ok' : 'error', `key status=${r.status} bytes=${buf.byteLength} in ${Date.now() - t0}ms`)
    } catch (e) {
      log('error', `key 失败: ${(e as Error).message}`)
    }
    /* poster 也试一下 */
    if (bgPoster) {
      try {
        const t0 = Date.now()
        const r = await fetch(`${bgPoster}?_=${Date.now()}`, { cache: 'no-cache' })
        const buf = await r.arrayBuffer()
        log(r.ok ? 'ok' : 'error', `poster status=${r.status} bytes=${buf.byteLength} in ${Date.now() - t0}ms`)
      } catch (e) {
        log('error', `poster 失败: ${(e as Error).message}`)
      }
    }

    /* 4. 实播 hls.js */
    log('info', '════ 4. hls.js 实播 ════')
    type HlsCtor = {
      new (cfg: Record<string, unknown>): {
        loadSource: (u: string) => void
        attachMedia: (v: HTMLMediaElement) => void
        on: (e: string, cb: (...a: unknown[]) => void) => void
        destroy: () => void
      }
      isSupported: () => boolean
      Events: Record<string, string>
    }
    let HlsCls: HlsCtor
    try {
      const mod = await import('hls.js')
      HlsCls = mod.default as unknown as HlsCtor
      log('ok', `hls.js loaded, isSupported=${HlsCls.isSupported()}`)
    } catch (e) {
      log('error', `hls.js 加载失败: ${(e as Error).message}`)
      return
    }
    if (!HlsCls.isSupported()) {
      log('warn', 'hls.js 当前环境不支持(无 MSE),无法继续')
      return
    }

    const v = document.getElementById('debug-video') as HTMLVideoElement | null
    if (!v) {
      log('error', '找不到 video 元素')
      return
    }
    const hls = new HlsCls({
      enableWorker: true,
      lowLatencyMode: false,
      fragLoadingMaxRetry: 2,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
    })
    const E = HlsCls.Events
    const interesting = [
      'MEDIA_ATTACHED',
      'MANIFEST_LOADING',
      'MANIFEST_LOADED',
      'MANIFEST_PARSED',
      'LEVEL_LOADING',
      'LEVEL_LOADED',
      'KEY_LOADING',
      'KEY_LOADED',
      'FRAG_LOADING',
      'FRAG_LOADED',
      'BUFFER_APPENDING',
      'BUFFER_APPENDED',
      'ERROR',
    ]
    interesting.forEach((evName) => {
      const evKey = E[evName]
      if (!evKey) return
      hls.on(evKey, (...args: unknown[]) => {
        if (evName === 'ERROR') {
          const d = args[1] as { fatal?: boolean; type?: string; details?: string; reason?: string; url?: string }
          log(d?.fatal ? 'error' : 'warn', `[hls] ERROR fatal=${d?.fatal} type=${d?.type} details=${d?.details} url=${d?.url || ''} reason=${d?.reason || ''}`)
        } else {
          log('info', `[hls] ${evName}`)
        }
      })
    })
    v.addEventListener('error', () => {
      const e = v.error
      log('error', `[video.error] code=${e?.code} message=${e?.message}`)
    })
    v.addEventListener('playing', () => log('ok', `[video] playing currentTime=${v.currentTime.toFixed(2)}`))
    v.addEventListener('stalled', () => log('warn', `[video] stalled`))
    v.addEventListener('waiting', () => log('warn', `[video] waiting`))
    hls.loadSource(proxyM3u8)
    hls.attachMedia(v)
    log('info', `hls.loadSource(${proxyM3u8})`)
    v.play().then(() => log('ok', 'video.play() resolved')).catch((e) => log('warn', `video.play() rejected: ${e?.name} ${e?.message}`))

    /* 5/10/20 秒分别打一次状态(不 destroy hls,持续播以暴露后续问题) */
    const snapshot = (label: string) => {
      log('info', `════ ${label} 状态 ════`)
      log('info', `video.currentTime: ${v.currentTime.toFixed(2)}`)
      log('info', `video.readyState: ${v.readyState}`)
      log('info', `video.paused: ${v.paused}`)
      log('info', `video.error: ${v.error ? `code=${v.error.code}` : 'null'}`)
      log('info', `video.buffered.length: ${v.buffered.length}`)
      if (v.buffered.length > 0) {
        log('info', `  buffered[0]: ${v.buffered.start(0).toFixed(2)} → ${v.buffered.end(0).toFixed(2)}`)
      }
    }
    setTimeout(() => snapshot('5s'), 5000)
    setTimeout(() => snapshot('15s'), 15000)
    setTimeout(() => snapshot('30s'), 30000)
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    setRunning(true)
    runAll().finally(() => setRunning(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function copyAll() {
    const text = logs.map((l) => `[${fmt(l.ts)}] ${l.level.toUpperCase().padEnd(5)} ${l.msg}`).join('\n')

    /* 1. 优先 navigator.clipboard */
    const tryClipboard = async () => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
      return false
    }
    /* 2. fallback: textarea + execCommand */
    const tryExecCmd = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch {
        return false
      }
    }
    tryClipboard()
      .then((ok) => {
        if (ok || tryExecCmd()) {
          setCopyState('ok')
          setTimeout(() => setCopyState('idle'), 1500)
        } else {
          setCopyState('fail')
        }
      })
      .catch(() => {
        if (tryExecCmd()) {
          setCopyState('ok')
          setTimeout(() => setCopyState('idle'), 1500)
        } else {
          setCopyState('fail')
        }
      })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0d0d10',
        color: '#ddd',
        fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
        fontSize: 12,
        padding: 12,
        lineHeight: 1.5,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          background: '#16151B',
          padding: '8px 0',
          marginBottom: 8,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          borderBottom: '1px solid #333',
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          落地页诊断 {running ? '(运行中…)' : '(完成)'}
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={copyAll}
          style={{
            border: 'none',
            background: copyState === 'ok' ? '#0a0' : copyState === 'fail' ? '#a00' : '#f70',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {copyState === 'ok' ? '已复制 ✓' : copyState === 'fail' ? '复制失败,长按选择' : '复制全部日志'}
        </button>
      </div>

      <div>
        {logs.map((l, i) => (
          <div
            key={i}
            style={{
              color:
                l.level === 'error' ? '#ff6b6b' :
                l.level === 'warn' ? '#ffd166' :
                l.level === 'ok' ? '#06d6a0' :
                '#bbb',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            <span style={{ color: '#666' }}>[{fmt(l.ts)}]</span>{' '}
            <span>{l.msg}</span>
          </div>
        ))}
      </div>

      {/* 实际试播的 video(autoPlay muted playsInline,bdr 边框便于观察) */}
      <video
        id="debug-video"
        autoPlay
        muted
        playsInline
        crossOrigin="anonymous"
        style={{
          marginTop: 16,
          width: '100%',
          maxWidth: 480,
          border: '1px dashed #444',
          background: '#000',
        }}
      />
    </div>
  )
}
