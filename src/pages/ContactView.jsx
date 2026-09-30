import React, { useState } from 'react';
import {
  Award,
  Mail,
  Sun,
  Moon,
  ShieldCheck,
  UserCheck,
  Megaphone,
  LifeBuoy,
  MessageSquare,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Info,
} from 'lucide-react';

/**
 * 联系我们（公开）
 * ------------------------------------------------------------------
 * 入口：各页脚 / 侧边栏底部的「联系我们」→ `#/contact`，由 `App` 在登录判断之前拦截渲染。
 *
 * 为什么单独一页（而不是塞进「关于」）：
 *   1. 隐私政策行使「数据权利」（访问/更正/删除/注销）必须有**独立、可公示**的受理入口
 *      —— 对标 HamCQ：`Contact@hamcq.cn` 单列一页，隐私政策第十章「如何联系我们」再引一次；
 *   2. 页脚 5 处 + 侧边栏都能直接挂链接，用户在任何页面都找得到；
 *   3. 后续「举报 / 申诉 / 第三方对接」也要有落点，一页集中收。
 * 「关于」页里只放一个指过来的入口，避免介绍性内容与联系方式混在一起。
 *
 * ⚠️ 站长邮箱是**个人邮箱**（不像 HamCQ 有自有域名邮箱）。页面里明文展示 + `mailto:`
 *    可点，同时给「复制」按钮 —— 纯 SPA，邮箱字符串只存在于 JS 产物里，不落在静态 HTML，
 *    常规爬虫抓不到（够用，不做过度混淆）。
 */

const MAIL = 'bh7csa@163.com';

/** 受理范围：按用途分类，比一句"有问题找我们"有用得多 */
const TOPICS = [
  {
    icon: UserCheck,
    title: '账号与数据',
    desc: '账号注销、个人数据访问 / 更正 / 删除 / 导出，以及无法自行解决的登录问题。',
  },
  {
    icon: Megaphone,
    title: '举报与申诉',
    desc: '奖状内容、实物材料或用户行为涉嫌违规的举报；对处理结果有异议的申诉。',
  },
  {
    icon: LifeBuoy,
    title: '使用与故障',
    desc: 'LoTW 直连失败、奖状渲染 / PDF 导出异常、收不到验证或通知邮件等技术问题。',
  },
  {
    icon: MessageSquare,
    title: '建议与合作',
    desc: '功能建议、规则咨询，以及有意发起新奖状或社区合作的沟通。',
  },
];

export default function ContactView({ onBack, theme = 'dark', onToggleTheme }) {
  const [copied, setCopied] = useState(false);

  const copyMail = async () => {
    try {
      await navigator.clipboard.writeText(MAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用（http / 权限）时退化为提示手抄
      window.prompt('请手动复制邮箱地址：', MAIL);
    }
  };

  return (
    <div className={`${theme === 'dark' ? 'app-dark' : 'app-light'} relative min-h-screen overflow-x-hidden bg-slate-950 antialiased`}>
      {/* 背景（与首页/关于页一致） */}
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
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">联系我们</h1>
          <p className="mt-5 max-w-3xl leading-relaxed text-slate-400">
            HAM AWARDS 由业余无线电爱好者个人建立与维护，用于奖状申请、审核与真伪校验。
            使用中遇到问题、需要行使个人数据权利，或有举报与建议，都可以直接给站长写信。
          </p>

          {/* 邮箱主卡 */}
          <section className="mt-10 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-6 backdrop-blur">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
              <Mail size={14} /> 站长邮箱
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={`mailto:${MAIL}`}
                className="font-mono text-xl font-black tracking-tight text-white transition-colors hover:text-cyan-300 md:text-2xl"
              >
                {MAIL}
              </a>
              <button
                type="button"
                onClick={copyMail}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:text-white"
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-400">
              <Clock size={14} className="mt-0.5 shrink-0 text-slate-500" />
              本站为个人维护，一般 <b className="text-slate-300">1–3 个工作日</b>内回复；
              为便于定位问题，来信请尽量附上<b className="text-slate-300">呼号</b>与相关
              <b className="text-slate-300">奖状名称 / 序列号</b>（截图更好）。
            </p>
          </section>

          {/* 受理范围 */}
          <section className="mt-12">
            <h2 className="text-lg font-bold text-white">可以找我们做什么</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {TOPICS.map((t) => (
                <div key={t.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-cyan-400/20 to-indigo-500/20 text-cyan-300">
                      <t.icon size={18} />
                    </span>
                    <h3 className="font-bold">{t.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">{t.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 系统邮件说明：避免用户直接回信给 no-reply 石沉大海 */}
          <section className="mt-12">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Info size={18} className="text-cyan-300" /> 关于系统邮件
            </h2>
            <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-relaxed text-slate-400 backdrop-blur">
              <p>
                本站的系统邮件（邮箱验证、找回密码、通知提醒）由
                <span className="mx-1 font-mono text-slate-200">no-reply@hamglory.top</span>
                自动发出，该地址<b className="text-slate-200">只发不收</b>，直接回复不会有人看到。
              </p>
              <p>
                需要人工答复时，请直接写信到上面的<b className="text-slate-200">站长邮箱</b>。
                系统邮件的「回信地址」是本站的对外信箱（会统一收取），但处理<b className="text-slate-200">不如给站长邮箱直接来信及时</b>。
              </p>
            </div>
          </section>

          {/* 其他渠道 */}
          <section className="mt-12">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <ExternalLink size={18} className="text-cyan-300" /> 其他渠道
            </h2>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <a
                href="https://forum.hamcq.cn"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-slate-300 transition-colors hover:text-cyan-300"
              >
                <MessageSquare size={15} /> HamCQ 社区（可发帖讨论）
              </a>
              <a
                href="https://github.com/thefish12357/Ham-awards-SelfDefine"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-slate-300 transition-colors hover:text-cyan-300"
              >
                <ExternalLink size={15} /> 开源仓库（Issue / 源码）
              </a>
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
              <ShieldCheck size={14} className="mt-0.5 shrink-0" />
              涉及个人数据处理的请求，处理方式与范围见
              <a href="#/privacy" className="text-cyan-300 underline decoration-dotted underline-offset-2">《隐私政策》</a>
              第六、八条。
            </p>
          </section>
        </main>

        <footer className="border-t border-white/10 px-6 py-10">
          <div className="mx-auto max-w-4xl text-center text-xs text-slate-500">
            <div className="flex flex-wrap items-center justify-center gap-5">
              <a href="#/about" className="transition-colors hover:text-cyan-300">关于</a>
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
