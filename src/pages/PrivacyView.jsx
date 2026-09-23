import React from 'react';
import { Award, ShieldCheck, Database, KeyRound, Share2, Lock, UserCheck, RefreshCw, Sun, Moon } from 'lucide-react';

/**
 * 隐私政策页（公开）
 * ------------------------------------------------------------------
 * 入口：首页页脚「隐私政策」→ `#/privacy`，由 `App` 在登录判断之前拦截渲染。
 * 内容需与项目实际数据处理方式一致（LoTW 凭据零留存、呼号脱敏等）。
 */

const SECTIONS = [
  {
    icon: Database,
    title: '一、我们收集的信息',
    items: [
      '账号信息：呼号（登录用户名）与加密后的密码（使用 bcrypt 哈希，本站无法还原明文）。',
      '通联数据：你主动上传的 ADIF 日志，或通过 LoTW 直连拉取的通联记录，用于奖状进度判定。',
      '申请与签发的奖状记录：奖状名称、等级、序列号、签发日期与成绩快照。',
      '若你上传实物材料照片用于资格认定，该照片仅用于审核，审核结束后立即从对象存储删除。',
    ],
  },
  {
    icon: KeyRound,
    title: '二、LoTW 凭据的特殊处理',
    items: [
      'LoTW 用户名与密码仅在你发起「LoTW 直连」时于服务端内存中短暂使用，用于向 ARRL 拉取数据。',
      '凭据不写入数据库、不写入磁盘、不写入日志，会话在 30 分钟无操作后自动过期，进程重启即清除。',
      '本站不会将你的 LoTW 凭据用于任何其他用途。',
    ],
  },
  {
    icon: Share2,
    title: '三、第三方服务',
    items: [
      'ARRL Logbook of The World（LoTW）：用于获取你本人的通联记录。',
      'HamCQ 论坛 OAuth：若你选择「使用 HamCQ 登录」，站方会获取你的 HamCQ 用户标识与用户名以完成登录绑定。',
      '除上述必要交互外，本站不会将你的个人信息提供给任何第三方。',
    ],
  },
  {
    icon: Lock,
    title: '四、本地存储与安全',
    items: [
      '浏览器 localStorage 会保存登录令牌与基础用户信息，用于保持登录状态；退出登录时会被清除。',
      '所有接口请求通过令牌鉴权，密码与敏感字段在传输与存储时均做加密或哈希处理。',
    ],
  },
  {
    icon: ShieldCheck,
    title: '五、公开校验与隐私',
    items: [
      '奖状二维码指向公开校验页，仅展示校验所需的最小信息。',
      '校验页展示的持证人呼号一律做脱敏处理（例如 BH2VSQ 显示为 BH***Q）。',
    ],
  },
  {
    icon: UserCheck,
    title: '六、你的权利',
    items: [
      '你可以随时在「用户中心」修改密码、查看与管理自己的数据。',
      '如需删除账号或导出个人数据，请联系站点管理员。',
    ],
  },
  {
    icon: RefreshCw,
    title: '七、政策更新',
    items: [
      '本政策可能随功能调整而更新，更新后将在本页体现。',
      '最近更新日期：2026 年 9 月。',
    ],
  },
];

export default function PrivacyView({ onBack, theme = 'dark', onToggleTheme }) {
  return (
    <div className={`${theme === 'dark' ? 'app-dark' : 'app-light'} relative min-h-screen overflow-x-hidden bg-slate-950 antialiased`}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at top, rgba(99,102,241,0.16), transparent 55%)' }} />
        <div className="absolute -left-32 bottom-0 h-96 w-96 animate-float-slow rounded-full bg-cyan-500/12 blur-3xl" />
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

        <main className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">隐私政策</h1>
          <p className="mt-5 leading-relaxed text-slate-400">
            我们重视每一位业余无线电爱好者的隐私。本政策说明 HAM AWARDS 会收集哪些信息、
            如何使用与保护这些信息，以及你可以行使哪些权利。使用本站即表示你已阅读并理解本政策。
          </p>

          <div className="mt-12 space-y-8">
            {SECTIONS.map((s) => (
              <section key={s.title}>
                <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                  <s.icon size={18} className="text-cyan-300" /> {s.title}
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {s.items.map((it) => (
                    <li key={it} className="flex gap-3 text-sm leading-relaxed text-slate-400">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/60" />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-12 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm leading-relaxed text-slate-400 backdrop-blur">
            如对本政策有任何疑问，请通过站点管理员联系。
          </div>
        </main>

        <footer className="border-t border-white/10 px-6 py-10">
          <div className="mx-auto max-w-3xl text-center text-xs text-slate-500">
            <div className="flex items-center justify-center gap-5">
              <a href="#/about" className="transition-colors hover:text-cyan-300">关于</a>
            </div>
            <p className="mt-2">© 2026 HAM AWARDS · 业余无线电奖状管理</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
