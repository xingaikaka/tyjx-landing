import { useEffect, useState } from 'react';
import { systemApi, type SystemConfig } from '@/api/client';
import { toast } from '@/components/Toast';
import { useMediaMetaStore } from '@/store/mediaMeta';

const EMPTY: SystemConfig = {
  mediaCdnBase: '',
  envCdnBase: '',
  envR2PublicBase: '',
};

export default function SystemPage() {
  const [data, setData] = useState<SystemConfig>(EMPTY);
  const [orig, setOrig] = useState<SystemConfig>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const cfg = await systemApi.get();
      setData(cfg);
      setOrig(cfg);
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
      const next = await systemApi.put(data.mediaCdnBase.trim());
      setData(next);
      setOrig(next);
      // 改了 cdnBase 之后,前端 mediaMeta(_meta 端点)也要刷,避免预览还指向老 host
      await useMediaMetaStore.getState().load(true);
      toast.success('已保存,所有媒体 URL 切到新域名');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setData(orig);
  }

  const dirty = data.mediaCdnBase !== orig.mediaCdnBase;
  const effective =
    data.mediaCdnBase || data.envCdnBase || data.envR2PublicBase || '(未配置)';

  if (loading) {
    return <div style={{ padding: 16 }}>加载中...</div>;
  }

  return (
    <div style={{ padding: 16, maxWidth: 800 }}>
      <h2 style={{ marginTop: 0 }}>系统设置</h2>

      <fieldset
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <legend style={{ padding: '0 6px', color: 'var(--text-2)' }}>
          媒体 CDN 域名(mediaCdnBase)
        </legend>

        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7, marginBottom: 12 }}>
          所有上传到 R2 的图片/视频/APK 对外访问 URL 的前缀。落地页和后台预览
          都会通过这个域名加载资源。
          <br />
          改完保存后,数据库里历史 URL 会在响应时自动切到新域名(host 重写),
          已上传的 R2 文件不需要迁移。
          <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
            <li>
              生产建议: <code>https://tyjx.calculus.xin</code>(腾讯 EdgeOne 回源 R2)
            </li>
            <li>
              CDN 没配好时临时用: <code>https://pub-xxxxx.r2.dev</code>(R2 公网域)
            </li>
            <li>留空 → fallback 到 .env 的 CDN_BASE / R2_PUBLIC_BASE</li>
          </ul>
        </div>

        <div className="form-row">
          <label>当前配置</label>
          <input
            type="text"
            value={data.mediaCdnBase}
            placeholder={data.envCdnBase || data.envR2PublicBase || 'https://cdn.example.com'}
            onChange={(e) => setData({ ...data, mediaCdnBase: e.target.value })}
            style={{ width: '100%' }}
          />
        </div>

        <div className="form-row">
          <label>实际生效</label>
          <code
            style={{
              display: 'inline-block',
              padding: '4px 8px',
              background: 'var(--bg-2)',
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            {effective}
          </code>
        </div>

        <div className="form-row">
          <label>env 默认</label>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            CDN_BASE: <code>{data.envCdnBase || '(未设置)'}</code>
            <br />
            R2_PUBLIC_BASE: <code>{data.envR2PublicBase || '(未设置)'}</code>
          </div>
        </div>
      </fieldset>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          style={{
            padding: '6px 14px',
            background: dirty ? 'var(--brand)' : undefined,
            color: dirty ? '#fff' : undefined,
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: dirty && !saving ? 'pointer' : 'default',
          }}
        >
          {saving ? '保存中...' : '保存'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!dirty || saving}
          style={{
            padding: '6px 14px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: dirty && !saving ? 'pointer' : 'default',
          }}
        >
          撤销
        </button>
      </div>
    </div>
  );
}
