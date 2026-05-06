import { useState } from 'react';
import { authApi } from '@/api/client';
import { toast } from '@/components/Toast';

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPwd.length < 8) return toast.error('新密码至少 8 位');
    if (newPwd !== confirm) return toast.error('两次新密码不一致');
    setLoading(true);
    try {
      await authApi.changePassword(oldPwd, newPwd);
      toast.success('密码已修改,请重新登录');
      setTimeout(onClose, 800);
    } catch (err) {
      toast.error((err as Error).message || '修改失败');
    } finally {
      setLoading(false);
    }
  }

  return (
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
      onClick={onClose}
    >
      <form
        className="card"
        style={{ width: 400, maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="page-title">修改密码</h2>

        <div className="form-row">
          <label>当前密码</label>
          <input
            type="password"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>

        <div className="form-row">
          <label>新密码(≥ 8 位)</label>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div className="form-row">
          <label>确认新密码</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div className="actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? '提交中...' : '提交'}
          </button>
        </div>
      </form>
    </div>
  );
}
