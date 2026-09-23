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
    extend: {
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(26px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-16px)' } },
        'float-slow': { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(18px,-26px) scale(1.06)' } },
        'pulse-ring': { '0%': { transform: 'scale(0.65)', opacity: '0.55' }, '80%': { opacity: '0' }, '100%': { transform: 'scale(2.4)', opacity: '0' } },
        'gradient-x': { '0%,100%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        'spin-slow': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
        'scale-in': { '0%': { opacity: '0', transform: 'scale(0.96)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'bounce-soft': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.8s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fade-in 1s ease-out both',
        float: 'float 6s ease-in-out infinite',
        'float-slow': 'float-slow 11s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 3.6s cubic-bezier(0.2,0.6,0.4,1) infinite',
        'gradient-x': 'gradient-x 7s ease infinite',
        shimmer: 'shimmer 2.6s linear infinite',
        'spin-slow': 'spin-slow 26s linear infinite',
        'scale-in': 'scale-in 0.7s cubic-bezier(0.16,1,0.3,1) both',
        'bounce-soft': 'bounce-soft 3.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
