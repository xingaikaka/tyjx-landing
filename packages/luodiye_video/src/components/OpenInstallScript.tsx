'use client'

import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    OpenInstall?: any
  }
}

interface OpenInstallScriptProps {
  appKey?: string
}

// ── 情况A:SDK 就绪 → wakeup,800ms 内没跳走 → location.href 兜底地址 ──
function callWakeup(oi: any, fallbackHref: string) {
  try {
    oi.wakeupOrInstall()
  } catch { /* noop */ }
  // ── 临时去掉兜底：只走 OpenInstall，不再 800ms location.href 抢跑 ──
  // setTimeout(() => {
  //   if (document.visibilityState === 'visible' && fallbackHref) {
  //     window.location.href = fallbackHref
  //   }
  // }, 800)
  void fallbackHref
}

// ── 情况B:SDK 未就绪 → 手势内先用 scheme 尝试唤起已装App,1.2s 无响应再兜底 ──
// SDK 实例还没创建,wakeupOrInstall() 调不出来;但用户点击的"手势"还在,
// 此刻用 scheme 仍能唤起已装 App(装了的直接进App,没装的浏览器无响应/弹窗)。
// 1.2s 后页面仍在前台 = 没唤起成功 → location.href 跳兜底下载地址。
function callSchemeWakeup(scheme: string, fallbackHref: string) {
  let left = false
  const onLeave = () => { left = true }
  document.addEventListener('visibilitychange', onLeave, { once: true })
  window.addEventListener('pagehide', onLeave, { once: true })
  try {
    window.location.href = scheme
  } catch { /* noop */ }
  // ── 临时去掉兜底：1.2s 后不再 location.href 跳下载，只保留 scheme 唤起 ──
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onLeave)
    window.removeEventListener('pagehide', onLeave)
    // if (!left && document.visibilityState === 'visible' && fallbackHref) {
    //   window.location.href = fallbackHref
    // }
  }, 1200)
  void left
  void fallbackHref
}

/**
 * OpenInstall SDK 集成
 *
 * 点击逻辑（OpenInstall 优先,确实不行才兜底）：
 *
 * 情况A — SDK 已就绪（oiRef 有实例）:
 *    preventDefault → wakeupOrInstall()（打点统计 + 唤起已装App）
 *    → 800ms 仍在前台 = 没起作用 → location.href 跳兜底下载地址
 *
 * 情况B — SDK 未就绪（onready 偶发卡 5s 的降级期,oiRef 为空,wakeup 调不出来）:
 *    preventDefault → 手势内用 scheme(appKey://) 尝试唤起已装App
 *    → 1.2s 仍在前台 = 没唤起 → location.href 跳兜底下载地址
 *    （既尽量唤起App,又不傻等 5s,避免"点了没反应/点好几下"）
 *
 * 说明：访问/渠道统计在 SDK 初始化(new OpenInstall)时已上报,
 *      情况B 即使走兜底,统计也不丢,丢的只是这一次点击的唤起事件。
 *
 * click 用 document 级事件委托,按钮 re-render 后也不会丢监听。
 */
export default function OpenInstallScript({ appKey = 'ecedok' }: OpenInstallScriptProps) {
  const oiRef = useRef<any>(null)

  useEffect(() => {
    // ── document 级 click 委托（onready 之前也生效）──────────────
    const handleClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('[data-openinstall]')
      if (!btn) return
      // 按钮自身带的兜底 href（iOS 按钮是 <a href=...>）
      const fallbackHref = btn.getAttribute('href') || ''
      if (oiRef.current) {
        // 情况A SDK 就绪：拦截原生跳转,先 wakeup(统计+唤起已装App),没跳再兜底 href
        e.preventDefault()
        callWakeup(oiRef.current, fallbackHref)
      } else {
        // 情况B SDK 没 ready：手势内用 scheme 尝试唤起已装App,1.2s 无响应再兜底
        e.preventDefault()
        callSchemeWakeup(`${appKey}://`, fallbackHref)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const existingScript = document.querySelector(`script[src*="openinstall-${appKey}"]`)
    if (existingScript) return

    // 预热 OpenInstall 各域名:提前 DNS 解析 + 建连,降低 onready 首次超时概率
    const OI_HOSTS = [
      'https://res.opstatistics.com',
      'https://openinstall.io',
      'https://opstatistics.com',
      'https://oplinking.com',
      `https://${appKey}.oplinking.com`,
    ]
    OI_HOSTS.forEach((h) => {
      if (document.querySelector(`link[data-oi-pc="${h}"]`)) return
      ;['preconnect', 'dns-prefetch'].forEach((rel) => {
        const l = document.createElement('link')
        l.rel = rel
        l.href = h
        if (rel === 'preconnect') l.crossOrigin = ''
        l.setAttribute('data-oi-pc', h)
        document.head.appendChild(l)
      })
    })

    // 看门狗:onready 偶发卡 5 秒(SDK 初始化请求超时)→ 3.5s 没 ready 就
    // 重新 new OpenInstall() 重试,把"卡住的那次"重来,最多重试 2 次。
    const WATCHDOG_MS = 3500
    const MAX_RETRY = 2
    let settled = false
    const watchdogs: number[] = []
    const clearAllWatchdogs = () => {
      watchdogs.forEach((id) => clearTimeout(id))
      watchdogs.length = 0
    }

    const createInstance = (attempt: number, data: Record<string, unknown>) => {
      try {
        new window.OpenInstall(
          {
            appKey,
            onready: function (this: any) {
              if (settled) return // 已有实例就绪,忽略后到的
              settled = true
              clearAllWatchdogs()
              oiRef.current = this
            },
          },
          data
        )
      } catch { /* noop */ }

      if (attempt < MAX_RETRY) {
        const id = window.setTimeout(() => {
          if (!settled) createInstance(attempt + 1, data)
        }, WATCHDOG_MS)
        watchdogs.push(id)
      }
    }

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.charset = 'UTF-8'
    script.src = `https://res.opstatistics.com/openinstall-${appKey}.js`

    script.onload = () => {
      if (!window.OpenInstall) return
      try {
        const data = window.OpenInstall.parseUrlParams()
        createInstance(1, data)
      } catch (error) {
        console.warn('OpenInstall 初始化失败:', error)
      }
    }

    document.head.appendChild(script)

    return () => {
      clearAllWatchdogs()
      script.parentNode?.removeChild(script)
    }
  }, [appKey])

  return null
}
