import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';

interface Props extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** R2/CDN URL;可以是 .enc 密文或历史明文 */
  src: string;
}

const PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

const API_BASE = ((import.meta.env.VITE_API_BASE as string) || '').replace(/\/+$/, '');

function isEncrypted(src: string): boolean {
  return /\.enc(\?|$|#)/i.test(src);
}

/**
 * admin 后台预览图(参考 dp/tyjx-admin 同款实现)。
 *
 * 核心思想:**不在浏览器解密**,改走 admin-server 鉴权代理:
 *   <img>     ← URL.createObjectURL(blob)
 *               ↑ blob from fetch() with Bearer token
 *   GET /api/admin/media/raw?url=<原 R2 .enc URL>
 *               ↓ admin-server 内存中 AES-GCM 解密
 *   原始 png/jpg
 *
 * 优点:
 *   1. **不依赖 secure context**—— HTTP / IP / 局域网访问都能用
 *      浏览器 Web Crypto 仅在 https 或 localhost 可用,后台预览常用 IP/HTTP,坑过太多次
 *   2. 前端逻辑极简,等同于"普通 img + 鉴权拉图"
 *   3. assetAesKey 不再下发到浏览器(更安全)
 *
 * 缺点:
 *   - 流量经过 admin-server,但后台访问量很低,小图 + 5 分钟 cache,无影响
 */
export default function EncryptedImage({ src, style, ...rest }: Props) {
  const token = useAuthStore((s) => s.token);
  const [blobUrl, setBlobUrl] = useState('');
  const [errMsg, setErrMsg] = useState('');

  const encrypted = !!src && isEncrypted(src);

  useEffect(() => {
    let cancelled = false;
    let revoke: string | null = null;
    setBlobUrl('');
    setErrMsg('');

    if (!src || !encrypted) return;
    if (!token) {
      setErrMsg('未登录');
      return;
    }

    const proxy = `${API_BASE}/api/admin/media/raw?url=${encodeURIComponent(src)}`;
    fetch(proxy, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) {
          let msg = `HTTP ${r.status}`;
          try {
            const j = await r.json();
            if (j?.msg) msg = j.msg;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        return r.blob();
      })
      .then((b) => {
        if (cancelled) return;
        const u = URL.createObjectURL(b);
        revoke = u;
        setBlobUrl(u);
      })
      .catch((e) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[enc-img] proxy fetch fail:', src, e?.message ?? e);
        setErrMsg(e?.message || String(e));
      });

    return () => {
      cancelled = true;
      // setState 用的 blob 还在 dom 引用着,这里不能立刻 revoke,
      // 留给浏览器 GC 即可(blob 内存量小且有 LRU cache 行为)。
      // 真要 revoke 的话需要 onLoad 后再做,过度优化暂不做。
      void revoke;
    };
  }, [src, encrypted, token]);

  if (!src) return null;

  // 历史明文图直接挂
  if (!encrypted) {
    return <img src={src} style={style} {...rest} />;
  }

  if (errMsg) {
    return (
      <div
        title={errMsg}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
          fontSize: 11,
          color: '#a00',
          background: '#fff5f5',
          border: '1px dashed #fcc',
          borderRadius: 4,
          textAlign: 'center',
          ...style,
        }}
      >
        预览失败: {errMsg.length > 32 ? errMsg.slice(0, 32) + '…' : errMsg}
      </div>
    );
  }

  if (blobUrl) {
    return <img src={blobUrl} style={style} {...rest} />;
  }

  // 拉取中:1×1 透明 PNG 占位,保 width/height/maxWidth 生效
  return (
    <img
      src={PLACEHOLDER}
      style={{ background: '#f0f0f0', ...style }}
      {...rest}
    />
  );
}
