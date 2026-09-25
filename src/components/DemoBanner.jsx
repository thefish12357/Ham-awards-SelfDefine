/**
 * 演示实例全局横幅。
 *
 * 仅当后端 `/api/system-status` 返回 `demoMode:true` 时由 App 渲染，
 * 固定出现在**每一个页面**顶部（落地页 / 登录注册 / 主应用 / 公开页 / 校验页），
 * 用途：提醒访客这是示例环境、数据会重置，并公示可登录的演示账号口令。
 *
 * 采用与主题无关的深棕色实色条（amber-950）+ 琥珀色文字：
 * 无论页面处于深色还是浅色主题，都能清晰可读，不依赖 Tailwind 主题映射。
 */
export default function DemoBanner({ demoUser = '', demoPass = '' }) {
  return (
    <div className="z-[200] flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b border-amber-500/30 bg-amber-950 px-4 py-2 text-center text-xs text-amber-200">
      <span className="font-bold tracking-wide">演示环境</span>
      <span className="opacity-50">·</span>
      <span>示例数据，定期重置。</span>
      <span className="opacity-50">·</span>
      <span>
        演示账号：<b className="font-mono">{demoUser}</b>
        <span className="mx-1 opacity-60">/</span>
        <b className="font-mono">{demoPass}</b>
      </span>
    </div>
  );
}
