import React from 'react';
import ReactDOM from 'react-dom/client';
// 注意：实际文件名是小写 app.jsx。写成 './App' 在 Windows 上能跑，
// 但在 Linux（含 Docker 构建）下大小写敏感，会直接构建失败。
import App from './app.jsx';
import './index.css';
import { reloadForNewVersion } from './lib/lazyImport.js';

/**
 * 部署后旧页面自愈（2026-09-24）
 * ------------------------------------------------------------------
 * Vite 会为按需加载的模块生成带内容 hash 的 chunk。重新构建后旧 hash 文件被删除，
 * 而**还开着的旧页面**仍会去请求它 → `Failed to fetch dynamically imported module`。
 * 这里兜住 Vite 的 `vite:preloadError` 事件（所有按需加载都走它），自动刷新一次拿新版本，
 * 避免用户看到一句英文报错就以为功能坏了。
 * 只在 15 秒内没刷过时执行，防止服务器真故障时无限刷新（见 lib/lazyImport.js）。
 */
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewVersion()) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
