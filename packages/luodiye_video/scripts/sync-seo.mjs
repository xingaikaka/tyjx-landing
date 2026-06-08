#!/usr/bin/env node
/**
 * 在 next build 之前从 admin-server 拉 seo 配置写到 .env.production,
 * 这样 build 产物里 layout.tsx metadata 就带上当前后台最新文案。
 *
 * 优先级(都从 env 读,本脚本只 fill 缺失项):
 *   ADMIN_SEO_API   完整 URL,例 https://tyjx.calculus.xin/api/portal/landing/config
 *                    或 http://127.0.0.1:3010/api/portal/landing/config
 *   ADMIN_BASE       admin 根 URL,例 https://your-admin.example  (上面没填时拼接 /api/portal/landing/config)
 *
 * 任何拉取错误 → warn 后**继续 build**,layout 用空兜底(不阻塞 CI)。
 *
 * 说明:不在源码里 hardcode 业务文案,真人浏览器最终看到的还是 admin 实时值
 * (<DynamicSEO> 客户端注入)。本脚本仅决定爬虫看到的兜底文案。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, '.env.production')

const ADMIN_BASE = (process.env.ADMIN_BASE || '').replace(/\/+$/, '')
const SEO_API =
  process.env.ADMIN_SEO_API ||
  (ADMIN_BASE ? `${ADMIN_BASE}/api/portal/landing/config` : '')

// 与 admin-server PORTAL_API_AES_KEY 同值;客户端 build 也要拿到这个 hex
// 写到 .env.production 的 NEXT_PUBLIC_PORTAL_API_AES_KEY。
//
// 解析顺序:
//   1. process.env.PORTAL_API_AES_KEY / NEXT_PUBLIC_PORTAL_API_AES_KEY (CI 显式传)
//   2. monorepo 同级 admin-server/.env(本机 dev 自动复用)
let API_KEY_HEX = (
  process.env.PORTAL_API_AES_KEY ||
  process.env.NEXT_PUBLIC_PORTAL_API_AES_KEY ||
  ''
).trim()

if (!API_KEY_HEX) {
  const siblingEnv = path.resolve(ROOT, '..', 'admin-server', '.env')
  if (fs.existsSync(siblingEnv)) {
    const txt = fs.readFileSync(siblingEnv, 'utf8')
    const m = txt.match(/^PORTAL_API_AES_KEY=(.+)$/m)
    if (m) API_KEY_HEX = m[1].trim().replace(/^"|"$/g, '')
  }
}

function warn(msg) {
  console.warn(`[sync-seo] ${msg}`)
}

function info(msg) {
  console.log(`[sync-seo] ${msg}`)
}

/** 解密 admin-server 的 `{e:"<base64(iv|ct)>"}` 包(AES-256-CBC) */
function cbcDecrypt(b64) {
  if (!/^[0-9a-f]{64}$/i.test(API_KEY_HEX)) {
    throw new Error(
      'PORTAL_API_AES_KEY 未配置或不是 64 hex,无法解密 portal API 响应'
    )
  }
  const raw = Buffer.from(b64, 'base64')
  if (raw.length <= 16) throw new Error('加密负载过短')
  const iv = raw.subarray(0, 16)
  const ct = raw.subarray(16)
  const key = Buffer.from(API_KEY_HEX, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

async function fetchSeo(url) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  try {
    const r = await fetch(url, { signal: ac.signal })
    if (!r.ok) throw new Error(`http ${r.status}`)
    const text = await r.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('响应不是 JSON')
    }
    // 自动识别加密包:{ e: '...' }
    if (
      parsed &&
      typeof parsed.e === 'string' &&
      Object.keys(parsed).length === 1
    ) {
      parsed = JSON.parse(cbcDecrypt(parsed.e))
    }
    const seo = parsed?.data?.seo
    if (!seo || typeof seo !== 'object') {
      throw new Error('no seo field in response')
    }
    return {
      title: String(seo.title || ''),
      description: String(seo.description || ''),
      keywords: String(seo.keywords || ''),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把多行 env (key=value) 合并写回。已存在的 SEO_* 行会被替换;
 * 其他行保留,顺序保持。
 */
function writeEnv(file, kv) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const lines = existing.split(/\r?\n/)
  const seen = new Set()

  function escape(v) {
    // env 多行/含 # / 空格 → 双引号包,内部 " 转义
    if (v === '') return '""'
    if (/[\s#"\\]/.test(v)) return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    return v
  }

  const out = lines.map((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/)
    if (!m) return line
    const key = m[1]
    if (key in kv) {
      seen.add(key)
      return `${key}=${escape(kv[key])}`
    }
    return line
  })

  for (const [k, v] of Object.entries(kv)) {
    if (!seen.has(k)) out.push(`${k}=${escape(v)}`)
  }
  // 去尾部多余空行,保留单个换行
  while (out.length > 1 && out[out.length - 1] === '') out.pop()
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8')
}

;(async () => {
  if (!SEO_API) {
    warn('未设置 ADMIN_SEO_API / ADMIN_BASE, 跳过(layout 走 env 缺省值, SEO 元信息为空)')
    return
  }

  info(`fetching ${SEO_API}`)
  let seo
  try {
    seo = await fetchSeo(SEO_API)
  } catch (e) {
    warn(`拉取失败: ${e.message} — 继续 build, 元信息走空兜底`)
    return
  }

  info(
    `写入 .env.production: title=${JSON.stringify(seo.title.slice(0, 30))}... ` +
      `description=${JSON.stringify(seo.description.slice(0, 30))}... ` +
      `keywords=${JSON.stringify(seo.keywords.slice(0, 30))}...`
  )

  const kv = {
    NEXT_PUBLIC_SEO_TITLE: seo.title,
    NEXT_PUBLIC_SEO_DESCRIPTION: seo.description,
    NEXT_PUBLIC_SEO_KEYWORDS: seo.keywords,
  }
  // 顺手把 portal 解密 key 也注入,prod 浏览器解密 /api/portal/* 响应需要它
  if (API_KEY_HEX) {
    kv.NEXT_PUBLIC_PORTAL_API_AES_KEY = API_KEY_HEX
  }
  writeEnv(ENV_FILE, kv)

  info('done')
})().catch((e) => {
  warn(`unexpected error: ${e?.stack || e?.message || e}`)
})
