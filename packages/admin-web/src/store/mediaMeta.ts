/**
 * media meta 全局缓存 + 工具:
 *   - 启动时拉一次 /api/admin/media/_meta(cdnBase / r2PublicBase)
 *   - toPreviewUrl(url):把响应里的 cdnBase url 强制切回 R2 公网域,仅 admin 端预览用
 *
 * 设计取舍(两层 host 重写):
 *   ① 后端 rewriteUrlsByCdnBase  → 把 DB 里历史 URL host 切到当前后台配的 mediaCdnBase
 *      落地页拉 /api/portal/landing/config 拿到的 URL 永远是这个值
 *   ② 前端 toPreviewUrl           → 把后端给的 URL 再强制切到 R2 公网(pub-xxx.r2.dev)
 *      仅 admin 内部预览用,意义在于:
 *        - mediaCdnBase 还是 tyjx.calculus.xin 时 admin DNS 也通(内部直连 R2)
 *        - 改 R2 后没有 CDN 缓存延迟,所见即所得
 *
 * SystemPage 改 mediaCdnBase 后会主动调 load() 刷这份 meta,确保 cdnBase 即时同步。
 */

import { create } from 'zustand';
import { mediaApi, type MediaMeta } from '@/api/client';

interface MediaMetaState {
  data: MediaMeta | null;
  loading: boolean;
  /** force=true 时绕过 cache,SystemPage 改完 cdnBase 立刻调一次 */
  load: (force?: boolean) => Promise<MediaMeta | null>;
}

export const useMediaMetaStore = create<MediaMetaState>((set, get) => ({
  data: null,
  loading: false,
  load: async (force = false) => {
    if (!force) {
      const cur = get().data;
      if (cur) return cur;
      if (get().loading) {
        return new Promise((resolve) => {
          const t = setInterval(() => {
            if (!get().loading) {
              clearInterval(t);
              resolve(get().data);
            }
          }, 50);
        });
      }
    }
    set({ loading: true });
    try {
      const data = await mediaApi.meta();
      set({ data });
      return data;
    } catch {
      set({ data: null });
      return null;
    } finally {
      set({ loading: false });
    }
  },
}));

/**
 * 把数据库存的 cdn url 转成 admin 预览专用的 R2 公网域 url。
 * meta 没拉到 / 不是 cdn 前缀 / 两个域相同 → 原样返回。
 */
export function toPreviewUrl(url: string): string {
  if (!url) return url;
  const meta = useMediaMetaStore.getState().data;
  if (!meta) return url;
  const { cdnBase, r2PublicBase } = meta;
  if (!cdnBase || !r2PublicBase || cdnBase === r2PublicBase) return url;
  if (url.startsWith(cdnBase + '/')) {
    return r2PublicBase + url.slice(cdnBase.length);
  }
  return url;
}
