import React from 'react';
import { Award, BookOpen, Ban, UserCheck, Gavel, RefreshCw, Sun, Moon } from 'lucide-react';

/**
 * 内容规范页（公开）
 * ------------------------------------------------------------------
 * 入口：各页脚「内容规范」→ `#/protocol`，由 `App` 在登录判断之前拦截渲染。
 * 章节结构参考 HamCQ 论坛的《内容规范》（总则 / 违规行为界定 / 用户权利与义务 /
 * 违规处理流程），内容按本站实际承载的形态裁剪：奖状设计、通联日志、实物材料、
 * 公开校验页。**提交创建奖状时的合规提示与本页第二条保持一致。**
 */

const SECTIONS = [
  {
    icon: BookOpen,
    title: '第一章 总则',
    items: [
      '为维护 HAM AWARDS 的内容秩序与业余无线电爱好者的良好交流氛围，制定本规范。',
      '本规范适用于所有注册用户与访问者，覆盖站内全部内容形态：奖状设计与基本信息、通联日志、实物材料照片、公开校验页以及用户中心的个人资料。',
      '本规范与《用户协议》《隐私政策》配合使用；三者如有冲突，以《用户协议》为准。',
      '使用本站即表示你已阅读并同意遵守本规范。',
    ],
  },
  {
    icon: Ban,
    title: '第二章 违规行为界定',
    items: [
      '违反法律法规：不得上传、发布任何违反中华人民共和国法律法规及你所在地法律法规的内容，包括但不限于危害国家安全、宣扬暴力恐怖、煽动民族仇恨与歧视、散布谣言、赌博、毒品、武器制作等违法违规信息。',
      '伪造通联记录：不得伪造、篡改 ADIF 日志、QSL 实物卡片照片或任何用于奖状资格判定的材料。',
      '侵权素材：不得使用未获授权的字体、图片、标识、徽章等素材制作奖状底图或站内展示内容（字体版权红线见「关于」页说明）。',
      '冒用身份：不得冒用他人呼号注册、冒充站点管理员或代表本站发声。',
      '垃圾信息与广告：不得发布与业余无线电无关的广告、推广链接、引流信息或重复刷屏内容。',
      '低俗与其他不良信息：不得发布色情、低俗、暴力、迷信及其他违背公序良俗的内容。',
      '不实信息：不得编造虚假奖状、虚假成绩或具有误导性的描述。',
      '恶意行为：不得攻击、扫描、压力测试本站服务，不得未经许可批量爬取数据，不得利用漏洞获取不当利益。',
    ],
  },
  {
    icon: UserCheck,
    title: '第三章 用户权利与义务',
    items: [
      '权利：你可以自由使用站内公开功能，查看与管理自己的数据，对奖状判定或审核结果提出申诉，并在发现漏洞时向管理员反馈。',
      '义务：你应当保证所上传内容真实、合法、不侵权，尊重其他爱好者与平台秩序，并遵守本规范与《用户协议》。',
      '奖状管理员义务：除上述要求外，奖状管理员还应对其发布的奖状名称、描述、规则与视觉素材负责，不得发布违反法律法规或本规范的奖状。',
    ],
  },
  {
    icon: Gavel,
    title: '第四章 违规处理流程',
    items: [
      '视情节轻重，我们可采取以下一项或多项措施：内容下架或删除、撤回已颁发的奖状（公开校验记录随之失效）、限制相关功能、暂停或封禁账号。',
      '涉及违法犯罪的，我们将保留证据并依法向有关主管部门报告。',
      '申诉：若你认为处理有误，可通过站点管理员提出申诉并说明理由，我们会在合理时间内复核并答复。',
      '处理原则：以纠正为主、处罚为辅，对主动说明并整改的情形可酌情从轻。',
    ],
  },
  {
    icon: RefreshCw,
    title: '规范更新',
    items: [
      '本规范可能随功能调整与平台运营需要而更新，更新后将在本页体现；继续使用本站即视为接受更新后的规范。',
      '最近更新日期：2026 年 9 月。',
      '如对本规范有疑问，请通过站点管理员联系。',
    ],
  },
];

export default function ProtocolView({ onBack, theme = 'dark', onToggleTheme }) {
  return (
    <div className={`${theme === 'dark' ? 'app-dark' : 'app-light'} relative min-h-screen overflow-x-hidden bg-slate-950 antialiased`}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at top, rgba(52,211,153,0.14), transparent 55%)' }} />
        <div className="absolute -right-32 top-1/3 h-96 w-96 animate-float rounded-full bg-cyan-500/12 blur-3xl" />
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
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">内容规范</h1>
          <p className="mt-5 leading-relaxed text-slate-400">
            本站承载的是业余无线电爱好者真实的通联成果与荣誉记录，因此对内容真实性、
            合法性与友善程度的要求高于一般网站。请在设计奖状、上传日志与材料前阅读本规范。
          </p>

          <div className="mt-8 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
            <p className="flex items-start gap-2 text-sm leading-relaxed text-amber-200/90">
              <Ban size={16} className="mt-0.5 shrink-0" />
              <span>
                <b>不得上传或发布任何违反法律法规的内容</b>。
                创建奖状、填写名称与描述、上传底图与实物材料，均视为你已确认内容合法合规且不侵犯他人权益。
              </span>
            </p>
          </div>

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
            如对本规范有疑问，或需要举报违规内容，请通过站点管理员联系。
          </div>
        </main>

        <footer className="border-t border-white/10 px-6 py-10">
          <div className="mx-auto max-w-3xl text-center text-xs text-slate-500">
            <div className="flex flex-wrap items-center justify-center gap-5">
              <a href="#/about" className="transition-colors hover:text-cyan-300">关于</a>
              <a href="#/privacy" className="transition-colors hover:text-cyan-300">隐私政策</a>
              <a href="#/terms" className="transition-colors hover:text-cyan-300">用户协议</a>
            </div>
            <p className="mt-2">© 2026 HAM AWARDS · 业余无线电奖状管理</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
