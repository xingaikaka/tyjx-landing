import { create } from 'zustand';
import { useEffect } from 'react';

type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  msg: string;
}
interface ToastState {
  items: ToastItem[];
  push: (kind: ToastKind, msg: string) => void;
  dismiss: (id: number) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (kind, msg) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { id, kind, msg }] }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, 3000);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (m: string) => useToastStore.getState().push('info', m),
  success: (m: string) => useToastStore.getState().push('success', m),
  error: (m: string) => useToastStore.getState().push('error', m),
};

export function ToastViewport() {
  const items = useToastStore((s) => s.items);
  useEffect(() => {}, [items]);
  return (
    <div>
      {items.map((t, i) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          style={{ top: 16 + i * 48 }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
