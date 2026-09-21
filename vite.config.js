import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.', // 项目根目录
  build: {
    outDir: 'dist', // 打包输出到 dist 文件夹，而不是 public
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:9993' // 开发模式下代理 API 请求到后端 (Corrected port to match server.js)
    }
  }
});