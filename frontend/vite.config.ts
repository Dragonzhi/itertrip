import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发期把 /api 代理到 FastAPI（backend/，默认 8787）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});