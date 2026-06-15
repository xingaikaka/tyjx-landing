import axios, { AxiosError } from 'axios';
import { useAuthStore } from '@/store/auth';
import type {
  ApiResp,
  ApkItem,
  DomainsConfig,
  PortalUIConfig,
  LandingConfig,
  MediaItem,
  UploadResp,
  AdminUser,
} from '@/types/config';

const baseURL = (import.meta.env.VITE_API_BASE as string) || '';

const http = axios.create({
  baseURL,
  timeout: 30000,
});

http.interceptors.request.use((cfg) => {
  const t = useAuthStore.getState().token;
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

http.interceptors.response.use(
  (r) => r,
  (err: AxiosError<ApiResp<unknown>>) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);

function unwrap<T>(p: Promise<{ data: ApiResp<T> }>): Promise<T> {
  return p.then((r) => {
    if (!r.data?.ok) {
      const msg = r.data?.errors?.length
        ? r.data.errors.join('; ')
        : r.data?.msg || '请求失败';
      throw new Error(msg);
    }
    return r.data.data as T;
  });
}

/* ─────────── auth ─────────── */

export const authApi = {
  login: (username: string, password: string) =>
    http
      .post<ApiResp<never> & { token: string; user: AdminUser }>('/api/admin/login', {
        username,
        password,
      })
      .then((r) => {
        if (!r.data?.ok) throw new Error(r.data?.msg || '登录失败');
        return { token: r.data.token, user: r.data.user };
      }),

  me: () =>
    http
      .get<ApiResp<never> & { user: AdminUser }>('/api/admin/me')
      .then((r) => {
        if (!r.data?.ok) throw new Error(r.data?.msg || '');
        return r.data.user;
      }),

  changePassword: (oldPassword: string, newPassword: string) =>
    unwrap<unknown>(
      http.put('/api/admin/password', { oldPassword, newPassword })
    ),
};

/* ─────────── config ─────────── */

export const domainsApi = {
  get: () => unwrap<DomainsConfig>(http.get('/api/admin/domains')),
  put: (data: DomainsConfig) =>
    unwrap<DomainsConfig>(http.put('/api/admin/domains', data)),
};

export const portalUIApi = {
  get: () => unwrap<PortalUIConfig>(http.get('/api/admin/portalUI')),
  put: (data: PortalUIConfig) =>
    unwrap<PortalUIConfig>(http.put('/api/admin/portalUI', data)),
};

export const landingApi = {
  get: () => unwrap<LandingConfig>(http.get('/api/admin/landing')),
  put: (data: LandingConfig) =>
    unwrap<LandingConfig>(http.put('/api/admin/landing', data)),
};

/* ─────────── media ─────────── */

/**
 * /api/admin/media/_meta 返回的存储 meta:
 *   - cdnBase       媒体 URL 当前生效的对外前缀(后台 mediaCdnBase 配置 → env CDN_BASE → env R2_PUBLIC_BASE)
 *   - r2PublicBase  R2 公网域(pub-xxx.r2.dev),仅供前端兜底显示
 *   - assetAesKey   加密图片(.enc)的 AES-256-GCM key(64 hex),给 EncryptedImage 解密用
 */
export interface MediaMeta {
  backend: 'local' | 'r2';
  cdnBase: string;
  r2PublicBase: string;
  assetAesKey: string;
}

/** /api/admin/system 返回:当前生效配置 + env 默认值(只读) */
export interface SystemConfig {
  /** 后台配置的 mediaCdnBase(空字符串表示未配,fallback env) */
  mediaCdnBase: string;
  envCdnBase: string;
  envR2PublicBase: string;
}

export const systemApi = {
  get: () => unwrap<SystemConfig>(http.get('/api/admin/system')),
  put: (mediaCdnBase: string) =>
    unwrap<SystemConfig>(http.put('/api/admin/system', { mediaCdnBase })),
};

export const mediaApi = {
  list: () => unwrap<MediaItem[]>(http.get('/api/admin/media')),
  meta: () => unwrap<MediaMeta>(http.get('/api/admin/media/_meta')),

  upload: (
    file: File,
    onProgress?: (pct: number) => void,
    opts?: { plain?: boolean },
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    // plain=1: 跳过 AES-GCM 加密,适用于 portalUI.logo / favicon 等中转层直接 <img src>
    // 渲染的资产(浏览器无法解密 .enc 密文)。
    const url = opts?.plain ? '/api/admin/media?plain=1' : '/api/admin/media';
    return http
      .post<ApiResp<UploadResp>>(url, fd, {
        onUploadProgress: (e) => {
          if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
        },
        // mp4 转 HLS 服务端串行上传分片可能要几分钟,超时给 30 分钟
        timeout: 30 * 60 * 1000,
      })
      .then((r) => {
        if (!r.data?.ok) throw new Error(r.data?.msg || '上传失败');
        return r.data.data!;
      });
  },

  remove: (id: number) => unwrap<unknown>(http.delete(`/api/admin/media/${id}`)),
};

/* ─────────── apk ─────────── */

export const apkApi = {
  list: () => unwrap<ApkItem[]>(http.get('/api/admin/apk')),

  upload: (file: File, slug?: string, onProgress?: (pct: number) => void) => {
    const fd = new FormData();
    fd.append('file', file);
    if (slug) fd.append('slug', slug);
    return http
      .post<ApiResp<ApkItem>>('/api/admin/apk', fd, {
        onUploadProgress: (e) => {
          if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
        },
        // 大 APK 上传慢,给 30 分钟
        timeout: 30 * 60 * 1000,
      })
      .then((r) => {
        if (!r.data?.ok) throw new Error(r.data?.msg || '上传失败');
        return r.data.data!;
      });
  },

  /** 手动调腾讯云 CDN 刷新这个 APK 的固定地址 */
  purge: (id: number) =>
    unwrap<{ url: string; ok: boolean; taskId?: string; msg?: string }>(
      http.post(`/api/admin/apk/${id}/purge`)
    ),

  remove: (id: number) => unwrap<unknown>(http.delete(`/api/admin/apk/${id}`)),
};

export default http;
