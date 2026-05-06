/**
 * /api/portal/* 响应解密(AES-256-CBC)。与 admin-server lib/api-crypto.js 对齐。
 *
 * 响应格式:
 *   { "e": "<base64(iv(16) || ciphertext)>" }
 *
 * 兼容旧明文响应:整段 fetch 出来若不是 `{e:...}` 形式,直接 JSON.parse 返回。
 *
 * key 来源:NEXT_PUBLIC_PORTAL_API_AES_KEY(64 hex,与后端 PORTAL_API_AES_KEY 同值)。
 * 缺失时落地页拉到 {e:...} 也只能报错(配置必须显式同步)。
 */

const KEY_HEX = (
  (typeof process !== 'undefined' &&
    process.env &&
    process.env.NEXT_PUBLIC_PORTAL_API_AES_KEY) ||
  ''
).trim()

const IV_LEN = 16

let cachedKey: CryptoKey | null = null

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return arr
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  if (!/^[0-9a-f]{64}$/i.test(KEY_HEX)) {
    throw new Error(
      'NEXT_PUBLIC_PORTAL_API_AES_KEY 未配置或不是 64 hex,无法解密 /api/portal/* 响应'
    )
  }
  // 直接传 Uint8Array 即可(BufferSource);用 .buffer 在 Node Buffer 子类化时
  // 可能拿到底层共享 ArrayBuffer 触发 'Invalid key length'。
  // TS 严格模式下 ArrayBufferLike 不属于 BufferSource → as 断言一下,运行时无影响。
  const raw = hexToBytes(KEY_HEX)
  cachedKey = await crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    'AES-CBC',
    false,
    ['decrypt']
  )
  return cachedKey
}

/** 拉一个 portal 端点 → 自动识别加密包 → 返回明文 JSON 解析结果 */
export async function fetchPortalJson<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const resp = await fetch(url, init)
  if (!resp.ok) throw new Error(`fetch ${url} → ${resp.status}`)
  const text = await resp.text()
  return decodePortalText<T>(text)
}

/** 把响应字符串解码成 JSON 对象;识别 `{e}` 自动解密,否则直接 JSON.parse */
export async function decodePortalText<T = unknown>(text: string): Promise<T> {
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('portal: 响应不是合法 JSON')
  }

  if (
    parsed &&
    typeof parsed.e === 'string' &&
    Object.keys(parsed).length === 1
  ) {
    const plain = await cbcDecrypt(parsed.e)
    return JSON.parse(plain) as T
  }
  return parsed as T
}

async function cbcDecrypt(b64: string): Promise<string> {
  const raw = base64ToBytes(b64)
  if (raw.length <= IV_LEN) {
    throw new Error('portal: 加密负载太短')
  }
  // subarray 返回 Uint8Array<ArrayBufferLike>(其 buffer 可能是 SharedArrayBuffer),
  // Web Crypto 在严格 TS 下要求 ArrayBuffer。复制一份即可让 buffer 成为 ArrayBuffer。
  const iv = new Uint8Array(raw.subarray(0, IV_LEN))
  const ct = new Uint8Array(raw.subarray(IV_LEN))
  const key = await getKey()
  const dec = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)
  return new TextDecoder().decode(dec)
}
