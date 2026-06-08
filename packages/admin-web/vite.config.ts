import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3011,
    host: true,
    // 本地开发时把 /api 转发到 admin-server,避免 CORS
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
});
