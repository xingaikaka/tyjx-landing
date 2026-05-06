import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/api/client';
import { useAuthStore } from '@/store/auth';

export default function LoginPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const setAuth = useAuthStore((s) => s.setAuth);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) {
      setErr('请填写用户名和密码');
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const { token, user } = await authApi.login(username, password);
      setAuth(token, user);
      nav('/', { replace: true });
    } catch (e) {
      setErr((e as Error).message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-bg">
      <form className="login-box" onSubmit={submit}>
        <h1>tyjx · 对外管理后台</h1>
        <p className="sub">tyjx-portal admin</p>

        <div className="field">
          <label>用户名</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </div>

        <div className="field">
          <label>密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {err && <div className="err">{err}</div>}

        <button
          type="submit"
          className="primary"
          style={{ width: '100%', marginTop: 16, height: 36 }}
          disabled={loading}
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}
