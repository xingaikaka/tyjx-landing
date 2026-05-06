'use client'

import { useEffect, useState } from 'react'
import { decryptAssetUrl } from '@/lib/decryptAsset'

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** R2/CDN URL;可以是 .enc 密文或历史明文 */
  src: string
  /** 当前会话的 AES key(hex);来自 useLandingConfig 的 assetAesKey */
  assetKey: string
  /** 兼容老 prop,无实际作用(落地页所有图都立即解密) */
  priority?: boolean
}

const ENC_RE = /\.enc(\?|$|#)/i

/**
 * 加密图片组件(精简版)。
 *
 * 落地页只有 logo / poster 几张图,且都在首屏 → 不做 IntersectionObserver lazy load,
 * 全部立即解密。这样:
 *   - 减少代码体积
 *   - 减少 useEffect 状态切换 / placeholder DOM 渲染轮次
 *   - 跟 BackgroundVideo 内 poster 解密同步,首屏更顺
 *
 * 兼容路径:
 *   1. 历史明文图 → 直出 <img src={src}>
 *   2. 加密图 + key 就绪 → fetch + AES-GCM 解密 → blob URL
 *   3. 解密失败 → 退化用原 url(避免空白)
 */
export default function EncryptedImage({ src, assetKey, priority: _priority, ...rest }: Props) {
  const encrypted = src ? ENC_RE.test(src) : false
  const [blobUrl, setBlobUrl] = useState('')
  const [decryptFailed, setDecryptFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBlobUrl('')
    setDecryptFailed(false)
    if (!src || !encrypted || !assetKey) return
    decryptAssetUrl(src, assetKey)
      .then((u) => { if (!cancelled) setBlobUrl(u) })
      .catch(() => { if (!cancelled) setDecryptFailed(true) })
    return () => { cancelled = true }
  }, [src, encrypted, assetKey])

  if (!src) return null

  if (!encrypted || decryptFailed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} {...rest} />
  }

  if (blobUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={blobUrl} {...rest} />
  }

  return null
}
