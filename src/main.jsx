import React from 'react';
import ReactDOM from 'react-dom/client';
// 注意：实际文件名是小写 app.jsx。写成 './App' 在 Windows 上能跑，
// 但在 Linux（含 Docker 构建）下大小写敏感，会直接构建失败。
import App from './app.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);