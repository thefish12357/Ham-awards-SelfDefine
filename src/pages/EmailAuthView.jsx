/**
 * 邮箱验证 / 重置密码（2026-09-30）
 * ------------------------------------------------------------------
 * 邮件里的链接指向这两个公开页（`#/verify-email?token=…`、`#/reset-password?token=…`）。
 *
 * ⚠️ 必须**免登录**：用户多半是在手机邮箱里点链接，那个浏览器上没有本站登录态。
 *    所以这里**故意用裸 fetch** 而不是 apiFetch —— apiFetch 会注入 token，
 *    并且遇到 401 会强制整页重载（把用户甩回登录页），公开页不能用它。
 *    （同 `pages/VerifyView.jsx` 的处理方式。）
 *
 * 两种模式：
 *   verify —— 进页面就自动提交令牌，成功/失败给明确文案（不用用户再点一下）
 *   reset  —— 让用户输入新密码（≥8 位，服务端也会兜底校验）
 */
import { useEffect, useRef, useState } from 'react';

const post = async (path, body) => {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await r.json(); } catch { /* 非 JSON（网关错误页） */ }
  if (!r.ok) {
    const err = new Error(data?.message || `请求失败（HTTP ${r.status}）`);
    err.code = data?.error;
    throw err;
  }
  return data || {};
};

const Card = ({ children }) => (
  <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
      {children}
    </div>
  </div>
);

const PrimaryLink = ({ children }) => (
  <a
    href="#/auth"
    className="mt-6 block w-full rounded-xl bg-slate-900 py-3 text-center text-sm font-bold text-white transition-opacity hover:opacity-90"
  >
    {children}
  </a>
);

export default function EmailAuthView({ mode, token }) {
  const [state, setState] = useState({ phase: 'loading', message: '' });
  const [form, setForm] = useState({ password: '', confirm: '' });
  const ranRef = useRef(false); // 防止 StrictMode 下重复提交令牌（令牌是一次性的）

  useEffect(() => {
    if (mode !== 'verify') { setState({ phase: 'form', message: '' }); return; }
    if (!token) { setState({ phase: 'error', message: '链接里没有验证令牌，请从邮件里重新点击链接。' }); return; }
    if (ranRef.current) return;      // 一次性令牌：只提交一次
    ranRef.current = true;
    post('/api/auth/verify-email', { token })
      .then((d) => setState({ phase: 'ok', message: `账号「${d.callsign}」的邮箱已通过验证。`, email: d.email }))
      .catch((e) => setState({ phase: 'error', message: e.message }));
  }, [mode, token]);

  const submitReset = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) return setState({ phase: 'form', message: '新密码至少 8 位' });
    if (form.password !== form.confirm) return setState({ phase: 'form', message: '两次输入的密码不一致' });
    setState({ phase: 'submitting', message: '' });
    try {
      const d = await post('/api/auth/reset-password', { token, password: form.password });
      setState({ phase: 'ok', message: `账号「${d.callsign}」的密码已重置，请用新密码登录。` });
    } catch (err) {
      setState({ phase: 'form', message: err.message });
    }
  };

  // ---------- 邮箱验证 ----------
  if (mode === 'verify') {
    return (
      <Card>
        <h1 className="text-xl font-black text-slate-900">邮箱验证</h1>
        {state.phase === 'loading' && <p className="mt-4 text-sm text-slate-500">正在验证…</p>}
        {state.phase === 'ok' && (
          <>
            <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              ✅ {state.message}
              {state.email ? <span className="mt-1 block text-xs text-green-700">已绑定邮箱：{state.email}</span> : null}
            </p>
            <PrimaryLink>去登录</PrimaryLink>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              ❌ {state.message}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              链接 24 小时内有效且只能用一次。如果是过期或重复点击，
              请到登录页用「没收到验证邮件？重新发送」再取一封。
            </p>
            <PrimaryLink>返回登录页</PrimaryLink>
          </>
        )}
      </Card>
    );
  }

  // ---------- 重置密码 ----------
  if (state.phase === 'ok') {
    return (
      <Card>
        <h1 className="text-xl font-black text-slate-900">密码已重置</h1>
        <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">✅ {state.message}</p>
        <p className="mt-3 text-xs text-slate-500">为安全起见，其它设备上的登录已全部失效，需要重新登录。</p>
        <PrimaryLink>去登录</PrimaryLink>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-xl font-black text-slate-900">设置新密码</h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        链接 30 分钟内有效且只能用一次。
      </p>
      <form onSubmit={submitReset} className="mt-5 space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-bold uppercase text-slate-500">新密码（≥8 位）</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            autoComplete="new-password"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-900"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold uppercase text-slate-500">确认新密码</label>
          <input
            type="password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            required
            autoComplete="new-password"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-900"
          />
        </div>
        {state.message && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">{state.message}</p>
        )}
        <button
          disabled={state.phase === 'submitting'}
          className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {state.phase === 'submitting' ? '提交中…' : '确认重置'}
        </button>
      </form>
      <PrimaryLink>返回登录页</PrimaryLink>
    </Card>
  );
}
