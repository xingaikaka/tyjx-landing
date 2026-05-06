import type { Metadata, Viewport } from 'next'
import './globals.css'

/**
 * SEO 元信息(给爬虫看的兜底):
 *   - 真人浏览器在 hydrate 后会被 <DynamicSEO> 用 admin 实时值覆盖
 *   - 不跑 JS 的爬虫(微信 / Google / FB) 只能看到这里的 build-time 值
 *
 * 业务文案不在源码里硬编码,而是从 build 时的环境变量注入:
 *   NEXT_PUBLIC_SEO_TITLE / _DESCRIPTION / _KEYWORDS
 *
 * 这些变量由 `pnpm prebuild`(scripts/sync-seo.mjs) 在 build 前
 * 自动从 admin-server /api/portal/landing/config 拉取写到 .env.production。
 * dev 环境拉不到 admin 时各字段会留空,layout 仍正常渲染,只是元信息为空。
 */
const SEO_TITLE = process.env.NEXT_PUBLIC_SEO_TITLE || ''
const SEO_DESCRIPTION = process.env.NEXT_PUBLIC_SEO_DESCRIPTION || ''
const SEO_KEYWORDS = process.env.NEXT_PUBLIC_SEO_KEYWORDS || ''

export const metadata: Metadata = {
  ...(SEO_TITLE && { title: SEO_TITLE }),
  ...(SEO_DESCRIPTION && { description: SEO_DESCRIPTION }),
  ...(SEO_KEYWORDS && { keywords: SEO_KEYWORDS }),
  ...(SEO_TITLE || SEO_DESCRIPTION
    ? {
        openGraph: {
          ...(SEO_TITLE && { title: SEO_TITLE }),
          ...(SEO_DESCRIPTION && { description: SEO_DESCRIPTION }),
          type: 'website',
        },
      }
    : {}),
}

// Next 14 已废弃 metadata.viewport,统一用独立 export(同时消除 dev 端警告)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
