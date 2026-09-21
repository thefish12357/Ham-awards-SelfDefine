import React, { useEffect, useState } from 'react';
// 注意：本项目的 lucide-react 是 0.263.1，图标名有限（例如没有 ShieldX）。
// 新增图标前先用 node 检查 `'Xxx' in (await import('lucide-react'))`。
import { BadgeCheck, XCircle, Loader2, Award } from 'lucide-react';

/**
 * 奖状真伪校验页（公开，无需登录）
 * ------------------------------------------------------------------
 * 入口是奖状 PDF / 纸质件上的二维码：`/#/verify/<序列号>`。
 * 因为要免登录访问，这里的请求**故意用裸 fetch** 而不用 apiFetch
 * （apiFetch 会注入 token 并在 401 时强制重载，不适合公开页）。
 *
 * 隐私：接口只返回脱敏后的呼号（BH2VSQ → BH***Q）。
 */
export default function VerifyView({ serial }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    fetch(`/api/verify/${encodeURIComponent(serial)}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (!cancelled) setState({ loading: false, ok, data: body });
      })
      .catch((e) => {
        if (!cancelled) setState({ loading: false, ok: false, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [serial]);

  const fmtDate = (v) => {
    if (!v) return '-';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="p-6 border-b flex items-center gap-3">
          <Award className="text-blue-600" />
          <div>
            <h1 className="font-black text-lg text-slate-800">HAM AWARDS 奖状校验</h1>
            <p className="text-xs text-slate-400">扫描奖状上的二维码即可查验真伪</p>
          </div>
        </div>

        <div className="p-6">
          {state.loading && (
            <div className="flex items-center gap-3 text-slate-500 py-8 justify-center">
              <Loader2 className="animate-spin" size={20} /> 正在校验…
            </div>
          )}

          {!state.loading && state.ok && state.data?.valid && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-4 font-bold">
                <BadgeCheck size={20} /> 校验通过：这是一张由本站签发的真实奖状
              </div>
              <dl className="text-sm divide-y">
                <div className="flex justify-between py-2">
                  <dt className="text-slate-500">奖状名称</dt>
                  <dd className="font-bold text-slate-800">{state.data.awardName}</dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-slate-500">等级</dt>
                  <dd className="font-bold text-slate-800">{state.data.level || '-'}</dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-slate-500">持有人（已脱敏）</dt>
                  <dd className="font-mono font-bold text-slate-800">{state.data.holder}</dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-slate-500">成绩快照</dt>
                  <dd className="font-bold text-slate-800">{state.data.score ?? '-'}</dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-slate-500">签发日期</dt>
                  <dd className="font-mono text-slate-800">{fmtDate(state.data.issueDate)}</dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-slate-500">序列号</dt>
                  <dd className="font-mono text-slate-800 break-all text-right">{state.data.serial}</dd>
                </div>
              </dl>
              {state.data.description ? (
                <p className="text-xs text-slate-500 border-t pt-3 whitespace-pre-wrap">{state.data.description}</p>
              ) : null}
            </div>
          )}

          {!state.loading && !(state.ok && state.data?.valid) && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl p-4 font-bold">
                <XCircle size={20} /> 校验未通过
              </div>
              <p className="text-sm text-slate-600">
                {state.data?.message || state.error || '未找到该序列号对应的奖状，请核对奖状上的序列号是否正确。'}
              </p>
              <p className="text-xs font-mono text-slate-400 break-all">序列号：{serial}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 text-xs text-slate-400 border-t">
          本页仅公开校验所需的最小信息，持证人呼号已做脱敏处理。
        </div>
      </div>
    </div>
  );
}
