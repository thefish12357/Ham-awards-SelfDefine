/**
 * 「邮箱未验证」顶部横幅 + 拦页面板（2026-10-05 策略调整）
 * ------------------------------------------------------------------
 * 产品口径：**未验证邮箱也能登录**，但进站后不能使用任何功能。
 *   · `EmailVerifyBanner` —— 页面**最顶端**常驻的细提示条（深浅主题都看得见）；
 *   · `EmailVerifyGate`（默认导出）—— 主内容区换成的说明面板，
 *     只给「重发验证邮件 / 去用户中心改邮箱 / 退出登录」三个出口。
 *
 * ⚠️ 前端这两块只是**提前说明 + 引导**；真正的闸门在后端 `verifyToken` 的
 *    `EMAIL_GATE_ALLOW`（未验证用户调业务接口一律 403）。别只靠前端拦。
 *
 * 配色沿用 `DemoBanner` 的思路：与主题无关的实色（amber-950 底 + amber-200 字），
 * 深浅主题下都清晰，且**不使用 `text-white`**（`.app-light .text-white` 会把白字翻成深色，
 * 压在深色底上就看不见了 —— 项目里有这个坑，见 AGENTS.md §7）。
 */
import { MailWarning, RefreshCw, User, LogOut } from 'lucide-react';

export function EmailVerifyBanner({ email }) {
  return (
    <div className="z-[200] flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b border-amber-500/30 bg-amber-950 px-4 py-2 text-center text-xs text-amber-200">
      <MailWarning size={13} />
      <span className="font-bold tracking-wide">邮箱未验证</span>
      <span className="opacity-50">·</span>
      <span>完成邮箱验证后才能使用本站功能。</span>
      {email ? (
        <>
          <span className="opacity-50">·</span>
          <span className="opacity-80">{email}</span>
        </>
      ) : null}
    </div>
  );
}

export default function EmailVerifyGate({ user, onResend, onOpenUserCenter, onLogout, resending = false }) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-amber-500/30 bg-amber-950 p-6 text-amber-200 sm:p-8">
      <div className="flex items-start gap-3">
        <MailWarning className="mt-0.5 shrink-0 text-amber-400" size={22} />
        <div className="min-w-0">
          <h2 className="text-lg font-bold">请先完成邮箱验证</h2>
          <p className="mt-2 text-sm leading-relaxed">
            你的账号邮箱尚未验证，因此<b>暂时无法使用本站功能</b>。
            请到邮箱里点开验证链接，验证完成后功能会立即恢复。
          </p>
          {user?.email ? (
            <p className="mt-2 text-sm">
              验证邮件已发往：<b className="font-mono">{user.email}</b>
            </p>
          ) : (
            <p className="mt-2 text-sm">
              当前账号还没有绑定邮箱，请先到「用户中心」绑定一个可用的邮箱。
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {user?.email ? (
          <button
            type="button"
            onClick={onResend}
            disabled={resending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-bold text-amber-100 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
          >
            <RefreshCw size={15} className={resending ? 'animate-spin' : ''} />
            {resending ? '发送中…' : '重新发送验证邮件'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenUserCenter}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 px-4 py-2 text-sm font-bold text-amber-200 transition-colors hover:bg-amber-500/10"
        >
          <User size={15} />
          去用户中心
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 px-4 py-2 text-sm font-bold text-amber-200 transition-colors hover:bg-amber-500/10"
        >
          <LogOut size={15} />
          退出登录
        </button>
      </div>

      <p className="mt-4 text-xs leading-relaxed opacity-75">
        提示：重新发送后，<b>只有最新一封邮件里的链接有效</b>（旧链接会自动失效）。
        若一直收不到，请检查垃圾邮件，或到「用户中心」核对邮箱是否写错。
      </p>
    </div>
  );
}
