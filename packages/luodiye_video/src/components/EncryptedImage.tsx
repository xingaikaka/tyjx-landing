'use client'

import { useEffect, useState } from 'react'
import { decryptAssetUrl } from '@/lib/decryptAsset'

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** R2/CDN URL;可以是 .enc 密文或历史明文 */
  src: string
  /** 当前会话的 AES key(hex);来自 useLandingConfig 的 assetAesKey */
  assetKey: string
}

const ENC_RE = /\.enc(\?|$|#)/i

/**
 * 落地页预览图。
 *
 * 三种情况:
 *   1. 历史明文图(URL 不带 .enc)        → 直接 <img src={src}>
 *   2. 加密图(URL 带 .enc)+ key 已就绪   → 拉密文 → AES-GCM 解密 → blob URL
 *   3. 加密图但 key 还没到 / 解密中       → 不渲染(SSR-friendly)
 *
 * 解密失败时退化为情况 1 兜底,避免空白。
 */
export default function EncryptedImage({ src, assetKey, ...rest }: Props) {
  const encrypted = ENC_RE.test(src)
  const [blobUrl, setBlobUrl] = useState('')
  const [decryptFailed, setDecryptFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBlobUrl('')
    setDecryptFailed(false)
    if (!src || !encrypted || !assetKey) return
    decryptAssetUrl(src, assetKey)
      .then((u) => {
        if (!cancelled) setBlobUrl(u)
      })
      .catch((e) => {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('[enc-img] decrypt fail:', src, e?.message ?? e)
        setDecryptFailed(true)
      })
    return () => {
      cancelled = true
    }
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
