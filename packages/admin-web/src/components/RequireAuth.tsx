import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { useMediaMetaStore } from '@/store/mediaMeta';
import { authApi } from '@/api/client';

/**
 * 路由级守卫:
 *  - 没 token → 跳 /login
 *  - 有 token → 拉一次 /me 校验,通过才渲染子路由
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, setAuth, logout } = useAuthStore();
  const [checking, setChecking] = useState(!!token);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setChecking(false);
      return;
    }
    authApi
      .me()
      .then((u) => {
        if (alive) {
          setAuth(token, u);
          setValid(true);
          // 顺手把 media meta(cdnBase / r2PublicBase) 拉到 store,
          // 后续 MediaPicker 预览失败可以无声 fallback 到 R2 公网域。
          useMediaMetaStore.getState().load();
        }
      })
      .catch(() => {
        if (alive) logout();
      })
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) return <Navigate to="/login" replace />;
  if (checking) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
        加载中...
      </div>
    );
  }
  if (!valid) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
