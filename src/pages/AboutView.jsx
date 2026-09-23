import React from 'react';
import {
  Award,
  RadioTower,
  LayoutDashboard,
  BadgeCheck,
  QrCode,
  ShieldCheck,
  Globe,
  FileText,
  Sun,
  Moon,
} from 'lucide-react';

/**
 * 关于页（公开）
 * ------------------------------------------------------------------
 * 入口：首页导航 / 页脚的「关于」→ `#/about`，由 `App` 在登录判断之前拦截渲染。
 * 视觉与首页一致（深色科技风），自包含，不依赖 .app-dark 覆盖。
 */

const FEATURES = [
  { icon: RadioTower, title: 'LoTW 直连导入', desc: '直接拉取 ARRL LoTW 通联记录，省去手工导出 ADIF。' },
  { icon: LayoutDashboard, title: '可视化奖状设计器', desc: '拖拽排布文字、图形、底图与二维码，支持多等级差异。' },
  { icon: BadgeCheck, title: '在线申请与审核', desc: '按规则自动匹配 QSO 并计算进度，申请、审核、颁发全流程在线。' },
  { icon: QrCode, title: '二维码真伪校验', desc: '每张奖状带唯一序列号，扫码即可验真，并对呼号脱敏。' },
];

const TECH = ['React 18', 'Vite', 'Tailwind CSS', 'Express', 'PostgreSQL', 'MinIO'];

export default function AboutView({ onBack, theme = 'dark', onToggleTheme }) {
  return (
    <div className={`${theme === 'dark' ? 'app-dark' : 'app-light'} relative min-h-screen overflow-x-hidden bg-slate-950 antialiased`}>
      {/* 背景 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(255,255,255,0.06), transparent)' }} />
      </div>

      <div className="relative">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/60 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 text-sm font-bold text-slate-300 transition-colors hover:text-white"
            >
              <span className="text-base leading-none">←</span> 返回
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onToggleTheme}
                title={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
                className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:text-white"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 text-slate-950">
                  <Award size={16} />
                </span>
                <span className="text-sm font-black tracking-[0.2em]">
                  HAM<span className="text-cyan-400">AWARDS</span>
                </span>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-6 py-16">
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">关于 HAM AWARDS</h1>
          <p className="mt-5 max-w-3xl leading-relaxed text-slate-400">
            HAM AWARDS 是一套面向业余无线电爱好者的<b className="text-slate-200">奖状管理系统</b>。
            它把 LoTW / ADIF 通联日志导入、奖状规则匹配、在线申请与审核、以及二维码真伪校验连成一条完整链路，
            让每一次通联都有据可查、有荣誉可循。
          </p>

          <section className="mt-12">
            <h2 className="text-lg font-bold text-white">主要功能</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-indigo-500/20 text-cyan-300">
                      <f.icon size={18} />
                    </span>
                    <h3 className="font-bold">{f.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-12">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Globe size={18} className="text-cyan-300" /> 技术栈
            </h2>
            <div className="mt-4 flex flex-wrap gap-2.5 text-xs text-slate-300">
              {TECH.map((t) => (
                <span key={t} className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{t}</span>
              ))}
            </div>
          </section>

          <section className="mt-12">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <ShieldCheck size={18} className="text-cyan-300" /> 开源与许可
            </h2>
            <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-relaxed text-slate-400 backdrop-blur">
              <p>
                本项目基于开源项目
                <span className="mx-1 font-mono text-slate-200">BH2VSQ/Ham-awards-SelfDefine</span>
                进行二次开发，并在其基础上增加了 Docker 部署、LoTW 直连、可视化奖状设计器、
                PDF 导出、二维码校验与 HamCQ 登录等能力。
              </p>
              <p>
                项目遵循 <b className="text-slate-200">GPL-3.0</b> 开源许可。对外分发本项目的衍生作品时，
                需同样以 GPL-3.0 授权并提供源码；仅自用或内部使用不受此限制。
              </p>
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <FileText size={14} /> 本页仅作项目说明，不构成任何形式的担保。
              </p>
            </div>
          </section>
        </main>

        <footer className="border-t border-white/10 px-6 py-10">
          <div className="mx-auto max-w-4xl text-center text-xs text-slate-500">
            <div className="flex items-center justify-center gap-5">
              <a href="#/privacy" className="transition-colors hover:text-cyan-300">隐私政策</a>
              <a href="#/terms" className="transition-colors hover:text-cyan-300">用户协议</a>
              <a href="#/protocol" className="transition-colors hover:text-cyan-300">内容规范</a>
            </div>
            <p className="mt-2">© 2026 HAM AWARDS · 业余无线电奖状管理</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
