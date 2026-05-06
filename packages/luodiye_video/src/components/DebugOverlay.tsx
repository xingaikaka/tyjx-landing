'use client'

import { useEffect, useRef, useState } from 'react'
import { dbgGetAll, dbgSubscribe, isDbgEnabled, DbgEntry } from '@/lib/dbgBus'

/**
 * ?dbg=1 时显示的浮层日志面板 — 实时监控主页 BackgroundVideo 的 hls.js / video 事件。
 *
 * 不传 ?dbg=1 时直接 return null,生产环境零开销。
 */
export default function DebugOverlay() {
  const [open, setOpen] = useState(true)
  const [logs, setLogs] = useState<DbgEntry[]>([])
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const enabled = useRef(false)

  useEffect(() => {
    enabled.current = isDbgEnabled()
    if (!enabled.current) return
    setLogs(dbgGetAll())
    return dbgSubscribe((e) => {
      setLogs((prev) => {
        const next = prev.length > 800 ? prev.slice(-800) : prev.slice()
        next.push(e)
        return next
      })
    })
  }, [])

  if (!enabled.current) return null

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
