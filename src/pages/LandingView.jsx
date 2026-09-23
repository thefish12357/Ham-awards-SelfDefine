import React, { useEffect, useRef } from 'react';
import {
  Award,
  Radio,
  RadioTower,
  Upload,
  CheckCircle2,
  ShieldCheck,
  QrCode,
  Sparkles,
  ArrowRight,
  LogIn,
  LayoutDashboard,
  FileText,
  BadgeCheck,
  Signal,
  Globe,
  Star,
  Activity,
  ChevronRight,
  Waves,
  Sun,
  Moon,
} from 'lucide-react';

/**
 * 网站首页（Landing）
 * ------------------------------------------------------------------
 * 定位：`App` 在「已安装但未登录」时优先展示本页（view === 'landing'）。
 * - 通过 onLogin / onRegister 回调进入登录/注册（App 切到 view === 'auth'）。
 * - 动效全部基于 Tailwind 关键帧（tailwind.config.cjs）+ IntersectionObserver
 *   的滚动进入（data-reveal），不引入额外动画依赖。
 * - 约定：Tailwind 只扫描完整字面量类名，禁止用 `bg-${x}` 这类拼接写法。
 */

const FEATURES = [
  {
    icon: RadioTower,
    tone: 'from-cyan-300 to-sky-500',
    title: 'LoTW 直连导入',
    desc: '输入 LoTW 凭据即可拉取通联记录，无需手工导出 ADIF；凭据仅在服务端内存转发，不落库、不落盘。',
  },
  {
    icon: LayoutDashboard,
    tone: 'from-indigo-300 to-violet-500',
    title: '可视化奖状设计器',
    desc: '拖拽排布文字、图形、底图与二维码，支持多等级差异（Gold / Silver 各一套样式），所见即所得。',
  },
  {
    icon: BadgeCheck,
    tone: 'from-amber-300 to-orange-500',
    title: '在线申请与审核',
    desc: '按奖状规则自动匹配 QSO 并计算进度，提交后流转至审核员，全程站内通知，进度随时可查。',
  },
  {
    icon: QrCode,
    tone: 'from-emerald-300 to-teal-500',
    title: '二维码真伪校验',
    desc: '每张奖状生成唯一序列号与二维码，任何人扫码即可验真，展示时自动对呼号脱敏。',
  },
];

const WORKFLOW = [
  { step: '01', icon: Upload, title: '导入通联日志', desc: '上传 ADIF 文件，或用 LoTW 直连拉取最近的已确认 QSO。' },
  { step: '02', icon: Activity, title: '匹配奖状规则', desc: '系统按奖状规则评估 DXCC、波段、网格等目标完成度。' },
  { step: '03', icon: Award, title: '申请与颁发', desc: '在线提交申请，管理员审核通过后即可下载 PDF 奖状。' },
];

const HIGHLIGHTS = [
  { icon: ShieldCheck, label: '凭据零留存' },
  { icon: Signal, label: '自动二分重试' },
  { icon: Globe, label: '多波段支持' },
  { icon: Star, label: '多等级奖状' },
];

const CAPABILITIES = ['LoTW 直连', 'ADIF 解析', '可视化设计器', '多等级差异', '二维码校验', 'GPL-3.0'];

function SectionHeading({ eyebrow, title, desc }) {
  return (
    <div data-reveal className="opacity-0 max-w-2xl">
      <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em] text-cyan-300">
        <span className="h-px w-8 bg-cyan-400/50" />
        {eyebrow}
      </div>
      <h2 className="mt-4 text-3xl font-black tracking-tight text-white md:text-4xl">{title}</h2>
      {desc && <p className="mt-4 leading-relaxed text-slate-400">{desc}</p>}
    </div>
  );
}

/**
 * 滚动进入动画：给 [data-reveal] 元素在进入视口后加上 animate-fade-up。
 * 元素初始带 opacity-0（未进入视口时隐藏），动画的 fill-mode: both 会接管透明度。
 */
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const els = Array.from(root.querySelectorAll('[data-reveal]'));
    const show = (el) => el.classList.add('animate-fade-up');
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach(show);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            show(e.target);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

const LandingView = ({ onLogin, onRegister, theme = 'dark', onToggleTheme }) => {
  const rootRef = useReveal();

  return (
    <div
      ref={rootRef}
      className={`${theme === 'dark' ? 'app-dark' : 'app-light'} relative min-h-screen overflow-x-hidden bg-slate-950 antialiased selection:bg-cyan-400/30`}
    >
      {/* ===== 背景层 ===== */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at top, rgba(56,189,248,0.18), transparent 55%)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at bottom right, rgba(99,102,241,0.22), transparent 55%)' }}
        />
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(148,163,184,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.5) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
        <div className="absolute -left-24 -top-24 h-[28rem] w-[28rem] animate-float-slow rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -right-32 top-1/3 h-[26rem] w-[26rem] animate-float rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-[24rem] w-[24rem] animate-float-slow rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <div className="relative">
        {/* ===== 顶栏 ===== */}
        <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/60 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-indigo-500 text-slate-950 shadow-lg shadow-cyan-500/30">
                <Award size={20} strokeWidth={2.5} />
              </span>
              <span className="text-sm font-black tracking-[0.2em]">
                HAM<span className="text-cyan-400">AWARDS</span>
              </span>
            </div>
            <nav className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
              <a href="#features" className="transition-colors hover:text-white">功能</a>
              <a href="#workflow" className="transition-colors hover:text-white">流程</a>
              <a href="#/about" className="transition-colors hover:text-white">关于</a>
              <a href="#/privacy" className="transition-colors hover:text-white">隐私政策</a>
            </nav>
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={onToggleTheme}
                title={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
                className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-300 transition-colors hover:text-white"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <button
                onClick={onLogin}
                className="hidden items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-slate-200 transition-colors hover:bg-white/5 hover:text-white sm:inline-flex"
              >
                <LogIn size={16} /> 登录
              </button>
              <button
                onClick={onRegister}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-400 to-indigo-400 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/25 transition-all hover:-translate-y-0.5 hover:from-cyan-300 hover:to-indigo-300"
              >
                开始使用 <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </header>

        {/* ===== Hero ===== */}
        <section className="px-6 pb-24 pt-20 md:pb-32 md:pt-28">
          <div className="mx-auto max-w-4xl text-center">
            <div className="relative mx-auto mb-8 grid h-20 w-20 place-items-center">
              <span className="absolute h-20 w-20 animate-pulse-ring rounded-full border border-cyan-400/40" />
              <span
                className="absolute h-20 w-20 animate-pulse-ring rounded-full border border-indigo-400/30"
                style={{ animationDelay: '1.2s' }}
              />
              <span className="relative grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-400/20 to-indigo-500/20 backdrop-blur">
                <Radio className="text-cyan-300" size={30} />
              </span>
            </div>

            <div className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-slate-300 backdrop-blur">
              <Sparkles size={14} className="text-cyan-300" />
              业余无线电 · 奖状管理平台
            </div>

            <h1
              className="mt-6 animate-fade-up text-4xl font-black leading-[1.1] tracking-tight md:text-6xl lg:text-7xl"
              style={{ animationDelay: '0.1s' }}
            >
              <span className="bg-gradient-to-r from-cyan-300 via-sky-200 to-indigo-300 bg-clip-text text-transparent">
                让每一次通联
              </span>
              <br />
              <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-200 to-amber-200 bg-clip-text text-transparent">
                都成为值得珍藏的荣誉
              </span>
            </h1>

            <p
              className="mx-auto mt-7 max-w-2xl animate-fade-up text-base leading-relaxed text-slate-400 md:text-lg"
              style={{ animationDelay: '0.2s' }}
            >
              一键导入 LoTW 通联日志，自动匹配奖状规则，在线申请、审核与颁发，并附二维码真伪校验 ——
              让你的每一次呼叫都清晰可循。
            </p>

            <div
              className="mt-10 flex animate-fade-up flex-col items-center justify-center gap-4 sm:flex-row"
              style={{ animationDelay: '0.3s' }}
            >
              <button
                onClick={onRegister}
                className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-400 px-7 py-3.5 font-bold text-slate-950 shadow-xl shadow-cyan-500/25 transition-all hover:-translate-y-0.5 hover:from-cyan-300 hover:to-indigo-300"
              >
                免费开始使用
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </button>
              <button
                onClick={onLogin}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-7 py-3.5 font-bold text-slate-200 backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-white/5"
              >
                <LogIn size={18} /> 登录系统
              </button>
            </div>

            <div
              className="mt-14 flex animate-fade-up flex-wrap items-center justify-center gap-2.5 text-[11px] text-slate-400"
              style={{ animationDelay: '0.4s' }}
            >
              {CAPABILITIES.map((t) => (
                <span key={t} className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{t}</span>
              ))}
            </div>
          </div>

          {/* ===== 成品预览（玻璃窗口 mock） ===== */}
          <div data-reveal className="mx-auto mt-20 max-w-5xl opacity-0">
            <div className="group relative rounded-3xl border border-white/10 bg-white/[0.03] p-2 shadow-2xl shadow-slate-950/60 backdrop-blur-xl">
              <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-tr from-cyan-400/10 via-transparent to-indigo-400/10" />
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                  <span className="h-3 w-3 rounded-full bg-red-400/70" />
                  <span className="h-3 w-3 rounded-full bg-amber-400/70" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400/70" />
                  <span className="ml-3 text-xs text-slate-500">ham-awards.local / 我的奖状</span>
                </div>
                <div className="grid gap-5 p-6 sm:grid-cols-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-slate-800/60 to-slate-900/60 p-5 transition-transform duration-500 group-hover:-translate-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <Award size={22} className="text-amber-300" />
                        <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                          {i === 1 ? 'GOLD' : i === 2 ? 'SILVER' : 'BRONZE'}
                        </span>
                      </div>
                      <div className="mt-6 h-2.5 w-3/4 rounded-full bg-white/20" />
                      <div className="mt-2.5 h-2 w-1/2 rounded-full bg-white/10" />
                      <div className="mt-6 flex items-center gap-2 text-[10px] text-slate-400">
                        <CheckCircle2 size={12} className="text-emerald-400" /> 已签发 · 可校验
                      </div>
                      <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -translate-x-full -skew-x-12 bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-[400%]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-slate-400">
              {HIGHLIGHTS.map((h) => (
                <span key={h.label} className="inline-flex items-center gap-2">
                  <h.icon size={14} className="text-cyan-300" /> {h.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ===== 功能 ===== */}
        <section id="features" className="border-t border-white/5 px-6 py-20 md:py-28">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              eyebrow="核心功能"
              title="从日志到奖状，一站式闭环"
              desc="把零散的通联记录，变成可申请、可审核、可验真的荣誉凭证。"
            />
            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f, i) => (
                <div
                  key={f.title}
                  data-reveal
                  className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-6 opacity-0 backdrop-blur transition-all duration-500 hover:-translate-y-2 hover:border-cyan-400/40 hover:bg-white/[0.06] hover:shadow-2xl hover:shadow-cyan-500/10"
                  style={{ animationDelay: `${i * 0.08}s` }}
                >
                  <div className={`mb-5 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${f.tone}`}>
                    <f.icon size={22} className="text-slate-950" />
                  </div>
                  <h3 className="text-lg font-bold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== 流程 ===== */}
        <section id="workflow" className="border-t border-white/5 px-6 py-20 md:py-28">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              eyebrow="使用流程"
              title="三步，完成一次奖状申请"
              desc="不需要复杂配置，导入日志后即可看到你离目标奖状还有多远。"
            />
            <div className="mt-14 grid gap-6 md:grid-cols-3">
              {WORKFLOW.map((w, i) => (
                <div
                  key={w.step}
                  data-reveal
                  className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-8 opacity-0 backdrop-blur"
                  style={{ animationDelay: `${i * 0.1}s` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="grid h-12 w-12 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-400/10">
                      <w.icon size={22} className="text-cyan-300" />
                    </span>
                    <span className="text-3xl font-black text-white/10">{w.step}</span>
                  </div>
                  <h3 className="mt-6 text-lg font-bold">{w.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{w.desc}</p>
                  {i < WORKFLOW.length - 1 && (
                    <ChevronRight
                      className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-white/20 md:block"
                      size={24}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== 号召 ===== */}
        <section className="px-6 pb-24">
          <div
            data-reveal
            className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-500/15 via-indigo-500/10 to-fuchsia-500/10 p-10 text-center opacity-0 backdrop-blur md:p-16"
          >
            <Waves className="mx-auto text-cyan-300/70" size={34} />
            <h2 className="mt-6 text-3xl font-black tracking-tight md:text-4xl">准备好领取你的第一张奖状了吗？</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">注册即可上传日志、查看奖状进度，全程免费。</p>
            <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                onClick={onRegister}
                className="group inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 font-bold text-slate-950 shadow-xl shadow-slate-950/30 transition-all hover:-translate-y-0.5"
              >
                立即注册
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </button>
              <button
                onClick={onLogin}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-7 py-3.5 font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-white/5"
              >
                我已有账号
              </button>
            </div>
          </div>
        </section>

        {/* ===== 页脚 ===== */}
        <footer id="about" className="border-t border-white/10 px-6 py-12">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 text-sm text-slate-500 md:flex-row">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-cyan-400">
                <Award size={16} />
              </span>
              <span className="font-bold tracking-widest text-slate-300">HAM AWARDS</span>
            </div>
            <div className="text-center text-xs leading-relaxed">
              <div className="flex items-center justify-center gap-5">
                <a href="#/about" className="transition-colors hover:text-cyan-300">关于</a>
                <a href="#/privacy" className="transition-colors hover:text-cyan-300">隐私政策</a>
                <a href="#/terms" className="transition-colors hover:text-cyan-300">用户协议</a>
                <a href="#/protocol" className="transition-colors hover:text-cyan-300">内容规范</a>
              </div>
              <p className="mt-2">
                业余无线电奖状管理 · 仅为业余无线电爱好者社区服务
                <br />
                遵循 GPL-3.0 开源许可
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <FileText size={14} /> © 2026 HAM AWARDS
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default LandingView;
