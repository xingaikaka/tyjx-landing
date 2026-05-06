import { useRef, useState } from 'react';
import { mediaApi } from '@/api/client';
import { toPreviewUrl } from '@/store/mediaMeta';
import EncryptedImage from '@/components/EncryptedImage';
import { toast } from './Toast';

/**
 * 简化版媒体选择器:**没有资源库**,每次都直接上传新文件覆盖。
 *
 * 设计原因:
 *   - 落地页字段都是"当前生效"的单一资源,没必要让用户从历史列表里选;
 *   - 同名上传后端 (`purgeOldByFilename`) 会物理删旧 R2 prefix,真正"覆盖";
 *   - 业务字段独立 ⇒ 字段绑定的旧资源被覆盖时即时失效,不会引用残留死链。
 *
 * 历史"或直接粘贴 URL"输入框已移除 —— 现在只剩"上传/更换/清空"。
 */
interface Props {
  value: string;
  onChange: (url: string) => void;
  accept?: 'image' | 'video' | 'all';
  label?: string;
  previewHeight?: number;
  onUploadDone?: (info: {
    url: string;
    posterUrl?: string;
    kind?: string;
  }) => void;
  /** 明文上传(跳过 AES-GCM 加密),用于 logo / favicon 这类直接 <img src> 渲染的资产 */
  plain?: boolean;
}

export default function MediaPicker({
  value,
  onChange,
  accept = 'all',
  label,
  previewHeight = 80,
  onUploadDone,
  plain = false,
}: Props) {
  const [uploadProg, setUploadProg] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // 允许重复选同名

    if (accept === 'image' && !file.type.startsWith('image/')) {
      return toast.error('只能上传图片');
    }
    if (accept === 'video') {
      const isMp4 = file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
      if (!isMp4) {
        return toast.error('只支持 .mp4(服务器会自动转加密 HLS)');
      }
    }

    setUploadProg(0);
    try {
      const r = await mediaApi.upload(file, (p) => setUploadProg(p), { plain });
      toast.success(
        r.kind === 'hls'
          ? `上传成功:HLS ${r.segmentCount || 0} 分片 / ${r.duration || 0}s`
          : '上传成功'
      );
      onChange(r.url);
      onUploadDone?.({ url: r.url, posterUrl: r.posterUrl, kind: r.kind });
    } catch (err) {
      toast.error((err as Error).message || '上传失败');
    } finally {
      setUploadProg(null);
    }
  }

  function isImage(url: string) {
    // .png.enc / .jpg.enc / .png.js / .ico 等
    return /\.(png|jpe?g|gif|webp|svg|ico)(\.enc|\.js)?(\?|$)/i.test(url);
  }
  function isVideo(url: string) {
    if (/\.m3u8(\?|$)/i.test(url)) return true;
    return /\.(mp4|webm|mov)(\?|$)/i.test(url);
  }

  const acceptAttr =
    accept === 'image'
      ? 'image/*'
      : accept === 'video'
      ? 'video/mp4,.mp4'
      : 'image/*,video/mp4,.mp4';

  const uploadingLabel =
    uploadProg !== null ? `上传中 ${uploadProg}%` : value ? '更换' : '上传';

  return (
    <div>
      {label && <label>{label}</label>}

      <input
        ref={fileRef}
        type="file"
        accept={acceptAttr}
        style={{ display: 'none' }}
        onChange={onUpload}
      />

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
              style={{
                height: previewHeight,
                maxWidth: 160,
                borderRadius: 4,
                background: '#000',
              }}
              controls
              muted
            />
          ) : (
            <div style={{ color: 'var(--text-3)' }}>(未识别类型)</div>
          )}
          <div
            style={{
              flex: 1,
              fontSize: 12,
              color: 'var(--text-2)',
              wordBreak: 'break-all',
            }}
          >
            {value}
          </div>
          <button
            type="button"
            disabled={uploadProg !== null}
            onClick={() => fileRef.current?.click()}
          >
            {uploadingLabel}
          </button>
          <button
            type="button"
            className="danger"
            disabled={uploadProg !== null}
            onClick={() => onChange('')}
          >
            清空
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={uploadProg !== null}
          onClick={() => fileRef.current?.click()}
        >
          {uploadingLabel}
        </button>
      )}
    </div>
  );
}
