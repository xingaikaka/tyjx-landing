import { useEffect, useState } from 'react';
import { domainsApi } from '@/api/client';
import type { DomainsConfig } from '@/types/config';
import DomainListEditor from '@/components/DomainListEditor';
import { toast } from '@/components/Toast';

const EMPTY: DomainsConfig = {
  brandDomains: [],
  entryPages: [],
  publishPages: [],
  finalLandings: [],
  entryButtonsCount: 2,
  publishLinksCount: 2,
};

export default function DomainsPage() {
  const [data, setData] = useState<DomainsConfig>(EMPTY);
  const [orig, setOrig] = useState<DomainsConfig>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await domainsApi.get();
      setData(d);
      setOrig(d);
    } catch (e) {
      toast.error((e as Error).message || '加载失败');
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
      const saved = await domainsApi.put(data);
      setData(saved);
      setOrig(saved);
      toast.success('已保存,中转层将在 30 秒内生效');
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setData(orig);
  }

  const dirty = JSON.stringify(data) !== JSON.stringify(orig);

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', color: '#888' }}>
        加载中...
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="page-title">域池管理</h2>
      <p className="page-desc">
        管理品牌域、入口页、发布页、真落地页 4 类域池。保存后中转层与落地页会在 30 秒内自动拉到新配置。
      </p>

      <DomainListEditor
        title="品牌域 brandDomains"
        hint="用户记忆的固定域,默认仅 tyjx.app"
        domains={data.brandDomains}
        onChange={(v) => setData({ ...data, brandDomains: v })}
        min={1}
        max={10}
      />

      <DomainListEditor
        title="入口页面泛域 entryPages"
        hint="brandDomain 302 跳到这里(图 1 UI)"
        domains={data.entryPages}
        onChange={(v) => setData({ ...data, entryPages: v })}
        max={50}
      />

      <DomainListEditor
        title="发布页面泛域 publishPages"
        hint="入口页按钮跳到这里(图 2 UI)"
        domains={data.publishPages}
        onChange={(v) => setData({ ...data, publishPages: v })}
        max={50}
      />

      <DomainListEditor
        title="真落地页泛域 finalLandings"
        hint="用户复制粘贴打开,nginx 静态服务 luodiye_video"
        domains={data.finalLandings}
        onChange={(v) => setData({ ...data, finalLandings: v })}
        max={50}
      />

      <div className="form-grid-2">
        <div>
          <label>入口页"最新地址"按钮数 (entryButtonsCount)</label>
          <input
            type="number"
            min={1}
            max={20}
            value={data.entryButtonsCount}
            onChange={(e) =>
              setData({ ...data, entryButtonsCount: Number(e.target.value) || 1 })
            }
          />
        </div>
        <div>
          <label>发布页"复制网址"行数 (publishLinksCount)</label>
          <input
            type="number"
            min={1}
            max={20}
            value={data.publishLinksCount}
            onChange={(e) =>
              setData({ ...data, publishLinksCount: Number(e.target.value) || 1 })
            }
          />
        </div>
      </div>

      <div className="actions">
        <button onClick={reset} disabled={!dirty || saving}>
          撤销修改
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
  );
}
