import { useEffect, useRef, useState } from 'react';
import { apkApi, landingApi, mediaApi } from '@/api/client';
import type { ApkItem, LandingConfig } from '@/types/config';
import { toast } from '@/components/Toast';
import MediaPicker from '@/components/MediaPicker';
import EncryptedImage from '@/components/EncryptedImage';
import { toPreviewUrl } from '@/store/mediaMeta';

const EMPTY: LandingConfig = {
  logo: '',
  favicon: '',
  seo: {
    title: '',
    description: '',
    keywords: '',
  },
  backgroundVideo: '',
  backgroundVideoPoster: '',
  telegramLink: '',
  openInstallAppKey: 'ecedok',
  androidApkUrl: '',
  androidApkFilename: '',
  iosDownloadUrl: '',
  downloadButtons: {
    ios: { label: '苹果手机下载', enabled: true },
    android: { label: '安卓手机下载', enabled: true },
  },
  vpnSection: {
    title: '全网首家,自带免费VPN',
    subtitle: '安全稳定,高速畅享全球网络',
  },
};

function fmtSize(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function LandingPage() {
  const [data, setData] = useState<LandingConfig>(EMPTY);
  const [orig, setOrig] = useState<LandingConfig>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // APK 上传 / 列表
  const [apkList, setApkList] = useState<ApkItem[]>([]);
  const [apkUploading, setApkUploading] = useState(false);
  const [apkProgress, setApkProgress] = useState(0);
  const apkFileRef = useRef<HTMLInputElement>(null);

  // favicon 上传(独立 input,不复用 MediaPicker:.ico 走明文不加密,
  // 也不需要列表选择;每次替换覆盖即可)
  const [faviconUploading, setFaviconUploading] = useState(false);
  const faviconFileRef = useRef<HTMLInputElement>(null);

  async function handleFaviconUpload(file: File) {
    if (!/\.ico$/i.test(file.name)) {
      toast.error('请选择 .ico 文件');
      return;
    }
    setFaviconUploading(true);
    try {
      const r = await mediaApi.upload(file);
      setData((prev) => ({ ...prev, favicon: r.url }));
      toast.success('favicon 已上传,记得点保存');
    } catch (e) {
      toast.error('上传失败:' + (e as Error).message);
    } finally {
      setFaviconUploading(false);
      if (faviconFileRef.current) faviconFileRef.current.value = '';
    }
  }

  async function refreshApkList() {
    try {
      const list = await apkApi.list();
      setApkList(list);
    } catch (e) {
      toast.error('APK 列表加载失败:' + (e as Error).message);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [d] = await Promise.all([landingApi.get(), refreshApkList()]);
        // 兼容老配置:缺字段补默认
        const merged: LandingConfig = {
          ...EMPTY,
          ...d,
          seo: { ...EMPTY.seo, ...(d.seo || {}) },
          downloadButtons: {
            ios: { ...EMPTY.downloadButtons.ios, ...(d.downloadButtons?.ios || {}) },
            android: {
              ...EMPTY.downloadButtons.android,
              ...(d.downloadButtons?.android || {}),
            },
          },
          vpnSection: { ...EMPTY.vpnSection, ...(d.vpnSection || {}) },
        };
        setData(merged);
        setOrig(merged);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleApkUpload(file: File) {
    if (!file.name.toLowerCase().endsWith('.apk')) {
      toast.error('请选择 .apk 文件');
      return;
    }
    setApkUploading(true);
    setApkProgress(0);
    try {
      const r = await apkApi.upload(file, (p) => setApkProgress(p));
      toast.success(`APK 上传成功 (${fmtSize(r.size)})`);
      setData((prev) => ({
        ...prev,
        androidApkUrl: r.url,
        androidApkFilename: r.filename,
      }));
      await refreshApkList();
    } catch (e) {
      toast.error('上传失败:' + (e as Error).message);
    } finally {
      setApkUploading(false);
      setApkProgress(0);
      if (apkFileRef.current) apkFileRef.current.value = '';
    }
  }

  async function handleApkDelete(id: number, url: string) {
    if (!confirm('确定删除该 APK?如果落地页正在使用同一个 URL,删除后会失效。'))
      return;
    try {
      await apkApi.remove(id);
      toast.success('已删除');
      // 当前 form 用的就是这个就清掉
      if (data.androidApkUrl === url) {
        setData((prev) => ({ ...prev, androidApkUrl: '', androidApkFilename: '' }));
      }
      await refreshApkList();
    } catch (e) {
      toast.error('删除失败:' + (e as Error).message);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await landingApi.put(data);
      setData(saved);
      setOrig(saved);
      toast.success('已保存,落地页 30 秒内自动拉到新配置');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(data) !== JSON.stringify(orig);
  if (loading) return <div className="card" style={{ textAlign: 'center', color: '#888' }}>加载中...</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
      <div className="card">
        <h2 className="page-title">真落地页内容(luodiye_video)</h2>
        <p className="page-desc">
          这些字段会以 JSON 形式被 luodiye_video 在客户端拉取并替换默认值。空值或加载失败时使用默认兜底。
        </p>

        <fieldset
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <legend style={{ padding: '0 6px', color: 'var(--text-2)' }}>
            SEO 元信息(浏览器标签页 / 分享卡片)
          </legend>

          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
            落地页加载后客户端会把这些值同步到 <code>&lt;title&gt;</code> /
            <code>&lt;meta description&gt;</code> / <code>&lt;meta keywords&gt;</code> 以及
            <code>og:title</code> / <code>og:description</code>。
            <br />
            ⚠ 微信 / Google / FB 等不跑 JS 的爬虫看到的是 build 时的兜底值;后台改完
            想让爬虫也认新值需要重新部署落地页。
          </div>

          <div className="form-row">
            <label>页面标题 (title)</label>
            <input
              type="text"
              value={data.seo.title}
              placeholder="留空 → 用 build 时默认"
              onChange={(e) =>
                setData({
                  ...data,
                  seo: { ...data.seo, title: e.target.value },
                })
              }
            />
          </div>

          <div className="form-row">
            <label>页面描述 (description)</label>
            <textarea
              rows={2}
              value={data.seo.description}
              placeholder="搜索结果摘要 + 微信分享卡片描述"
              onChange={(e) =>
                setData({
                  ...data,
                  seo: { ...data.seo, description: e.target.value },
                })
              }
            />
          </div>

          <div className="form-row">
            <label>关键词 (keywords, 逗号分隔)</label>
            <input
              type="text"
              value={data.seo.keywords}
              placeholder="kw1,kw2,kw3 — Google 已忽略,留作部分国内站兼容"
              onChange={(e) =>
                setData({
                  ...data,
                  seo: { ...data.seo, keywords: e.target.value },
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
          <legend style={{ padding: '0 6px', color: 'var(--text-2)' }}>媒体</legend>

          <div className="form-row">
            <MediaPicker
              label="Logo (左上角图标,对应 /image.png)"
              accept="image"
              value={data.logo}
              onChange={(url) => setData({ ...data, logo: url })}
            />
          </div>

          <div className="form-row">
            <label>浏览器 tab 图标 (favicon, .ico 明文存储)</label>
            {data.favicon ? (
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
                {/* favicon 是明文 .ico,直接 <img> 加载 */}
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <img
                  src={data.favicon}
                  alt=""
                  style={{
                    width: 32,
                    height: 32,
                    objectFit: 'contain',
                    background: '#fff',
                    borderRadius: 4,
                    padding: 2,
                  }}
                />
                <div
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: 'var(--text-2)',
                    wordBreak: 'break-all',
                  }}
                >
                  {data.favicon}
                </div>
                <button
                  type="button"
                  disabled={faviconUploading}
                  onClick={() => faviconFileRef.current?.click()}
                >
                  {faviconUploading ? '上传中...' : '更换'}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => setData({ ...data, favicon: '' })}
                >
                  清空
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="primary"
                  disabled={faviconUploading}
                  onClick={() => faviconFileRef.current?.click()}
                >
                  {faviconUploading ? '上传中...' : '上传 .ico'}
                </button>
                <input
                  type="text"
                  placeholder="或直接粘贴 favicon URL"
                  value={data.favicon}
                  onChange={(e) =>
                    setData({ ...data, favicon: e.target.value })
                  }
                  style={{ flex: 1 }}
                />
              </div>
            )}
            <input
              ref={faviconFileRef}
              type="file"
              accept=".ico,image/x-icon,image/vnd.microsoft.icon"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFaviconUpload(f);
              }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              .ico 文件不会被加密 / 压缩(浏览器原生 <code>&lt;link rel="icon"&gt;</code>
              不能解密,sharp 也不支持 ico 输出)。建议 16/32/48 多尺寸合体的标准 favicon.ico,留空则不渲染。
            </div>
          </div>

          <div className="form-row">
            <MediaPicker
              label="背景视频 (上传 mp4 → 自动转 AES-128 加密 HLS)"
              accept="video"
              value={data.backgroundVideo}
              onChange={(url) => setData({ ...data, backgroundVideo: url })}
              onUploadDone={({ url, posterUrl }) => {
                setData((prev) => ({
                  ...prev,
                  backgroundVideo: url,
                  // 用户没手动设过 poster 就自动填(已设过则保留用户值)
                  backgroundVideoPoster:
                    prev.backgroundVideoPoster || posterUrl || '',
                }));
              }}
              previewHeight={120}
            />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              只接受 mp4 输入(H.264, 建议 ≤ 30MB),服务器会 ffmpeg 转 AES-128 加密 HLS、
              截首帧 poster、上 R2。落地页只播 m3u8(走 /api/portal/m3u8 代理),
              CDN 上的 ts 是密文,key 经服务端鉴权分发。
            </div>
          </div>

          <div className="form-row">
            <MediaPicker
              label="视频首帧封面 (poster, 视频未加载时占位,避免黑屏)"
              accept="image"
              value={data.backgroundVideoPoster}
              onChange={(url) =>
                setData({ ...data, backgroundVideoPoster: url })
              }
            />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              上传 mp4 后自动填充。也可手动选别的图作为开机画面。
            </div>
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
            底部 VPN 文案
          </legend>

          <div className="form-row">
            <label>主标题 (vpnSection.title)</label>
            <input
              type="text"
              value={data.vpnSection.title}
              onChange={(e) =>
                setData({
                  ...data,
                  vpnSection: { ...data.vpnSection, title: e.target.value },
                })
              }
            />
          </div>

          <div className="form-row">
            <label>副标题 (vpnSection.subtitle)</label>
            <input
              type="text"
              value={data.vpnSection.subtitle}
              onChange={(e) =>
                setData({
                  ...data,
                  vpnSection: { ...data.vpnSection, subtitle: e.target.value },
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
          <legend style={{ padding: '0 6px', color: 'var(--text-2)' }}>下载按钮</legend>

          <div className="form-grid-2">
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={data.downloadButtons.ios.enabled}
                  onChange={(e) =>
                    setData({
                      ...data,
                      downloadButtons: {
                        ...data.downloadButtons,
                        ios: {
                          ...data.downloadButtons.ios,
                          enabled: e.target.checked,
                        },
                      },
                    })
                  }
                />
                启用 iOS 按钮
              </label>
              <input
                type="text"
                placeholder="按钮文字"
                value={data.downloadButtons.ios.label}
                onChange={(e) =>
                  setData({
                    ...data,
                    downloadButtons: {
                      ...data.downloadButtons,
                      ios: { ...data.downloadButtons.ios, label: e.target.value },
                    },
                  })
                }
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={data.downloadButtons.android.enabled}
                  onChange={(e) =>
                    setData({
                      ...data,
                      downloadButtons: {
                        ...data.downloadButtons,
                        android: {
                          ...data.downloadButtons.android,
                          enabled: e.target.checked,
                        },
                      },
                    })
                  }
                />
                启用 Android 按钮
              </label>
              <input
                type="text"
                placeholder="按钮文字"
                value={data.downloadButtons.android.label}
                onChange={(e) =>
                  setData({
                    ...data,
                    downloadButtons: {
                      ...data.downloadButtons,
                      android: {
                        ...data.downloadButtons.android,
                        label: e.target.value,
                      },
                    },
                  })
                }
              />
            </div>
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
            iOS 下载链接(可选)
          </legend>

          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
            填了 iOS 链接时,落地页 iOS 按钮变成 <code>&lt;a href&gt;</code> 直跳;
            留空则继续走 OpenInstall SDK。常见格式:
            <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
              <li><code>https://apps.apple.com/...</code> — App Store 上架</li>
              <li><code>https://testflight.apple.com/join/xxx</code> — TestFlight 内测</li>
              <li><code>itms-services://?action=download-manifest&url=https://你的域名/xxx.plist</code> — 企业证书 / 超级签名</li>
              <li>任何 https URL — 第三方分发跳板</li>
            </ul>
          </div>

          <div className="form-row">
            <label>当前 iosDownloadUrl</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={data.iosDownloadUrl}
                placeholder="留空走 OpenInstall;或粘贴 App Store / TestFlight / itms-services URL"
                onChange={(e) =>
                  setData({ ...data, iosDownloadUrl: e.target.value })
                }
              />
              <button
                type="button"
                onClick={() => setData({ ...data, iosDownloadUrl: '' })}
                disabled={!data.iosDownloadUrl}
              >
                清空
              </button>
              {data.iosDownloadUrl && !data.iosDownloadUrl.startsWith('itms-services:') && (
                <a
                  href={data.iosDownloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn"
                  style={{
                    border: '1px solid var(--border)',
                    padding: '0 12px',
                    borderRadius: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  测试打开
                </a>
              )}
            </div>
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
            Android APK 直接下载(可选)
          </legend>

          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
            填了 APK 直链时,落地页 Android 按钮会直接下载该 .apk(走 R2 + 腾讯
            CDN);留空则继续走 OpenInstall SDK。文件改名为 .bin 上传 R2,
            浏览器拿到后通过 Content-Disposition 自动还原为 .apk 名。
          </div>

          <div className="form-row">
            <label>
              当前 androidApkUrl
              {data.androidApkFilename && (
                <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 8 }}>
                  ({data.androidApkFilename})
                </span>
              )}
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={data.androidApkUrl}
                placeholder="留空走 OpenInstall;或上传后自动填入 R2 URL"
                onChange={(e) =>
                  setData({ ...data, androidApkUrl: e.target.value })
                }
              />
              <button
                type="button"
                onClick={() =>
                  setData({ ...data, androidApkUrl: '', androidApkFilename: '' })
                }
                disabled={!data.androidApkUrl}
              >
                清空
              </button>
              {data.androidApkUrl && (
                <a
                  href={data.androidApkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn"
                  style={{
                    border: '1px solid var(--border)',
                    padding: '0 12px',
                    borderRadius: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  测试下载
                </a>
              )}
            </div>
          </div>

          <div className="form-row">
            <label>上传新 APK</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                ref={apkFileRef}
                type="file"
                accept=".apk,application/vnd.android.package-archive"
                disabled={apkUploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleApkUpload(f);
                }}
              />
              {apkUploading && (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  上传中 {apkProgress}%
                </span>
              )}
            </div>
          </div>

          {apkList.length > 0 && (
            <div className="form-row">
              <label>已上传 APK 列表</label>
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                {apkList.map((a) => {
                  const inUse = a.url === data.androidApkUrl;
                  return (
                    <div
                      key={a.id}
                      style={{
                        display: 'flex',
                        gap: 8,
                        padding: '6px 10px',
                        borderBottom: '1px solid var(--border)',
                        alignItems: 'center',
                        background: inUse ? 'rgba(99,102,241,0.08)' : undefined,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {a.filename}
                          {inUse && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 11,
                                color: 'var(--primary)',
                              }}
                            >
                              ● 当前使用
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {fmtSize(a.size)} · {a.backend || 'local'} ·{' '}
                          {new Date(a.created_at * 1000).toLocaleString()}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={inUse}
                        onClick={() =>
                          setData({
                            ...data,
                            androidApkUrl: a.url,
                            androidApkFilename: a.filename,
                          })
                        }
                      >
                        使用
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleApkDelete(a.id, a.url)}
                      >
                        删除
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </fieldset>

        <fieldset
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <legend style={{ padding: '0 6px', color: 'var(--text-2)' }}>跳转/SDK</legend>

          <div className="form-row">
            <label>Telegram 官方合作链接 (telegramLink)</label>
            <input
              type="text"
              value={data.telegramLink}
              placeholder="https://t.me/xxx — 留空则落地页不显示官方合作按钮"
              onChange={(e) => setData({ ...data, telegramLink: e.target.value })}
            />
            <small style={{ color: 'var(--text-3)' }}>
              留空 = 落地页不渲染右侧"官方合作"浮动按钮
            </small>
          </div>

          <div className="form-row">
            <label>OpenInstall AppKey (openInstallAppKey)</label>
            <input
              type="text"
              value={data.openInstallAppKey}
              onChange={(e) =>
                setData({ ...data, openInstallAppKey: e.target.value })
              }
            />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              对应 https://res.opstatistics.com/openinstall-{'{key}'}.js
            </div>
          </div>
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

      <div className="card" style={{ position: 'sticky', top: 16, alignSelf: 'flex-start' }}>
        <h3 className="page-title" style={{ fontSize: 14 }}>预览</h3>
        <div
          style={{
            position: 'relative',
            background: '#000',
            borderRadius: 8,
            overflow: 'hidden',
            height: 480,
            color: '#fff',
          }}
        >
          {data.backgroundVideoPoster && (
            <EncryptedImage
              src={toPreviewUrl(data.backgroundVideoPoster)}
              alt=""
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          )}
          {data.backgroundVideo ? (
            // 预览面板里只是示意,m3u8 浏览器(Chrome)不原生支持,这里直接挂 src 在 Safari 才能播
            <video
              key={data.backgroundVideo}
              src={toPreviewUrl(data.backgroundVideo)}
              autoPlay
              muted
              loop
              playsInline
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : !data.backgroundVideoPoster ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666',
                fontSize: 12,
              }}
            >
              未配置背景视频
            </div>
          ) : null}

          {/* logo */}
          {data.logo && (
            <EncryptedImage
              src={toPreviewUrl(data.logo)}
              alt=""
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                height: 40,
                width: 40,
                objectFit: 'contain',
              }}
            />
          )}

          {/* footer */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: 16,
              background:
                'linear-gradient(180deg, transparent, rgba(0,0,0,0.4))',
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {data.vpnSection.title}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                {data.vpnSection.subtitle}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'center',
              }}
            >
              {data.downloadButtons.ios.enabled && (
                <div
                  style={{
                    background: 'linear-gradient(90deg,#ec4899,#dc2626)',
                    color: '#fff',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {data.downloadButtons.ios.label || '苹果手机下载'}
                </div>
              )}
              {data.downloadButtons.android.enabled && (
                <div
                  style={{
                    background: 'linear-gradient(90deg,#ec4899,#dc2626)',
                    color: '#fff',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {data.downloadButtons.android.label || '安卓手机下载'}
                </div>
              )}
              {!data.downloadButtons.ios.enabled &&
                !data.downloadButtons.android.enabled && (
                  <div style={{ fontSize: 12, color: '#999' }}>
                    (未启用任何下载按钮)
                  </div>
                )}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          预览仅模拟移动端竖屏,实际样式以落地页为准。
        </div>
      </div>
    </div>
  );
}
