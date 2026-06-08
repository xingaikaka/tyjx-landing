import { useEffect, useRef, useState } from 'react';
import { mediaApi } from '@/api/client';
import type { MediaItem } from '@/types/config';
import { toast } from '@/components/Toast';
import { toPreviewUrl } from '@/store/mediaMeta';
import EncryptedImage from '@/components/EncryptedImage';

type Filter = 'all' | 'image' | 'video';

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(t: number) {
  return new Date(t * 1000).toLocaleString();
}

function isImg(m: MediaItem) {
  return m.mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(m.url);
}
function isVid(m: MediaItem) {
  // 主路径:HLS m3u8(kind=hls 或 mime=application/vnd.apple.mpegurl)
  if (m.kind === 'hls') return true;
  if (m.mime === 'application/vnd.apple.mpegurl') return true;
  if (/\.m3u8(\?|$)/i.test(m.url)) return true;
  // 兼容老视频数据(webm 直传产物)
  if (m.mime?.startsWith('video/')) return true;
  return /\.(mp4|webm|mov)(\?|$)/i.test(m.url);
}

export default function MediaPage() {
  const [list, setList] = useState<MediaItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setList(await mediaApi.list());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    for (const f of files) {
      setUploading({ name: f.name, pct: 0 });
      try {
        await mediaApi.upload(f, (p) => setUploading({ name: f.name, pct: p }));
        toast.success(`${f.name} 上传成功`);
      } catch (err) {
        toast.error(`${f.name} 上传失败: ${(err as Error).message}`);
      }
    }
    setUploading(null);
    refresh();
  }

  async function onDelete(item: MediaItem) {
    if (!confirm(`确定删除 ${item.filename}? 引用此 URL 的配置会失效。`)) return;
    try {
      await mediaApi.remove(item.id);
      toast.success('已删除');
      setList((arr) => arr.filter((m) => m.id !== item.id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function onCopy(url: string) {
    const abs = url.startsWith('http')
      ? url
      : `${window.location.origin}${url}`;
    navigator.clipboard
      .writeText(abs)
      .then(() => toast.success('已复制'))
      .catch(() => toast.error('复制失败,可手动选择'));
  }

  const filtered = list.filter((m) => {
    if (filter === 'image' && !isImg(m)) return false;
    if (filter === 'video' && !isVid(m)) return false;
    if (keyword && !m.filename.toLowerCase().includes(keyword.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <h2 className="page-title" style={{ margin: 0, flex: 1 }}>
          媒体库
        </h2>

        {(['all', 'image', 'video'] as Filter[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={filter === k ? 'primary' : ''}
            style={{ padding: '4px 10px', fontSize: 13 }}
          >
            {k === 'all' ? '全部' : k === 'image' ? '图片' : '视频'}
          </button>
        ))}

        <input
          type="text"
          placeholder="按文件名搜索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 200 }}
        />

        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/mp4,.mp4"
          style={{ display: 'none' }}
          onChange={onUpload}
        />
        <button
          type="button"
          className="primary"
          onClick={() => fileRef.current?.click()}
          disabled={!!uploading}
        >
          {uploading ? `上传中 ${uploading.pct}%` : '+ 上传文件'}
        </button>
      </div>

      {uploading && (
        <div
          style={{
            marginBottom: 12,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 8,
            fontSize: 13,
          }}
        >
          正在上传 <code>{uploading.name}</code>
          <div
            style={{
              height: 4,
              background: '#eee',
              borderRadius: 2,
              marginTop: 6,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${uploading.pct}%`,
                background: 'var(--primary)',
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>加载中...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#888', padding: 40 }}>
          {list.length === 0 ? '还没有上传过文件' : '没有匹配的文件'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 16,
          }}
        >
          {filtered.map((m) => (
            <div
              key={m.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: '#fff',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  height: 140,
                  background: '#f4f4f4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isImg(m) ? (
                  <EncryptedImage
                    src={toPreviewUrl(m.url)}
                    alt=""
                    style={{ maxHeight: 140, maxWidth: '100%', objectFit: 'contain' }}
                  />
                ) : isVid(m) ? (
                  <video
                    src={toPreviewUrl(m.url)}
                    style={{ maxHeight: 140, maxWidth: '100%', background: '#000' }}
                    muted
                    controls
                  />
                ) : (
                  <div style={{ color: '#888', fontSize: 12 }}>(其他类型)</div>
                )}
              </div>

              <div style={{ padding: 10 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginBottom: 4,
                  }}
                  title={m.filename}
                >
                  {m.filename}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                  {fmtSize(m.size)} · {fmtTime(m.created_at)}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
                    onClick={() => onCopy(m.url)}
                  >
                    复制 URL
                  </button>
                  <button
                    type="button"
                    className="danger"
                    style={{ padding: '4px 8px', fontSize: 12 }}
                    onClick={() => onDelete(m)}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
