import { useEffect, useRef, useState } from 'react';
import { mediaApi } from '@/api/client';
import type { MediaItem } from '@/types/config';
import { toPreviewUrl } from '@/store/mediaMeta';
import EncryptedImage from '@/components/EncryptedImage';
import { toast } from './Toast';

interface Props {
  /** 当前已选 URL,空字符串=未选 */
  value: string;
  onChange: (url: string) => void;
  /** 限制可选媒体类型(默认全部) */
  accept?: 'image' | 'video' | 'all';
  /** 标题文字 */
  label?: string;
  /** 预览高度 */
  previewHeight?: number;
  /**
   * 视频转码后服务端会同时返回 posterUrl(首帧 jpg),
   * 父组件可借此自动填充对应字段(例如 backgroundVideoPoster)。
   */
  onUploadDone?: (info: {
    url: string;
    posterUrl?: string;
    kind?: string;
  }) => void;
}

export default function MediaPicker({
  value,
  onChange,
  accept = 'all',
  label,
  previewHeight = 80,
  onUploadDone,
}: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadProg, setUploadProg] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function matchesAccept(m: MediaItem) {
    if (accept === 'all') return true;
    if (accept === 'image') return m.mime?.startsWith('image/');
    if (accept === 'video') {
      // 视频概念 = 加密 HLS。mp4 是输入素材,上传后立即转码,列表里看不到 mp4。
      // 兼容老 webm 数据(mime=video/*),让用户能看到并删除。
      return m.kind === 'hls' || m.mime?.startsWith('video/');
    }
    return true;
  }

  async function loadList() {
    setLoading(true);
    try {
      const all = await mediaApi.list();
      setList(all.filter(matchesAccept));
    } catch (e) {
      toast.error((e as Error).message || '媒体加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // 允许重复选同名

    if (accept === 'image' && !file.type.startsWith('image/')) {
      return toast.error('只能上传图片');
    }
    if (accept === 'video') {
      const isMp4 =
        file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
      if (!isMp4) {
        return toast.error('只支持 .mp4(服务器会自动转加密 HLS)');
      }
    }

    setUploadProg(0);
    try {
      const r = await mediaApi.upload(file, (p) => setUploadProg(p));
      toast.success(
        r.kind === 'hls'
          ? `上传成功:HLS ${r.segmentCount || 0} 分片 / ${r.duration || 0}s`
          : '上传成功'
      );
      onChange(r.url);
      onUploadDone?.({ url: r.url, posterUrl: r.posterUrl, kind: r.kind });
      setOpen(false);
    } catch (err) {
      toast.error((err as Error).message || '上传失败');
    } finally {
      setUploadProg(null);
    }
  }

  function isImage(url: string, mime?: string) {
    if (mime?.startsWith('image/')) return true;
    // 加密上传后 URL 是 .png.enc / .jpg.enc 等,后缀仍带原始格式
    return /\.(png|jpe?g|gif|webp|svg)(\.enc)?(\?|$)/i.test(url);
  }
  function isVideo(url: string, mime?: string) {
    // 主路径:HLS m3u8(我们落地页唯一支持的视频格式)
    if (mime === 'application/vnd.apple.mpegurl') return true;
    if (/\.m3u8(\?|$)/i.test(url)) return true;
    // 兼容老 webm/mp4 数据,让管理员能看到并删除
    if (mime?.startsWith('video/')) return true;
    return /\.(mp4|webm|mov)(\?|$)/i.test(url);
  }

  return (
    <div>
      {label && <label>{label}</label>}

      {/* 当前预览 */}
      {value ? (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'var(--surface-2)',
          }}
        >
          {isImage(value) ? (
            <EncryptedImage
              src={toPreviewUrl(value)}
              alt=""
              style={{
                height: previewHeight,
                maxWidth: 160,
                objectFit: 'contain',
                background: '#fff',
                borderRadius: 4,
              }}
            />
          ) : isVideo(value) ? (
            <video
              src={toPreviewUrl(value)}
              style={{ height: previewHeight, maxWidth: 160, borderRadius: 4, background: '#000' }}
              controls
              muted
            />
          ) : (
            <div style={{ color: 'var(--text-3)' }}>(未识别类型)</div>
          )}
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text-2)', wordBreak: 'break-all' }}>
            {value}
          </div>
          <button type="button" onClick={() => setOpen(true)}>
            更换
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => onChange('')}
          >
            清空
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="primary"
            onClick={() => setOpen(true)}
          >
            选择/上传
          </button>
          <input
            type="text"
            placeholder="或直接粘贴 URL"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      )}

      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card"
            style={{
              width: 720,
              maxWidth: '92vw',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <h3 style={{ margin: 0 }}>
                选择{accept === 'video' ? '视频' : accept === 'image' ? '图片' : '媒体'}
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept={
                    accept === 'image'
                      ? 'image/*'
                      : accept === 'video'
                      ? 'video/mp4,.mp4'
                      : 'image/*,video/mp4,.mp4'
                  }
                  style={{ display: 'none' }}
                  onChange={onUpload}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={uploadProg !== null}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploadProg !== null
                    ? `上传中 ${uploadProg}%`
                    : '上传新文件'}
                </button>
                <button type="button" onClick={() => setOpen(false)}>
                  关闭
                </button>
              </div>
            </div>

            <div style={{ overflow: 'auto', flex: 1 }}>
              {loading ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
                  加载中...
                </div>
              ) : list.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
                  无文件,点右上角"上传新文件"
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: 12,
                  }}
                >
                  {list.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => {
                        onChange(m.url);
                        onUploadDone?.({
                          url: m.url,
                          posterUrl: m.poster_url || undefined,
                          kind: m.kind,
                        });
                        setOpen(false);
                      }}
                      style={{
                        border:
                          value === m.url
                            ? '2px solid var(--primary)'
                            : '1px solid var(--border)',
                        borderRadius: 6,
                        padding: 6,
                        cursor: 'pointer',
                        background: '#fff',
                      }}
                    >
                      {isImage(m.url, m.mime) ? (
                        <EncryptedImage
                          src={toPreviewUrl(m.url)}
                          alt=""
                          style={{
                            width: '100%',
                            height: 100,
                            objectFit: 'contain',
                            background: '#f4f4f4',
                            borderRadius: 4,
                          }}
                        />
                      ) : (
                        <video
                          src={toPreviewUrl(m.url)}
                          style={{
                            width: '100%',
                            height: 100,
                            objectFit: 'cover',
                            background: '#000',
                            borderRadius: 4,
                          }}
                          muted
                        />
                      )}
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: 'var(--text-3)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.filename}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
