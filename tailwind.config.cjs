/**
 * Tailwind 配置
 * ------------------------------------------------------------------
 * 上游原本通过 `https://cdn.tailwindcss.com` 引入 Tailwind（外网 CDN），
 * 无法离线部署，也无法使用自定义主题。本文件把它切换为本地构建。
 *
 * 注意：`package.json` 里 `"type": "module"`，但 PostCSS / Tailwind 的
 * 配置加载器在部分场景下仍按 CJS 解析，因此这里显式使用 `.cjs` 后缀，
 * 避免 "module is not defined" 之类的加载错误。
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
