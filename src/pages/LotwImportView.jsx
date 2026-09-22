import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Globe,
  ShieldAlert,
  KeyRound,
  Loader2,
  Trash2,
  RefreshCw,
  Trophy,
  CheckCircle2,
  AlertCircle,
  Clock,
  Info,
  CalendarRange,
} from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';

/**
 * LoTW 直连页（需求①）
 * ------------------------------------------------------------------
 * 用户不必导出/上传 ADIF，直接填 LoTW 账号，由服务端代理拉取并**只在内存里**做奖状判定。
 *
 * 数据留存边界（页面里也如实告知用户）：
 *   1. 凭据只在这一次请求里用到，不写配置、不写库、不进日志；
 *   2. 日志边下载边解析，原文解析完即丢弃，只留精简字段；
 *   3. 精简记录只存在服务端内存会话里，默认 30 分钟；
 *   4. 关闭/刷新页面会用 sendBeacon 通知服务端立刻清除，也可手动点「立即清除」。
 */

const CONSENT_KEY = 'lotw_export_consent';

const fmtBytes = (n) => {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const fmtRemaining = (ms) => {
  if (ms <= 0) return '已过期';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const yearsAgoStr = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
};

export default function LotwImportView() {
  const [consent, setConsent] = useState(() => {
    try {
      return sessionStorage.getItem(CONSENT_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [form, setForm] = useState({
    login: '',
    password: '',
    ownCall: '',
    from: '',
    to: '',
    includeAll: false,
  });
  const [connecting, setConnecting] = useState(false);
  const [session, setSession] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const [awards, setAwards] = useState([]);
  const [awardId, setAwardId] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [applying, setApplying] = useState(false);

  const [now, setNow] = useState(Date.now());
  const sessionIdRef = useRef(null);

  // 剩余时间倒计时
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 页面关闭/刷新时通知服务端立即清除临时会话。
  // 注意：这里刻意不在「组件卸载」时清除，否则用户去别的页面看一眼奖状，
  // 会话就没了，没法接着判定。真正要清的是「关闭/刷新界面」。
  useEffect(() => {
    const clear = () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        navigator.sendBeacon(
          `/api/lotw/session?id=${encodeURIComponent(sid)}`,
          new Blob(['{}'], { type: 'application/json' }),
        );
      } catch {
        /* 页面已在卸载，失败也无所谓，服务端还有 TTL 兜底 */
      }
    };
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
  }, []);

  // 进来先看服务端有没有还活着的会话（刷新页面后 sessionId 会丢，可这样捞回来）
  useEffect(() => {
    let cancelled = false;
    apiFetch('/lotw/session')
      .then((data) => {
        if (cancelled || !data?.active) return;
        sessionIdRef.current = data.sessionId;
        setSession({ sessionId: data.sessionId, expiresAt: data.expiresAt });
        setStats({
          recordCount: data.recordCount,
          qslCount: data.qslCount,
          qsoCount: data.qsoCount,
          bytes: data.bytes,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 已发布的奖状列表
  useEffect(() => {
    apiFetch('/awards/all_approved')
      .then((list) => setAwards(Array.isArray(list) ? list : []))
      .catch(() => setAwards([]));
  }, []);

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const acceptConsent = () => {
    try {
      sessionStorage.setItem(CONSENT_KEY, '1');
    } catch {
      /* ignore */
    }
    setConsent(true);
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.login.trim() || !form.password) {
      setError('请填写 LoTW 用户名与密码');
      return;
    }
    setConnecting(true);
    setResult(null);
    try {
      const data = await apiFetch('/lotw/connect', {
        method: 'POST',
        body: JSON.stringify({
          login: form.login.trim(),
          password: form.password,
          ownCall: form.ownCall.trim() || undefined,
          from: form.from || undefined,
          to: form.to || undefined,
          includeAll: form.includeAll,
        }),
      });
      sessionIdRef.current = data.session?.sessionId || null;
      setSession(data.session);
      setStats(data.stats);
      // 密码用完即从界面状态里清掉，不留在内存里
      update({ password: '' });
    } catch (err) {
      setError(err?.message || '读取 LoTW 日志失败');
      if (err?.rangeTooLarge) {
        setError('这段时间的日志太大，请把「起始日期」调近一些再试（例如只取最近 3 年）');
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleClear = async () => {
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    setSession(null);
    setStats(null);
    setResult(null);
    try {
      await apiFetch(sid ? `/lotw/session?id=${encodeURIComponent(sid)}` : '/lotw/session', {
        method: 'DELETE',
      });
    } catch {
      /* 已经清了或过期了，忽略 */
    }
  };

  const handleCheck = async () => {
    if (!sessionIdRef.current || !awardId) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiFetch('/lotw/evaluate', {
        method: 'POST',
        body: JSON.stringify({ sessionId: sessionIdRef.current, awardId: Number(awardId) }),
      });
      setResult(data);
    } catch (err) {
      if (err?.error === 'SESSION_GONE') {
        sessionIdRef.current = null;
        setSession(null);
        setStats(null);
      }
      setError(err?.message || '奖状判定失败');
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    if (!sessionIdRef.current || !awardId) return;
    setApplying(true);
    setError(null);
    try {
      const data = await apiFetch('/lotw/apply', {
        method: 'POST',
        body: JSON.stringify({ sessionId: sessionIdRef.current, awardId: Number(awardId) }),
      });
      alert(`申请成功！等级：${data.level}\n序列号：${data.serial}`);
      setResult(null);
    } catch (err) {
      setError(err?.message || '申请失败');
    } finally {
      setApplying(false);
    }
  };

  const remaining = session?.expiresAt ? session.expiresAt - now : 0;
  const expired = session && remaining <= 0;

  const matched = useMemo(() => result?.matching_qsos || [], [result]);
  const missing = useMemo(() => result?.breakdown?.missing || [], [result]);

  // ---------------- 数据出境提示 ----------------
  if (!consent) {
    return (
      <div className="max-w-3xl space-y-6">
        <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
          <Globe className="text-blue-600" /> LoTW 直连
        </h2>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <ShieldAlert size={20} /> 数据出境提示（请先阅读并确认）
          </div>
          <div className="text-sm text-amber-900/90 space-y-3 leading-relaxed">
            <p>
              本功能会使用你填写的 LoTW 账号，直接从 <b>ARRL（美国）</b> 的 Logbook of The World
              读取你的通联记录。相当于把你的<b>呼号与通联日志</b>出境到美国。
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>接收方：American Radio Relay League, Inc.（ARRL），所在地：美国</li>
              <li>出境目的：读取已确认的 QSL 记录，用于本站的奖状资格判定</li>
              <li>数据范围：通联日期时间、波段、模式、对方呼号、DXCC/州/网格等字段</li>
              <li>保存期限：<b>本站不做任何持久化保存</b>，仅在服务端内存中临时存在</li>
            </ul>
            <p className="font-bold">
              关于「本站不留存」的四条具体保证：
            </p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>账号密码只在这一次请求里使用，不写入配置文件、不写入数据库、不写入服务器日志；</li>
              <li>日志边下载边解析，原文解析完立即丢弃，只保留判定所需的精简字段；</li>
              <li>精简记录只存在服务器内存里，默认 30 分钟后自动清除，期间可随时手动清除；</li>
              <li>申请奖状时只保存「申请记录 + 成绩快照」，<b>一条 QSO 都不会入库</b>。</li>
            </ol>
            <p className="text-xs">
              你仍可选择不用本功能，改用「日志上传」自行导入 ADIF 文件（那条路径会把 QSO 记录保存到<b>本站服务器的数据库</b>，会占用服务器存储； LoTW 直连则一条都不落库）。
            </p>
          </div>
          <button
            onClick={acceptConsent}
            className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold transition-colors"
          >
            我已理解并同意，继续使用
          </button>
        </div>
      </div>
    );
  }

  // ---------------- 主界面 ----------------
  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <Globe className="text-blue-600" /> LoTW 直连
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            直接读取 LoTW 里的记录做奖状判定，<b>无需上传日志</b>；日志只临时存在服务器内存里，关闭本页即清除。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {session && (
            <button
              onClick={handleClear}
              className="px-4 py-2 border border-red-200 text-red-600 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-red-50"
            >
              <Trash2 size={16} /> 立即清除临时日志
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 flex items-start gap-2 text-sm">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 连接表单 */}
      <form onSubmit={handleConnect} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div className="flex items-center gap-2 font-bold text-slate-700">
          <KeyRound size={18} /> 连接 LoTW
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">LoTW 用户名</label>
            <input
              className="w-full p-3 border rounded-xl font-mono"
              placeholder="通常是你的呼号，例如 BH2VSQ"
              value={form.login}
              onChange={(e) => update({ login: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">LoTW 密码</label>
            <input
              type="password"
              className="w-full p-3 border rounded-xl"
              placeholder="仅在本次请求内使用，不保存"
              value={form.password}
              onChange={(e) => update({ password: e.target.value })}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">本方呼号（可选）</label>
            <input
              className="w-full p-3 border rounded-xl font-mono"
              placeholder="多呼号账号时用来筛选，例如 BH2VSQ/P"
              value={form.ownCall}
              onChange={(e) => update({ ownCall: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-3 p-3 border rounded-xl bg-slate-50 cursor-pointer w-full">
              <input
                type="checkbox"
                className="w-5 h-5"
                checked={form.includeAll}
                onChange={(e) => update({ includeAll: e.target.checked })}
              />
              <div>
                <div className="font-bold text-sm">同时读取全部 QSO</div>
                <div className="text-xs text-slate-500">用于统计总通联数；会显著变慢</div>
              </div>
            </label>
          </div>
        </div>

        <div className="border-t pt-5">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-3">
            <CalendarRange size={16} /> 日期范围（可选，日志很大时建议缩小）
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex gap-2">
              <input
                type="date"
                className="w-full p-3 border rounded-xl"
                value={form.from}
                onChange={(e) => update({ from: e.target.value })}
              />
              <button
                type="button"
                className="px-3 py-2 border rounded-xl text-xs font-bold whitespace-nowrap hover:bg-slate-50"
                onClick={() => update({ from: yearsAgoStr(3), to: todayStr() })}
              >
                最近 3 年
              </button>
            </div>
            <input
              type="date"
              className="w-full p-3 border rounded-xl"
              value={form.to}
              onChange={(e) => update({ to: e.target.value })}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2">
            留空表示读取全部历史。若提示数据量过大，服务端会自动按日期二分重试；仍失败时请手动缩小范围。
          </p>
        </div>

        <button
          type="submit"
          disabled={connecting}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-bold flex items-center gap-2"
        >
          {connecting ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          {connecting ? '正在读取 LoTW（大日志可能较慢）…' : '连接并读取'}
        </button>
      </form>

      {/* 临时会话状态 */}
      {session && (
        <div className="bg-slate-900 text-white rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-bold flex items-center gap-2">
              <Clock size={18} className="text-emerald-400" />
              临时日志会话进行中
            </div>
            <div className={`text-sm font-mono ${expired ? 'text-red-400' : 'text-emerald-400'}`}>
              {expired ? '已过期，请重新连接' : `剩余 ${fmtRemaining(remaining)}`}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-400 text-xs">已确认 QSL</div>
              <div className="text-xl font-black">{stats?.qslCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">全部 QSO</div>
              <div className="text-xl font-black">{stats?.qsoCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">参与判定的记录</div>
              <div className="text-xl font-black">{stats?.recordCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">下载量</div>
              <div className="text-xl font-black">{fmtBytes(stats?.bytes)}</div>
            </div>
          </div>
          <p className="text-xs text-slate-400 flex items-start gap-2">
            <Info size={14} className="mt-0.5 shrink-0" />
            这些记录只存在服务器内存中，到期自动清除；关闭或刷新本页面也会立即通知服务器清除。数据库里没有任何一条记录。
          </p>
        </div>
      )}

      {/* 奖状判定 */}
      {session && !expired && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center gap-2 font-bold text-slate-700">
            <Trophy size={18} /> 用这份临时日志判定奖状
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-sm font-bold text-slate-700 mb-1">选择奖状</label>
              <select
                className="w-full p-3 border rounded-xl bg-white"
                value={awardId}
                onChange={(e) => {
                  setAwardId(e.target.value);
                  setResult(null);
                }}
              >
                <option value="">请选择…</option>
                {awards.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCheck}
              disabled={!awardId || checking}
              className="px-6 py-3 bg-slate-900 disabled:opacity-50 text-white rounded-xl font-bold flex items-center gap-2"
            >
              {checking ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              检查进度
            </button>
          </div>

          {result && (
            <div className="space-y-4 pt-4 border-t">
              <div
                className={`rounded-xl p-5 ${
                  result.eligible ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2 font-bold text-lg">
                    {result.eligible ? (
                      <CheckCircle2 className="text-emerald-600" />
                    ) : (
                      <AlertCircle className="text-slate-400" />
                    )}
                    {result.details?.msg}
                  </div>
                  <button
                    onClick={handleApply}
                    disabled={!result.eligible || applying}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-bold"
                  >
                    {applying ? '提交中…' : '申请奖状'}
                  </button>
                </div>
                {Array.isArray(result.thresholds) && result.thresholds.length > 1 && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {result.thresholds.map((t) => {
                      const done = result.current_score >= t.value;
                      return (
                        <span
                          key={t.name}
                          className={`px-2 py-1 rounded border ${
                            done ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-white border-slate-200 text-slate-500'
                          }`}
                        >
                          {t.name} · {t.value}
                        </span>
                      );
                    })}
                  </div>
                )}
                {result.claimed_levels?.length > 0 && (
                  <div className="mt-2 text-xs text-slate-500">
                    已领取等级：{result.claimed_levels.join('、')}
                  </div>
                )}
              </div>

              {missing.length > 0 && (
                <div>
                  <div className="text-sm font-bold text-slate-700 mb-2">
                    还缺 {missing.length} 项（共需 {result.breakdown?.total_required}）
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                    {missing.map((m) => (
                      <span key={m} className="px-2 py-1 bg-red-50 text-red-600 border border-red-100 rounded text-xs font-mono">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {matched.length > 0 && (
                <div>
                  <div className="text-sm font-bold text-slate-700 mb-2">
                    参与判定的通联记录（{matched.length} 条，最多显示 50 条）
                  </div>
                  <div className="overflow-x-auto border rounded-xl">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="text-left px-3 py-2 font-bold">对方呼号</th>
                          <th className="text-left px-3 py-2 font-bold">日期</th>
                          <th className="text-left px-3 py-2 font-bold">波段</th>
                          <th className="text-left px-3 py-2 font-bold">模式</th>
                          <th className="text-left px-3 py-2 font-bold">DXCC</th>
                          <th className="text-left px-3 py-2 font-bold">网格</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matched.slice(0, 50).map((q, i) => (
                          <tr key={`${q.call}-${q.date}-${i}`} className="border-t">
                            <td className="px-3 py-2 font-mono font-bold">{q.call}</td>
                            <td className="px-3 py-2 font-mono">{q.date}</td>
                            <td className="px-3 py-2">{q.band}</td>
                            <td className="px-3 py-2">{q.mode}</td>
                            <td className="px-3 py-2">{q.dxcc || '-'}</td>
                            <td className="px-3 py-2 font-mono">{q.grid || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
