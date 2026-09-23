import React from 'react';
import { Award, UserCheck, Server, Ban, Copyright, AlertTriangle, RefreshCw, FileCheck, Info, Sun, Moon } from 'lucide-react';

/**
 * 用户协议页（公开）
 * ------------------------------------------------------------------
 * 入口：首页页脚「用户协议」→ `#/terms`，由 `App` 在登录判断之前拦截渲染。
 * 与 PrivacyView 同构（SECTIONS 数组 + 卡片式排版），内容需与项目实际行为一致：
 * 呼号即账号、LoTW 凭据零留存、实物照片审核后即删、同等级仅可领取一次、GPL-3.0 开源。
 */

const SECTIONS = [
  {
    icon: Info,
    title: '一、服务说明',
    items: [
      'HAM AWARDS 是面向业余无线电爱好者的奖状设计与签发平台，提供日志导入（ADIF / LoTW 直连）、奖状可视化设计、在线申请与审核颁发、二维码公开校验等功能。',
      '本站为开源项目，遵循 GPL-3.0 许可，由社区维护并免费提供使用。',
      '使用本站即表示你已阅读、理解并同意本协议的全部内容。',
    ],
  },
  {
    icon: UserCheck,
    title: '二、账号与安全',
    items: [
      '注册需使用你本人的业余无线电呼号，请勿冒用他人呼号注册；使用 HamCQ 授权登录时需完成呼号归属确认。',
      '请妥善保管账号与密码（密码以 bcrypt 哈希存储，本站无法还原明文）。凡通过你的账号进行的操作，均视为你本人行为。',
      '发现账号异常、疑似被盗用时，请立即修改密码并通过站点管理员反馈。',
    ],
  },
  {
    icon: Server,
    title: '三、你提供的日志与材料',
    items: [
      '上传 ADIF 日志或使用 LoTW 直连，即表示你确认这些通联记录真实有效且属于你本人。',
      'LoTW 用户名与密码仅在拉取数据时于服务端内存中短暂使用，不落库、不落盘、不写日志。',
      '用于资格认定的实物 QSL 卡片照片仅用于审核，审核结束后立即从对象存储删除。',
      '你需对所上传内容的合法性负责，不得包含他人隐私信息、侵权或违规内容。',
    ],
  },
  {
    icon: Ban,
    title: '四、使用规范',
    items: [
      '禁止伪造、篡改通联记录或审核材料以骗取奖状。',
      '禁止冒用他人呼号、冒充站点管理员或从事其他欺诈行为。',
      '禁止攻击、扫描、压力测试本站服务，或未经许可批量爬取数据。',
      '禁止利用漏洞获取不当利益；若你发现漏洞并主动告知，我们表示感谢。',
      '违反上述规范的，我们有权撤销相关奖状，并视情节限制功能或封禁账号。',
    ],
  },
  {
    icon: Award,
    title: '五、奖状与成绩判定',
    items: [
      '奖状资格基于你提供的日志与材料，按奖状发布者设定的规则自动判定；判定结果以站内检查接口的返回为准。',
      '同一奖状的同一等级仅可领取一次。',
      '本站不对通联数据的绝对准确性作担保；如发现造假，相关奖状可被撤销，其公开校验记录将失效。',
      '奖状由各奖状管理员自行设计发布，不代表本站对某项活动或奖项的官方认可。',
    ],
  },
  {
    icon: Copyright,
    title: '六、知识产权与开源许可',
    items: [
      '本站程序代码遵循 GPL-3.0 开源许可；对外分发衍生作品须同样以 GPL-3.0 提供源码。',
      '奖状底图、图标、字体等素材的版权由上传者自行负责，须确保拥有合法授权，不得使用未获授权的商业字体或图片。',
      '你创建的奖状设计用于站内展示与颁发，我们不会另作商业用途。',
    ],
  },
  {
    icon: AlertTriangle,
    title: '七、免责声明',
    items: [
      '本站按「现状」提供服务，不保证服务不中断、无错误或满足特定用途。',
      '因网络环境、第三方服务（如 ARRL LoTW、HamCQ 论坛）故障导致的功能不可用，本站不承担责任。',
      '在法律允许的最大范围内，我们对因使用本站产生的间接损失不承担责任。',
    ],
  },
  {
    icon: RefreshCw,
    title: '八、服务变更与终止',
    items: [
      '我们可能调整、暂停或终止部分功能，重大变更会在站内公告。',
      '你可以随时联系管理员申请删除账号；删除后个人数据将被清除，已签发奖状的公开校验记录可能保留必要的最小信息。',
    ],
  },
  {
    icon: FileCheck,
    title: '九、协议更新与联系',
    items: [
      '本协议可能随功能调整而更新，更新后将在本页体现；继续使用本站即视为接受更新后的协议。',
      '最近更新日期：2026 年 9 月。',
      '如对本协议有任何疑问，请通过站点管理员联系。',
    ],
  },
];

export default function TermsView({ onBack, theme = 'dark', onToggleTheme }) {
  return (
    <div className={`${theme === 'dark' ? 'app-dark' : 'app-light'} relative min-h-screen overflow-x-hidden bg-slate-950 antialiased`}>
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

        <main className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-3xl font-black tracking-tight md:text-4xl">用户协议</h1>
          <p className="mt-5 leading-relaxed text-slate-400">
            本协议约定你在使用 HAM AWARDS 时的权利与义务。我们尽量用平实的语言写清楚，
            请在使用前完整阅读。若你不同意本协议的任何内容，请停止使用本站。
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
            如对本协议有任何疑问，请通过站点管理员联系。
          </div>
        </main>

        <footer className="border-t border-white/10 px-6 py-10">
          <div className="mx-auto max-w-3xl text-center text-xs text-slate-500">
            <div className="flex items-center justify-center gap-5">
              <a href="#/about" className="transition-colors hover:text-cyan-300">关于</a>
              <a href="#/privacy" className="transition-colors hover:text-cyan-300">隐私政策</a>
              <a href="#/protocol" className="transition-colors hover:text-cyan-300">内容规范</a>
            </div>
            <p className="mt-2">© 2026 HAM AWARDS · 业余无线电奖状管理</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
