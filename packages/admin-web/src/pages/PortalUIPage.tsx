import { useEffect, useState } from 'react';
import { portalUIApi, domainsApi } from '@/api/client';
import type { PortalUIConfig } from '@/types/config';
import { toast } from '@/components/Toast';
import MediaPicker from '@/components/MediaPicker';
import EncryptedImage from '@/components/EncryptedImage';
import { toPreviewUrl } from '@/store/mediaMeta';

const EMPTY: PortalUIConfig = {
  logo: '',
  siteName: '地址发布页',
  bookmarkTip: '请 Ctrl+D 收藏本页到浏览器收藏夹回家不迷路',
  clickPrompt: '--点击下方按钮进入网站--',
  bookmarkBlock: { line1: '', line2: '', line3: '' },
  footerNote: [],
};

export default function PortalUIPage() {
  const [data, setData] = useState<PortalUIConfig>(EMPTY);
  const [orig, setOrig] = useState<PortalUIConfig>(EMPTY);
  const [brand, setBrand] = useState<string>('tyjx.app');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [p, d] = await Promise.all([portalUIApi.get(), domainsApi.get()]);
      setData(p);
      setOrig(p);
      setBrand(d.brandDomains?.[0] || 'tyjx.app');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const saved = await portalUIApi.put(data);
      setData(saved);
      setOrig(saved);
      toast.success('已保存');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function setFooterLine(i: number, v: string) {
    const next = data.footerNote.slice();
    next[i] = v;
    setData({ ...data, footerNote: next });
  }

  function addFooterLine() {
    if (data.footerNote.length >= 30) return toast.error('最多 30 行');
    setData({ ...data, footerNote: [...data.footerNote, ''] });
  }

  function removeFooterLine(i: number) {
    const next = data.footerNote.slice();
    next.splice(i, 1);
    setData({ ...data, footerNote: next });
  }

  const dirty = JSON.stringify(data) !== JSON.stringify(orig);
  if (loading) return <div className="card" style={{ textAlign: 'center', color: '#888' }}>加载中...</div>;

  // 预览实际渲染时把 <brandDomain> 替换为实际值
  const renderLine = (s: string) => s.replace(/<brandDomain>/g, brand);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>
      <div className="card">
        <h2 className="page-title">入口/发布页 UI</h2>
        <p className="page-desc">
          这些字段会渲染到入口页(图1)和发布页(图2)的 HTML 中,Worker 启动时拉一次后缓存 30 秒。
        </p>

        <div className="form-row">
          <MediaPicker
            label="Logo(显示在页面顶部)"
            accept="image"
            value={data.logo}
            onChange={(url) => setData({ ...data, logo: url })}
          />
        </div>

        <div className="form-row">
          <label>站点名称 siteName</label>
          <input
            type="text"
            value={data.siteName}
            onChange={(e) => setData({ ...data, siteName: e.target.value })}
          />
        </div>

        <div className="form-row">
          <label>顶部提示 bookmarkTip</label>
          <input
            type="text"
            value={data.bookmarkTip}
            onChange={(e) => setData({ ...data, bookmarkTip: e.target.value })}
          />
        </div>

        <div className="form-row">
          <label>按钮上方说明 clickPrompt</label>
          <input
            type="text"
            value={data.clickPrompt}
            onChange={(e) => setData({ ...data, clickPrompt: e.target.value })}
          />
        </div>

        <fieldset
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <legend style={{ padding: '0 6px', color: 'var(--text-2)' }}>
            底部"收藏块" bookmarkBlock(可用 &lt;brandDomain&gt; 占位符)
          </legend>
          <div className="form-row">
            <label>line1</label>
            <input
              type="text"
              value={data.bookmarkBlock.line1}
              onChange={(e) =>
                setData({
                  ...data,
                  bookmarkBlock: { ...data.bookmarkBlock, line1: e.target.value },
                })
              }
            />
          </div>
          <div className="form-row">
            <label>line2</label>
            <input
              type="text"
              value={data.bookmarkBlock.line2}
              onChange={(e) =>
                setData({
                  ...data,
                  bookmarkBlock: { ...data.bookmarkBlock, line2: e.target.value },
                })
              }
            />
          </div>
          <div className="form-row">
            <label>line3</label>
            <input
              type="text"
              value={data.bookmarkBlock.line3}
              onChange={(e) =>
                setData({
                  ...data,
                  bookmarkBlock: { ...data.bookmarkBlock, line3: e.target.value },
                })
              }
            />
          </div>
        </fieldset>

        <fieldset
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <legend style={{ padding: '0 6px', color: 'var(--text-2)' }}>
            页面底部说明 footerNote (多行)
          </legend>
          {data.footerNote.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 8 }}>
              (空,点下方添加)
            </div>
          )}
          {data.footerNote.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                value={line}
                onChange={(e) => setFooterLine(i, e.target.value)}
              />
              <button type="button" className="danger" onClick={() => removeFooterLine(i)}>
                删除
              </button>
            </div>
          ))}
          <button type="button" onClick={addFooterLine}>
            + 添加一行
          </button>
        </fieldset>

        <div className="actions">
          <button onClick={() => setData(orig)} disabled={!dirty || saving}>
            撤销
          </button>
          <button className="primary" onClick={save} disabled={!dirty || saving}>
            {saving ? '保存中...' : '保存'}
          </button>
          {dirty && (
            <span style={{ color: 'var(--warning)', alignSelf: 'center' }}>
              ● 有未保存的修改
            </span>
          )}
        </div>
      </div>

      {/* 预览(粗略仿照图 1) */}
      <div className="card" style={{ position: 'sticky', top: 16, alignSelf: 'flex-start' }}>
        <h3 className="page-title" style={{ fontSize: 14 }}>预览(图 1 入口页样式)</h3>
        <div
          style={{
            background: 'linear-gradient(-135deg,#0f0b19,#16151B)',
            color: '#8F8F8F',
            padding: 20,
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.7,
          }}
        >
          {data.logo && (
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <EncryptedImage src={toPreviewUrl(data.logo)} alt="" style={{ height: 56 }} />
            </div>
          )}
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: '#fff',
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            {data.siteName}
          </div>
          <div style={{ textAlign: 'center', marginBottom: 6 }}>{data.bookmarkTip}</div>
          <div
            style={{
              textAlign: 'center',
              fontWeight: 600,
              color: '#fff',
              marginBottom: 14,
            }}
          >
            {data.clickPrompt}
          </div>

          {/* 假按钮:数量等于 entryButtonsCount(这里硬编 2) */}
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#f70',
                padding: '10px 12px',
                borderRadius: 999,
                textAlign: 'center',
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              最新地址{i}
            </div>
          ))}

          <div style={{ marginTop: 18, lineHeight: 1.6 }}>
            <div style={{ marginBottom: 6 }}>
              {renderLine(data.bookmarkBlock.line1).split(brand).map((seg, i, arr) => (
                <span key={i}>
                  {seg}
                  {i < arr.length - 1 && (
                    <b style={{ color: '#f70', whiteSpace: 'nowrap' }}>{brand}</b>
                  )}
                </span>
              ))}
            </div>
            <div style={{ marginBottom: 6 }}>{renderLine(data.bookmarkBlock.line2)}</div>
            <div>{renderLine(data.bookmarkBlock.line3)}</div>
          </div>

          {data.footerNote.length > 0 && (
            <div
              style={{
                marginTop: 18,
                paddingTop: 12,
                borderTop: '1px solid rgba(255,255,255,0.08)',
                textAlign: 'center',
              }}
            >
              {data.footerNote.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          预览仅用于核对文案/Logo,实际样式以 Worker 渲染为准。
        </div>
      </div>
    </div>
  );
}
