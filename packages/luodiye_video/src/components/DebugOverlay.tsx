'use client'

import { useEffect, useState } from 'react'
import { dbgGetAll, dbgSubscribe, installConsoleCapture, isDbgEnabled, DbgEntry } from '@/lib/dbgBus'

/**
 * 悬浮调试面板:仅 ?dbg=1（或 ?debug=1）时显示,正常访问看不到、零开销。
 *   - 默认收起,只显示标题栏「DBG」
 *   - 点击展开查看日志 + 复制按钮
 */
export default function DebugOverlay() {
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState<DbgEntry[]>([])
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')

  useEffect(() => {
    if (!isDbgEnabled()) return
    setEnabled(true)
    // ?dbg=1 时开启 console 捕获:OpenInstall SDK 等第三方 console 日志进 DBG 面板
    installConsoleCapture()
    setLogs(dbgGetAll())
    return dbgSubscribe((e) => {
      setLogs((prev) => {
        const next = prev.length > 800 ? prev.slice(-800) : prev.slice()
        next.push(e)
        return next
      })
    })
  }, [])

  if (!enabled) return null

  const fmt = (ts: number) => {
    const d = new Date(ts)
    return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
  }

  function copyAll() {
    const text = logs
      .map((l) => `[${fmt(l.ts)}] ${l.level.toUpperCase().padEnd(5)} ${l.src.padEnd(10)} ${l.msg}`)
      .join('\n')
    const tryClipboard = async () => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
      return false
    }
    const tryExec = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch { return false }
    }
    tryClipboard()
      .then((ok) => {
        if (ok || tryExec()) {
          setCopyState('ok')
          setTimeout(() => setCopyState('idle'), 1500)
        } else setCopyState('fail')
      })
      .catch(() => {
        if (tryExec()) {
          setCopyState('ok')
          setTimeout(() => setCopyState('idle'), 1500)
        } else setCopyState('fail')
      })
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 99999,
        width: open ? 'min(92vw, 480px)' : 'auto',
        maxHeight: open ? '60vh' : 'auto',
        background: 'rgba(13,13,16,0.94)',
        color: '#ddd',
        fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
        fontSize: 11,
        lineHeight: 1.4,
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '6px 8px',
          background: '#1a1a22',
          alignItems: 'center',
        }}
      >
        <strong style={{ flex: 1, fontSize: 12 }}>DBG ({logs.length})</strong>
        {open && (
          <button
            onClick={copyAll}
            style={{
              border: 'none',
              background: copyState === 'ok' ? '#0a0' : copyState === 'fail' ? '#a00' : '#f70',
              color: '#fff',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {copyState === 'ok' ? '已复制 ✓' : copyState === 'fail' ? '失败' : '复制'}
          </button>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            border: 'none',
            background: '#444',
            color: '#fff',
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 11,
          }}
        >
          {open ? '收起' : '展开'}
        </button>
      </div>
      {open && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          {logs.map((l, i) => (
            <div
              key={i}
              style={{
                color:
                  l.level === 'error' ? '#ff6b6b' :
                  l.level === 'warn' ? '#ffd166' :
                  l.level === 'ok' ? '#06d6a0' :
                  '#bbb',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              <span style={{ color: '#666' }}>[{fmt(l.ts)}]</span>{' '}
              <span style={{ color: '#888' }}>{l.src}</span>{' '}
              <span>{l.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
