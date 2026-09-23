import React from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, HelpCircle, Info, Loader2 } from 'lucide-react';

/**
 * 统一确认弹层（替代浏览器原生 confirm / prompt）
 * ------------------------------------------------------------------
 * 为什么要自己写：原生 `confirm()` / `prompt()` 在所有浏览器里都是**系统样式**，
 * 与本站的双主题视觉完全不搭，而且在深色主题下会闪一块白框。这里用同一套
 * Tailwind + 主题映射渲染，样式统一、可放"详细影响说明"。
 *
 * 用法（命令式，调用点只加一行，不用为每个按钮接 state）：
 *   import { confirmDialog, promptDialog } from '../lib/confirm.jsx';
 *
 *   if (!(await confirmDialog({ title: '删除用户', message: '……', danger: true }))) return;
 *   const reason = await promptDialog({ title: '驳回原因', required: true });
 *   if (reason === null) return;
 *
 * 交互细节（都是为了"防手滑"）：
 *   - **危险操作默认焦点落在「取消」**，习惯性回车不会误删；Esc / 点遮罩一律取消；
 *   - 非危险确认默认焦点落在「确认」；
 *   - `prompt` 模式下 Enter 才提交（表单提交），且必填时按钮禁用。
 *
 * ⚠️ 弹层挂在 `document.body`（`#root` 之外），**拿不到** App 根节点的
 * `.app-dark` / `.app-light` 作用域类，所以要自己按 `<html class="theme-*">`
 * 补一层，否则深色主题下弹层会是浅色（映射规则全是后代选择器）。
 */
const themeScope = () => (document.documentElement.classList.contains('theme-light') ? 'app-light' : 'app-dark');

function Dialog({
  kind = 'confirm',
  title = '请确认',
  message = '',
  detail = null,
  placeholder = '',
  required = false,
  defaultValue = '',
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  busy = false,
  onDone,
}) {
  const isPrompt = kind === 'prompt';
  const isInfo = kind === 'info'; // 纯告知：只有一个「知道了」按钮
  const [value, setValue] = React.useState(defaultValue || '');
  const cancelRef = React.useRef(null);
  const okRef = React.useRef(null);

  React.useEffect(() => {
    // 危险操作把焦点放在「取消」上：一路回车也不会误操作
    ((danger && !isInfo) ? cancelRef.current : okRef.current)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDone(isInfo ? true : isPrompt ? null : false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [danger, isInfo, isPrompt, onDone]);

  const cancel = () => onDone(isInfo ? true : isPrompt ? null : false);
  const ok = () => {
    if (isPrompt) {
      const v = value.trim();
      if (required && !v) return;
      onDone(v);
    } else {
      onDone(true);
    }
  };
  const disabled = isPrompt && required && !value.trim();

  return (
    <div className={`${themeScope()} fixed inset-0 z-[120] flex items-center justify-center p-4`} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={cancel} />
      <form
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPrompt) return; // 确认框不用回车提交，避免误确认
          ok();
        }}
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${
              danger ? 'bg-red-100 text-red-700' : isInfo ? 'bg-cyan-100 text-cyan-700' : 'bg-blue-100 text-blue-700'
            }`}
          >
            {danger ? <AlertTriangle size={18} /> : isInfo ? <Info size={18} /> : <HelpCircle size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-black text-slate-800">{title}</h3>
            {message && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{message}</p>}
          </div>
        </div>

        {detail && <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">{detail}</div>}

        {isPrompt && (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="mt-4 w-full rounded-xl border bg-white p-3 text-sm"
          />
        )}

        <div className="mt-6 flex justify-end gap-2">
          {!isInfo && (
            <button
              type="button"
              ref={cancelRef}
              onClick={cancel}
              disabled={busy}
              className="rounded-xl border px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            ref={okRef}
            onClick={ok}
            disabled={disabled || busy}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white transition-colors disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900'
            }`}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}

const mount = (props) =>
  new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
      // 异步卸载：在 React 事件回调里同步 unmount 会告警
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
    root.render(<Dialog {...props} onDone={done} />);
  });

/** 确认框 → Promise<boolean>（点取消 / Esc / 点遮罩 都返回 false） */
export const confirmDialog = (opts = {}) =>
  mount({ kind: 'confirm', confirmText: '确认', cancelText: '取消', ...opts });

/** 输入框（如"驳回原因"）→ Promise<string|null>（取消返回 null） */
export const promptDialog = (opts = {}) =>
  mount({ kind: 'prompt', confirmText: '提交', cancelText: '取消', required: true, ...opts });

/** 纯告知（只有一个「知道了」按钮）→ 用于"我该怎么办"这类说明弹层 */
export const infoDialog = (opts = {}) =>
  mount({ kind: 'info', confirmText: '知道了', ...opts });

export default confirmDialog;
