import { useState } from 'react';
import { toast } from './Toast';

interface Props {
  title: string;
  hint?: string;
  domains: string[];
  onChange: (next: string[]) => void;
  /** 最少域数,低于会校验报错(0 = 允许空) */
  min?: number;
  /** 最多域数 */
  max?: number;
}

const HOST_RE = /^(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function normalize(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

export default function DomainListEditor({
  title,
  hint,
  domains,
  onChange,
  min = 0,
  max = 50,
}: Props) {
  const [input, setInput] = useState('');

  function add() {
    const items = input
      .split(/[\s,，;；\n]+/)
      .map(normalize)
      .filter(Boolean);
    if (!items.length) return;

    const set = new Set(domains);
    const adds: string[] = [];
    const bad: string[] = [];
    const dup: string[] = [];

    for (const d of items) {
      if (!HOST_RE.test(d)) {
        bad.push(d);
        continue;
      }
      if (set.has(d)) {
        dup.push(d);
        continue;
      }
      set.add(d);
      adds.push(d);
    }

    if (adds.length + domains.length > max) {
      toast.error(`最多 ${max} 条,本次添加超出上限`);
      return;
    }
    if (bad.length) toast.error(`无效域名: ${bad.join(', ')}`);
    if (dup.length) toast.info(`重复忽略: ${dup.join(', ')}`);
    if (adds.length) {
      onChange([...domains, ...adds]);
      setInput('');
    }
  }

  function remove(idx: number) {
    if (domains.length - 1 < min) {
      toast.error(`至少保留 ${min} 条`);
      return;
    }
    const next = domains.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= domains.length) return;
    const next = domains.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }

  return (
    <div className="form-row">
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>
          {title}
          <span style={{ marginLeft: 8, color: 'var(--text-3)' }}>
            {domains.length} 条
          </span>
        </span>
        {hint && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{hint}</span>}
      </label>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--surface-2)',
        }}
      >
        {domains.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--text-3)', textAlign: 'center' }}>
            (空)
          </div>
        ) : (
          domains.map((d, i) => (
            <div
              key={`${d}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderBottom:
                  i === domains.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <span style={{ width: 24, color: 'var(--text-3)' }}>{i + 1}.</span>
              <code style={{ flex: 1, fontSize: 13 }}>{d}</code>
              <button
                type="button"
                style={{ padding: '2px 8px', fontSize: 12 }}
                onClick={() => move(i, -1)}
                disabled={i === 0}
              >
                ↑
              </button>
              <button
                type="button"
                style={{ padding: '2px 8px', fontSize: 12 }}
                onClick={() => move(i, 1)}
                disabled={i === domains.length - 1}
              >
                ↓
              </button>
              <button
                type="button"
                className="danger"
                style={{ padding: '2px 8px', fontSize: 12 }}
                onClick={() => remove(i)}
              >
                删除
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          type="text"
          value={input}
          placeholder="输入域名,多条用空格 / 逗号 / 换行分隔"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="primary" onClick={add}>
          添加
        </button>
      </div>
    </div>
  );
}
