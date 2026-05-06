/**
 * 主页内嵌 debug 总线:?dbg=1 启用
 *
 * BackgroundVideo / EncryptedImage 等组件把关键事件 push 到这里。
 * DebugOverlay 监听 dbgBus,实时渲染日志 + 提供复制按钮。
 *
 * 默认禁用(isDebug=false),组件里调用 dbgPush 是个 no-op,生产链路零开销。
 */

export interface DbgEntry {
  ts: number
  src: string // 来源标签,如 'BgVideo[m]' / 'BgVideo[pc]' / 'EncImg' / 'page'
  level: 'info' | 'ok' | 'warn' | 'error'
  msg: string
}

type Listener = (entry: DbgEntry) => void

const listeners = new Set<Listener>()
const buffer: DbgEntry[] = []
const MAX_BUFFER = 500

let enabled: boolean | null = null

export function isDbgEnabled(): boolean {
  if (enabled !== null) return enabled
  if (typeof window === 'undefined') return false
  try {
    const sp = new URLSearchParams(window.location.search)
    enabled = sp.get('dbg') === '1' || sp.get('debug') === '1'
  } catch {
    enabled = false
  }
  return enabled
}

export function dbgPush(src: string, level: DbgEntry['level'], msg: string) {
  if (!isDbgEnabled()) return
  const entry: DbgEntry = { ts: Date.now(), src, level, msg }
  buffer.push(entry)
  if (buffer.length > MAX_BUFFER) buffer.shift()
  listeners.forEach((l) => {
    try { l(entry) } catch { /* noop */ }
  })
}

export function dbgSubscribe(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function dbgGetAll(): DbgEntry[] {
  return buffer.slice()
}

/**
 * 把 <video> 元素的关键事件桥接到 dbgBus
 *
 * 仅在 ?dbg=1 时挂事件,否则直接 return no-op cleanup,无副作用。
 *
 * @returns cleanup 函数(组件卸载时调用)
 */
export function attachVideoDebug(video: HTMLVideoElement, tag: string): () => void {
  if (!isDbgEnabled()) return () => { /* noop */ }
  const events = [
    'loadstart', 'loadedmetadata', 'loadeddata',
    'canplay', 'canplaythrough', 'play', 'playing', 'pause',
    'waiting', 'stalled', 'suspend', 'abort',
    'ended', 'emptied', 'ratechange', 'seeking', 'seeked',
    'volumechange', 'error',
  ] as const
  const onAny = (ev: Event) => {
    if (ev.type === 'error') {
      const e = video.error
      dbgPush(tag, 'error', `video error code=${e?.code} msg=${e?.message}`)
      return
    }
    const lvl: DbgEntry['level'] =
      ev.type === 'waiting' || ev.type === 'stalled' || ev.type === 'suspend' ? 'warn' : 'info'
    dbgPush(tag, lvl, `video ${ev.type} t=${video.currentTime.toFixed(2)} ready=${video.readyState}`)
  }
  events.forEach((evt) => video.addEventListener(evt, onAny))
  return () => events.forEach((evt) => video.removeEventListener(evt, onAny))
}

/**
 * 把 hls.js 实例的关键事件桥接到 dbgBus
 *
 * 仅在 ?dbg=1 时挂事件,否则直接 return,无副作用。
 *
 * 用 any 是因为外部不引入 hls.js 类型(动态 import),只为 dbg 用途容忍。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attachHlsDebug(hls: any, Events: Record<string, string>, tag: string): void {
  if (!isDbgEnabled()) return
  const interesting = [
    'MEDIA_ATTACHED', 'MANIFEST_LOADING', 'MANIFEST_LOADED', 'MANIFEST_PARSED',
    'LEVEL_LOADING', 'LEVEL_LOADED', 'KEY_LOADING', 'KEY_LOADED',
    'FRAG_LOADING', 'FRAG_LOADED', 'BUFFER_APPENDED',
    'BUFFER_FLUSHING', 'BUFFER_FLUSHED', 'BUFFER_EOS',
    'ERROR',
  ]
  interesting.forEach((evName) => {
    const evKey = Events[evName]
    if (!evKey) return
    hls.on(evKey, (...args: unknown[]) => {
      if (evName === 'ERROR') {
        const d = args[1] as { fatal?: boolean; type?: string; details?: string; url?: string }
        dbgPush(tag, d?.fatal ? 'error' : 'warn', `hls ERROR fatal=${d?.fatal} type=${d?.type} details=${d?.details} url=${d?.url || ''}`)
      } else {
        dbgPush(tag, 'info', `hls ${evName}`)
      }
    })
  })
}
