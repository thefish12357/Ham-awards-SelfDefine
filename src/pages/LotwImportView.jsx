import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Globe,
  ShieldAlert,
  KeyRound,
  Loader2,
  Trash2,
  RefreshCw,
  Download,
  Trophy,
  CheckCircle2,
  AlertCircle,
  Clock,
  Info,
  CalendarRange,
  Terminal,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';
import { confirmDialog } from '../lib/confirm.jsx';
// 日期区间的下界/上界与校验统一来自 src/lib/dateInput.js（与后端 REPORT_MIN_DATE 保持一致）
import { DATE_MIN, todayStr, validateDateRangeInput } from '../lib/dateInput.js';
import DateInput from '../components/DateInput.jsx';

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

const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');

/** 终端日志的时间戳：HH:MM:SS.mmm（本地时间） */
const fmtClock = (ms) => {
  const d = new Date(ms || Date.now());
  const p = (v, w = 2) => String(v).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

// 终端日志的级别 → 图标/颜色（与后端 lotwJobs 的 level 取值对应）
const LOG_LEVEL_ICON = { info: '›', ok: '✔', warn: '▲', error: '✖', progress: '▸' };
const LOG_LEVEL_CLASS = {
  info: 'text-slate-300',
  ok: 'text-emerald-400',
  warn: 'text-amber-300',
  error: 'text-red-400',
  progress: 'text-sky-300',
};

const fmtRemaining = (ms) => {
  if (ms <= 0) return '已过期';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
};

const yearsAgoStr = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 提交前的区间校验：**复用共享实现** `src/lib/dateInput.js`。
 * ⚠️ 为什么必须校验：`<input type="date">` 是原生控件，年份段允许超过 4 位
 *    （Chrome 上限 275760），用户能输成「111111-11-11」；而服务端的
 *    `fetchLotwReports()` 对不合法日期是**静默回退**到全部历史，
 *    于是"缩小范围"实际变成"拉取 1900 年至今的全部日志"，只表现为变慢/超时。
 *    后端也会返回 400，这里先拦一道给出即时反馈。
 */
const validateRangeInput = (from, to) =>
  validateDateRangeInput(from, to, { fromLabel: '起始日期', toLabel: '结束日期' });

export default function LotwImportView({ demoMode = false } = {}) {
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
  // 「参与判定的通联记录」明细默认折叠，避免一次铺开几十条；进度用上方进度条表达
  const [showMatched, setShowMatched] = useState(false);

  // 「导入到我日志库」：用户主动把临时会话里的 QSO 写进 qsos 表（默认不落库，这里显式触发）
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const [now, setNow] = useState(Date.now());
  const sessionIdRef = useRef(null);

  // ---------------- 读取进度（终端日志） ----------------
  // 后端把「拉取 → 解析 → 建会话」变成可观察的后台任务，这里轮询增量事件渲染成终端。
  // 见 server/services/lotwJobs.js 与 server/routes/lotw.js 的 /connect/progress。
  const [logs, setLogs] = useState([]);
  const [logProgress, setLogProgress] = useState(null);
  const [jobStage, setJobStage] = useState(null); // null | 'running' | 'done' | 'error'
  const [logCollapsed, setLogCollapsed] = useState(false);
  const jobIdRef = useRef(null);
  const pollTimerRef = useRef(null);
  const lastSeqRef = useRef(0);
  const logBoxRef = useRef(null);
  const restoredRef = useRef(false);

  // 剩余时间倒计时
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------------- 读取进度轮询 ----------------
  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  /**
   * 轮询任务进度：把增量事件接到终端日志，直到 done / error / none。
   * 用 setTimeout 递归而不是 setInterval —— 保证上一次请求回来后才发下一次，
   * 不会在服务端稍慢时堆积请求。
   */
  const pollJob = async (jobId) => {
    try {
      const data = await apiFetch(
        `/lotw/connect/progress?jobId=${encodeURIComponent(jobId)}&since=${lastSeqRef.current}`,
      );
      if (data?.events?.length) {
        lastSeqRef.current = data.events[data.events.length - 1].seq;
        setLogs((prev) => [...prev, ...data.events]);
      }
      if (data?.progress) setLogProgress(data.progress);

      if (data?.status === 'done') {
        stopPolling();
        setJobStage('done');
        setConnecting(false);
        const result = data.result || {};
        sessionIdRef.current = result.session?.sessionId || null;
        setSession(result.session || null);
        setStats(result.stats || null);
        // 密码用完即从界面状态里清掉，不留在内存里
        setForm((prev) => ({ ...prev, password: '' }));
        return;
      }
      if (data?.status === 'error') {
        stopPolling();
        setJobStage('error');
        setConnecting(false);
        const err = data.error || {};
        setError(
          err.rangeTooLarge
            ? '这段时间的日志太大，请把「起始日期」调近一些再试（例如只取最近 3 年）'
            : err.message || '读取 LoTW 日志失败',
        );
        return;
      }
      if (data?.status === 'none') {
        stopPolling();
        setJobStage('error');
        setConnecting(false);
        setError('读取任务已结束或已过期（服务可能重启过），请重新连接');
        return;
      }
      pollTimerRef.current = setTimeout(() => pollJob(jobId), 600);
    } catch (e) {
      stopPolling();
      setJobStage('error');
      setConnecting(false);
      setError(e?.message || '获取读取进度失败，请重试');
    }
  };

  // 刷新页面后任务可能还在跑：把终端日志接回来（不带 jobId 时后端返回最近的任务）
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    let cancelled = false;
    apiFetch('/lotw/connect/progress')
      .then((data) => {
        if (cancelled || !data || data.status !== 'running') return;
        jobIdRef.current = data.jobId;
        lastSeqRef.current = data.seq || 0;
        setLogs(Array.isArray(data.events) ? data.events : []);
        setLogProgress(data.progress || null);
        setJobStage('running');
        setConnecting(true);
        pollJob(data.jobId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stopPolling();
      // 允许 StrictMode 的「挂载→卸载→再挂载」流程重新接一次，否则开发环境下连不上
      restoredRef.current = false;
    };
  }, []);

  // 日志自动滚到底部（除非用户正在手动往上翻查看历史）
  useEffect(() => {
    const box = logBoxRef.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }, [logs, jobStage]);

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
    // 日期区间先自己校验一遍：原生控件允许 5~6 位年份，服务端会静默回退成全量历史
    const rangeError = validateRangeInput(form.from, form.to);
    if (rangeError) {
      setError(rangeError);
      return;
    }
    stopPolling();
    setConnecting(true);
    setResult(null);
    setImportResult(null);
    // 重置终端（每次连接都是一份新的日志）
    setLogs([]);
    setLogProgress(null);
    setJobStage('running');
    setLogCollapsed(false);
    lastSeqRef.current = 0;
    try {
      // 后端改为「先建任务并立刻返回 jobId」，进度由 /connect/progress 轮询取。
      // 校验类错误（用户名/日期格式等）仍会在这里同步抛回。
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
      jobIdRef.current = data?.jobId || null;
      if (!jobIdRef.current) throw { message: '服务端没有返回读取任务编号，请重试' };
      pollJob(jobIdRef.current);
    } catch (err) {
      setConnecting(false);
      setJobStage('error');
      setError(err?.rangeTooLarge
        ? '这段时间的日志太大，请把「起始日期」调近一些再试（例如只取最近 3 年）'
        : err?.message || '读取 LoTW 日志失败');
      setLogs((prev) => [
        ...prev,
        { seq: 0, at: Date.now(), level: 'error', msg: err?.message || '请求失败' },
      ]);
    }
  };

  const handleClear = async () => {
    const ok = await confirmDialog({
      title: '清除临时日志',
      message: '确认立即清除服务器内存里的这份临时日志？',
      detail: '清除后需要重新连接 LoTW 才能继续判定/申请；服务端本来也会在到期后自动清除。',
      confirmText: '清除',
      danger: true,
    });
    if (!ok) return;
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    setSession(null);
    setStats(null);
    setResult(null);
    // 顺手把读取任务与终端日志一并收掉，避免残留的进度面板误导用户
    stopPolling();
    jobIdRef.current = null;
    setJobStage(null);
    setLogs([]);
    setLogProgress(null);
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
    const picked = awards.find((a) => String(a.id) === String(awardId));
    const ok = await confirmDialog({
      title: '申领奖状',
      message: `确认申领「${picked?.name || '所选奖状'}」？`,
      detail: '系统会用刚才读取的临时日志判定等级；同一等级只能领取一次，领取后会生成公开可校验的序列号。申请记录会入库，但一条 QSO 都不会保存。',
      confirmText: '确认申领',
    });
    if (!ok) return;
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

  const handleImport = async () => {
    if (!sessionIdRef.current) return;
    const ok = await confirmDialog({
      title: '导入到我日志库',
      message: '是否把这份 LoTW 临时日志写入本站日志库？',
      detail:
        '写入后，「全部日志 / 日志上传」「奖状详情页的进度与明细」都会显示这些通联，也能直接在本站申领奖状。' +
        '这会与 ADIF 上传一样在服务器上长期保存（默认 30 分钟的内存会话不自动落库，需你手动点这一下）。',
      confirmText: '导入日志库',
    });
    if (!ok) return;
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const data = await apiFetch('/lotw/import', {
        method: 'POST',
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      });
      setImportResult(data);
    } catch (err) {
      setError(err?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const remaining = session?.expiresAt ? session.expiresAt - now : 0;
  const expired = session && remaining <= 0;

  const matched = useMemo(() => result?.matching_qsos || [], [result]);
  const missing = useMemo(() => result?.breakdown?.missing || [], [result]);

  // 进度条：用「已满足条件 / 总条件」直观表达，不再把每条命中通联都铺开
  const lotwTotal = result?.breakdown?.total_required ?? 0;
  const lotwMiss = result?.breakdown?.missing?.length ?? 0;
  const lotwMet = Math.max(0, lotwTotal - lotwMiss);
  const lotwPct = lotwTotal > 0 ? Math.round((lotwMet / lotwTotal) * 100) : result?.eligible ? 100 : 0;

  // ---------------- 数据出境提示 ----------------
  if (!consent) {
    return (
      <div className="max-w-3xl space-y-6">
        <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
          <Globe className="text-blue-600" /> LoTW 直连
        </h2>
        {/* ⚠️ 深色主题下「大面积淡琥珀底 + text-amber-900 文字」会糊成一片脏棕色：
            amber-800/900 不在深色映射表里（只映射了 600/700），10% 琥珀底配暗褐字看不清。
            改为「中性面板 + 左侧琥珀色条 + 琥珀标题」，两套主题都干净。 */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 pl-7 space-y-4">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-amber-400" />
          <div className="flex items-center gap-2 font-bold text-amber-700">
            <ShieldAlert size={20} /> 数据出境提示（请先阅读并确认）
          </div>
          <div className="text-sm text-slate-600 space-y-3 leading-relaxed">
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
            <p className="text-xs text-slate-500">
              你仍可选择不用本功能，改用「日志上传」自行导入 ADIF 文件（那条路径会把 QSO 记录保存到<b>本站服务器的数据库</b>，会占用服务器存储； LoTW 直连则一条都不落库）。
            </p>
          </div>
          <button
            onClick={acceptConsent}
            className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold transition-all hover:-translate-y-0.5 active:scale-95"
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
              placeholder="通常是你的呼号，例如 BG1ABC"
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
              placeholder="多呼号账号时用来筛选，例如 BG1ABC/P"
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
            <div>
              <label className="block text-xs text-slate-500 mb-1">起始日期</label>
              {/* 统一走 DateInput：min/max（年份被浏览器卡在 4 位）+ 即时中文校验 */}
              <DateInput
                label="起始日期"
                value={form.from}
                onChange={(v) => update({ from: v })}
                className="w-full p-3 border rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">结束日期</label>
              <DateInput
                label="结束日期"
                value={form.to}
                onChange={(v) => update({ to: v })}
                className="w-full p-3 border rounded-xl"
              />
            </div>
          </div>
          {/* 年份段是 4 位、月/日段是 2 位，浏览器只在「当前段填满」时才自动跳到下一段，
              所以输 2 位年份不会跳——这是原生控件的行为，改不了；这里用快捷区间减少手输。 */}
          <div className="flex flex-wrap gap-2 mt-2">
            {[1, 3, 5].map((n) => (
              <button
                key={n}
                type="button"
                className="px-3 py-1.5 border rounded-lg text-xs font-bold hover:bg-slate-50"
                onClick={() => update({ from: yearsAgoStr(n), to: todayStr() })}
              >
                最近 {n} 年
              </button>
            ))}
            <button
              type="button"
              className="px-3 py-1.5 border rounded-lg text-xs font-bold hover:bg-slate-50"
              onClick={() => update({ from: '', to: '' })}
            >
              清空
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
          留空表示读取全部历史（等同 {DATE_MIN} 起）。日期框是浏览器原生控件，<b>年份只能是 4 位</b>（如 2026），
          输满才会自动跳到月份，月份与日各 2 位即可；推荐直接点输入框里的日历图标选日期。
          可选范围为 <b>{DATE_MIN} ~ 今天</b>，超出或起始晚于结束都会被拦下并提示。
          若提示数据量过大，服务端会自动按日期二分重试；仍失败时请手动缩小范围。
          </p>
        </div>

        {demoMode && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <span>演示环境已禁用 LoTW 直连（不会向外网发送账号）。点击「连接并读取」将跳转到主站登录页，登录后即可体验完整功能。</span>
          </div>
        )}

        <button
          type="submit"
          disabled={connecting}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-bold flex items-center gap-2"
        >
          {connecting ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
          {connecting ? '正在读取 LoTW（进度见下方终端）…' : '连接并读取'}
        </button>
      </form>

      {/* 读取进度终端：把「下载 / 解析 / 建会话」的过程如实展示出来。
          没有它时，大日志要跑几分钟，用户只能盯着转圈按钮，不知道是卡住了还是在正常解析。 */}
      {jobStage && (
        <div className="rounded-2xl overflow-hidden border border-slate-700 bg-[#0b1220] shadow-xl">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-800/70 border-b border-slate-700">
            <div className="flex items-center gap-2 text-slate-200 text-xs font-bold">
              <span className="flex gap-1.5 mr-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
              </span>
              <Terminal size={14} /> LoTW 连接终端
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-slate-400">
                {jobStage === 'running' ? '进行中…' : jobStage === 'done' ? '已完成' : '已失败'}
              </span>
              <button
                type="button"
                onClick={() => setLogCollapsed((v) => !v)}
                className="text-slate-400 hover:text-slate-200"
                title={logCollapsed ? '展开日志' : '收起日志'}
              >
                {logCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
            </div>
          </div>

          {!logCollapsed && (
            <>
              <div
                ref={logBoxRef}
                className="h-80 overflow-y-auto overscroll-contain px-4 py-3 font-mono text-[11.5px] leading-relaxed"
              >
                {logs.length === 0 && <div className="text-slate-500">等待 LoTW 响应…</div>}
                {logs.map((l, i) => (
                  <div key={`${l.seq}-${i}`} className="flex gap-2">
                    <span className="text-slate-500 shrink-0">{fmtClock(l.at)}</span>
                    <span className={`break-all ${LOG_LEVEL_CLASS[l.level] || LOG_LEVEL_CLASS.info}`}>
                      {LOG_LEVEL_ICON[l.level] || LOG_LEVEL_ICON.info} {l.msg}
                    </span>
                  </div>
                ))}
                {jobStage === 'running' && (
                  <div className="flex gap-2 text-slate-500">
                    <span className="shrink-0">{fmtClock(now)}</span>
                    <span className="animate-pulse">▌</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-700 bg-slate-900/60">
                <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      logProgress?.pct == null ? 'w-1/3 animate-pulse bg-sky-400/70' : 'bg-emerald-400'
                    }`}
                    style={logProgress?.pct == null ? undefined : { width: `${logProgress.pct}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                  {logProgress
                    ? logProgress.pct != null
                      ? `${logProgress.pct}%`
                      : `${fmtNum(logProgress.done)} 条 · ${fmtBytes(logProgress.bytes)}`
                    : '准备中'}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* 临时会话状态 */}
      {session && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
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

          {/* 「导入到我日志库」：默认不落库，由用户主动选择。落库后与 ADIF 上传等价，
              详情页 / 日志库 / 进度与明细会与直连判定保持一致。 */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || expired}
              className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {importing ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {importing ? '导入中…' : '导入到我日志库'}
            </button>
            <span className="text-xs text-slate-400">让奖状详情页、日志库也能看到这些通联（与 ADIF 上传等价，会长期保存）</span>
          </div>
          {importResult && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              已处理 {importResult.count} 条，其中 <b>{importResult.imported}</b> 条新增到你的日志库
              {importResult.imported < importResult.count ? '（其余已存在，自动跳过）' : ''}。
              现在去奖状详情页就能看到进度与明细了。
            </div>
          )}
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

              {/* 进度条：已满足条件 / 总条件 */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-bold text-slate-600">奖状进度</span>
                  <span className="font-mono text-slate-500">{lotwPct}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${result.eligible ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${lotwPct}%` }}
                  />
                </div>
                <div className="text-xs text-slate-500 mt-1.5">
                  已满足 {lotwMet} / 共 {lotwTotal} 项{result?.current_score != null ? ` · 当前得分 ${result.current_score}` : ''}
                </div>
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
                  <button
                    type="button"
                    onClick={() => setShowMatched((v) => !v)}
                    className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1 hover:text-blue-600"
                  >
                    {showMatched ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    参与判定的通联记录（{matched.length} 条{matched.length > 50 ? '，仅显示前 50' : ''}）
                  </button>
                  {showMatched && (
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
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
