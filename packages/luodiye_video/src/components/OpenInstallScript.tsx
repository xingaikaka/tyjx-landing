'use client'

import { useEffect } from 'react'

declare global {
  interface Window {
    OpenInstall?: any
  }
}

interface OpenInstallScriptProps {
  appKey?: string
}

/**
 * OpenInstall SDK 集成
 * 使用官方 CDN: res.opstatistics.com
 * 解析 URL 参数、scheme 唤醒、一键拉起/引导下载
 */
export default function OpenInstallScript({ appKey = 'ecedok' }: OpenInstallScriptProps) {
  useEffect(() => {
    const existingScript = document.querySelector(`script[src*="openinstall-${appKey}"]`)
    if (existingScript) return

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.charset = 'UTF-8'
    script.src = `https://res.opstatistics.com/openinstall-${appKey}.js`

    script.onload = () => {
      if (typeof window === 'undefined' || !window.OpenInstall) return

      try {
        // 解析当前网页 URL 中的查询参数
        const data = window.OpenInstall.parseUrlParams()

        // 初始化 OpenInstall
        //
        // ⚠️ 故意不在 onready 里自动调 this.schemeWakeup()
        //    自动 schemeWakeup 会在用户一打开落地页时立即尝试拉起 App,
        //    部分国产浏览器/微信内置浏览器会无提示直接切到已装 App,
        //    用户体验是"我只是想看页面,怎么 App 突然弹出来?"
        //    改为只在用户点击 [data-openinstall] 按钮时主动 wakeupOrInstall。
        new window.OpenInstall(
          {
            appKey,
            onready: function (this: any) {
              // 绑定所有带 data-openinstall 的按钮(点击才 wakeup,不主动)
              const self = this
              const buttons = document.querySelectorAll('[data-openinstall]')
              buttons.forEach((button) => {
                button.addEventListener('click', (e) => {
                  e.preventDefault()
                  self.wakeupOrInstall() // scheme / Universal Link 唤醒,失败引导下载
                  return false
                })
              })
            },
          },
          data
        )
      } catch (error) {
        console.warn('OpenInstall 初始化失败:', error)
      }
    }

    document.head.appendChild(script)

    return () => {
      script.parentNode?.removeChild(script)
    }
  }, [appKey])

  return null
}
