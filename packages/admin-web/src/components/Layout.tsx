import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import ChangePasswordModal from '@/pages/ChangePasswordModal';

const TABS = [
  { to: '/domains', label: '域池管理' },
  { to: '/portal-ui', label: '入口/发布页' },
  { to: '/landing', label: '真落地页' },
  { to: '/media', label: '媒体库' },
  { to: '/system', label: '系统设置' },
];

export default function Layout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const nav = useNavigate();
  const [showPwd, setShowPwd] = useState(false);

  function doLogout() {
    logout();
    nav('/login', { replace: true });
  }

  return (
    <div className="layout">
      <div className="topbar">
        <div className="brand">tyjx · 对外管理</div>

        <nav className="tabs">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="userbox">
          <span>{user?.username || '-'}</span>
          <button onClick={() => setShowPwd(true)}>改密</button>
          <button onClick={doLogout}>退出</button>
        </div>
      </div>

      <main className="content">
        <Outlet />
      </main>

      {showPwd && <ChangePasswordModal onClose={() => setShowPwd(false)} />}
    </div>
  );
}
