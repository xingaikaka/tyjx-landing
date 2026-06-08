/**
 * 浏览器侧解密 admin 上传的 .enc 图片(AES-256-GCM)。
 * 与 admin-server lib/asset-crypto.js 对齐。
 *
 * 密文结构: [IV(12) | tag(16) | ciphertext]
 * Web Crypto 的 GCM 实现把 tag 拼在 ciphertext 末尾,所以这里要把 [tag | ct] 重新拼起来。
 *
 * 内存中的 url → blob 缓存:
 *   同一个 url 多次调用直接复用 blobUrl,避免重复网络拉 + 重复解密。
 *   组件 unmount 不主动释放(blob 可能被多处用),由 LRU 容量上限兜底防泄漏。
 */

const IV_LEN = 12
const TAG_LEN = 16
const CACHE_MAX = 32

interface CacheEntry {
  blobUrl: string
  ts: number
}
const cache = new Map<string, CacheEntry>()

function evictIfFull() {
  if (cache.size <= CACHE_MAX) return
  // LRU: 删最早访问的
  let oldestKey: string | null = null
  let oldestTs = Infinity
  cache.forEach((v, k) => {
    if (v.ts < oldestTs) {
      oldestTs = v.ts
      oldestKey = k
    }
  })
  if (oldestKey) {
    const ent = cache.get(oldestKey)
    if (ent) URL.revokeObjectURL(ent.blobUrl)
    cache.delete(oldestKey)
  }
}

let cachedKey: CryptoKey | null = null
let cachedKeyHex = ''

async function importKey(hex: string): Promise<CryptoKey> {
  if (cachedKey && cachedKeyHex === hex) return cachedKey
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('asset key must be 64 hex chars')
  }
  const raw = new Uint8Array(hex.length / 2)
  for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.substr(i * 2, 2), 16)
  cachedKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )
  cachedKeyHex = hex
  return cachedKey
}

/**
 * 拉密文 → 解密 → 返回 blob URL(可直接喂 <img src> / video.poster)。
 *
 * Blob.type 不影响浏览器对 <img> / poster 的解码(它看的是 magic bytes),
 * 这里给个通用的 octet-stream 即可,不再让调用方猜 mime。
 */
export async function decryptAssetUrl(
  url: string,
  keyHex: string
): Promise<string> {
  if (!url) return ''

  const hit = cache.get(url)
  if (hit) {
    hit.ts = Date.now()
    return hit.blobUrl
  }

  const key = await importKey(keyHex)
  const resp = await fetch(url, { cache: 'force-cache' })
  if (!resp.ok) throw new Error(`fetch ${url} → ${resp.status}`)
  const buf = new Uint8Array(await resp.arrayBuffer())
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error(`bad enc payload: ${buf.length} bytes`)
  }

  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  // Web Crypto 期望 [ciphertext | tag]
  const combined = new Uint8Array(ct.length + tag.length)
  combined.set(ct, 0)
  combined.set(tag, ct.length)

  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined)
  const blob = new Blob([plain], { type: 'application/octet-stream' })
  const blobUrl = URL.createObjectURL(blob)

  evictIfFull()
  cache.set(url, { blobUrl, ts: Date.now() })
  return blobUrl
}

/** 主动清理(切换 key 时调用) */
export function clearAssetCache() {
  cache.forEach((v) => URL.revokeObjectURL(v.blobUrl))
  cache.clear()
  cachedKey = null
  cachedKeyHex = ''
}
