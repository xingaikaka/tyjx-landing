'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_LANDING_CONFIG, LandingConfig } from '@/config/types'
import { fetchPortalJson } from '@/lib/decryptApi'

/**
 * 拉真落地页配置(客户端):
 *
 *   1. SSR 之外的首次渲染:用 localStorage 缓存 ↦ 立刻拿到上次的配置(零闪烁)
 *   2. 同时后台 fetch 最新配置 ↦ 写回 cache + setState
 *   3. 失败:保持 DEFAULT_LANDING_CONFIG
 *
 * 配置端点:
 *   - 默认: 同源 /api/portal/landing/config (由 nginx 反代到 admin-server)
 *   - 可被 NEXT_PUBLIC_LANDING_CONFIG_URL 覆盖
 *
 * 注意:不阻塞首屏渲染。组件先用默认值/缓存渲染,DOM 出来之后再 hydrate 真实值。
 */

const CACHE_KEY = 'tyjx_landing_cfg_v1'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 分钟

// dev 时 NEXT_PUBLIC_ADMIN_BASE=http://localhost:3010 跨端口拿,
// prod 留空走相对路径,由 nginx 反代 /api/portal 到 admin-server。
const ADMIN_BASE = (
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_ADMIN_BASE) ||
  ''
).replace(/\/+$/, '')

const ENDPOINT =
  (typeof process !== 'undefined' &&
    process.env &&
    process.env.NEXT_PUBLIC_LANDING_CONFIG_URL) ||
  `${ADMIN_BASE}/api/portal/landing/config`

interface CacheEntry {
  ts: number
  data: LandingConfig
}

function readCache(): LandingConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw) as CacheEntry
    if (!obj || !obj.data) return null
    if (Date.now() - obj.ts > CACHE_TTL_MS) return null
    return mergeWithDefault(obj.data)
  } catch {
    return null
  }
}

function writeCache(data: LandingConfig) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data })
    )
  } catch {
    /* quota / private mode → 忽略 */
  }
}

/**
 * 与默认值做合并,确保新加字段也有兜底。
 *
 * 浅合并即可处理 string / boolean 字段(`undefined` 走 default,空串"=后台明确清空"
 * 会保持空 → 落地页不渲染对应元素,这是预期)。嵌套对象需要深合并避免覆盖丢字段。
 *
 * `openInstallAppKey` 历史上用 `||`(空串走默认),保留以兼容老数据。
 */
function mergeWithDefault(c: Partial<LandingConfig>): LandingConfig {
  return {
    ...DEFAULT_LANDING_CONFIG,
    ...c,
    openInstallAppKey:
      c?.openInstallAppKey || DEFAULT_LANDING_CONFIG.openInstallAppKey,
    seo: {
      ...DEFAULT_LANDING_CONFIG.seo,
      ...(c?.seo || {}),
    },
    downloadButtons: {
      ios: {
        ...DEFAULT_LANDING_CONFIG.downloadButtons.ios,
        ...(c?.downloadButtons?.ios || {}),
      },
      android: {
        ...DEFAULT_LANDING_CONFIG.downloadButtons.android,
        ...(c?.downloadButtons?.android || {}),
      },
    },
    vpnSection: {
      ...DEFAULT_LANDING_CONFIG.vpnSection,
      ...(c?.vpnSection || {}),
    },
  }
}

export function useLandingConfig(): {
  config: LandingConfig
  loaded: boolean
} {
  const [config, setConfig] = useState<LandingConfig>(DEFAULT_LANDING_CONFIG)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const cached = readCache()
    if (cached) {
      setConfig(cached)
      setLoaded(true)
    }

    let aborted = false
    ;(async () => {
      try {
        // fetchPortalJson 自动识别 {e:"..."} 加密包并解密(对齐 dp apiDecrypt)
        const json = await fetchPortalJson<{
          ok: boolean
          data?: Partial<LandingConfig>
        }>(ENDPOINT, {
          headers: { Accept: 'application/json' },
          cache: 'no-cache',
        })
        const fresh = mergeWithDefault(json?.data || (json as any) || {})
        if (aborted) return
        setConfig(fresh)
        setLoaded(true)
        writeCache(fresh)
      } catch (e) {
        if (!loaded && !aborted) {
          // 没有缓存也拉不到 → 用默认值,但仍标 loaded(避免组件一直当未加载)
          setLoaded(true)
        }
        // eslint-disable-next-line no-console
        console.warn('[landing] config fetch fail, using default', e)
      }
    })()

    return () => {
      aborted = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { config, loaded }
}
