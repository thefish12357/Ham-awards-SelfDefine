import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, RefreshCw, Search, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';

/**
 * 审计日志（全站操作审计）
 * ------------------------------------------------------------------
 * 入口：侧边栏「后台管理 → 审计日志」→ `#/admin_logs`，**仅最高级管理员（admin）**可见。
 * 数据源：`GET /api/admin/audit-logs`（`server/services/audit.js`）。
 *
 * 与「单个奖状的审核流水」的区别：
 *   - 本页 = 全站级的"谁在什么时候做了什么"，只有 admin 能看；
 *   - 某张奖状的审核时间线（`awards.audit_log`）仍保留在奖状详情里，
 *     可见范围 = 该奖状的管理员 + 最高级管理员，不在本页展示。
 *
 * 记录原则：只记敏感操作；**永不记录密码 / TOTP / LoTW 凭据**。
 */

/** 动作 → 中文名（与后端 server/services/audit.js 的 action 一一对应） */
const ACTION_LABELS = {
  'auth.login': '登录成功',
  'auth.login_failed': '登录失败',
  'auth.register': '注册账号',
  'user.password_change': '修改密码',
  'user.2fa_enable': '启用两步验证',
  'user.2fa_disable': '关闭两步验证',
  'user.logs_clear': '清空通联日志',
  'user.account_delete': '注销账号',
  'role.request': '提交升级申请',
  'role.review': '审核升级申请',
  'admin.user_create': '新建账号',
  'admin.user_update': '修改账号 / 角色',
  'admin.user_delete': '删除账号',
  'admin.settings_update': '修改系统设置',
  'award.save': '保存 / 提交奖状',
  'award.audit': '审核奖状',
  'award.delete': '删除奖状',
  'award.apply': '申领奖状',
  'award.issued_delete': '撤销已颁发奖状',
  'evidence.upload': '上传实物材料',
  'evidence.audit': '审核实物材料',
};

/** 动作前缀 → 徽章配色（Tailwind 全类名，勿拼接字符串，否则不被扫描） */
const ACTION_STYLES = [
  { prefix: 'auth.login_failed', cls: 'bg-red-100 text-red-700 border-red-200' },
  { prefix: 'auth.', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  { prefix: 'user.', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  { prefix: 'role.', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  { prefix: 'admin.', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  { prefix: 'award.', cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { prefix: 'evidence.', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
];

const catalog = [
  { value: '', label: '全部操作' },
  { value: 'auth.', label: '登录 / 注册' },
  { value: 'user.', label: '账号与安全' },
  { value: 'role.', label: '角色与权限' },
  { value: 'award.', label: '奖状' },
  { value: 'evidence.', label: '实物材料' },
  { value: 'admin.', label: '后台管理' },
];

const DETAIL_LABELS = {
  callsign: '呼号',
  role: '角色',
  role_from: '原角色',
  role_to: '新角色',
  reason: '原因',
  op: '操作',
  result: '结果',
  status: '状态',
  mode: '方式',
  award: '奖状',
  award_name: '拟创建奖状',
  award_id: '奖状 ID',
  user_id: '用户 ID',
  creator_id: '创建者 ID',
  applicant: '申请人',
  applicant_id: '申请人 ID',
  level: '等级',
  serial: '序列号',
  score: '得分',
  matched_qso: '匹配日志条数',
  deleted: '删除条数',
  password_reset: '已重置密码',
  match_callsign: '对方呼号',
  bytes: '文件字节',
  useHttps: 'HTTPS',
  adminPath: '管理入口路径',
};

const OP_LABELS = { approve: '通过', reject: '驳回', create: '新建', update: '更新', recall: '撤回' };

/** 把 detail JSONB 渲染成"中文键: 值"的小标签；显式隐藏空值 */
const renderDetail = (detail) => {
  if (!detail || typeof detail !== 'object') return <span className="text-slate-400">—</span>;
  const entries = Object.entries(detail).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => {
        let shown = v;
        if (typeof v === 'boolean') shown = v ? '是' : '否';
        else if (k === 'op' && OP_LABELS[v]) shown = OP_LABELS[v];
        else if (typeof v === 'object') shown = JSON.stringify(v);
        return (
          <span key={k} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
            <span className="text-slate-400">{DETAIL_LABELS[k] || k}</span> {String(shown)}
          </span>
        );
      })}
    </div>
  );
};

const actionStyle = (action) => {
  const hit = ACTION_STYLES.find((s) => action.startsWith(s.prefix));
  return hit ? hit.cls : 'bg-slate-100 text-slate-700 border-slate-200';
};

const fmtTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
};

/**
 * 给 IP 加一个可读后缀：本机访问会拿到 IPv6 回环 `::1`（或 `127.0.0.1`），
 * 那不是采集错误 —— 部署到公网/隧道后才会显示访客真实 IP。
 */
const ipHint = (ip) => {
  if (!ip) return null;
  const plain = ip.replace(/^::ffff:/i, '');
  if (plain === '::1' || plain === '127.0.0.1') return '本机';
  if (/^10\./.test(plain) || /^192\.168\./.test(plain) || /^172\.(1[6-9]|2\d|3[01])\./.test(plain)) return '内网';
  if (/^f[cd][0-9a-f]{2}:/i.test(plain)) return '私有地址';
  return null;
};

export default function AuditLogsView() {
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [data, setData] = useState({ list: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (category) p.set('action', category);
    if (keyword.trim()) p.set('q', keyword.trim());
    return p.toString();
  }, [category, keyword, page, pageSize]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/admin/audit-logs?${query}`);
      setData({ list: res?.list || [], total: res?.total || 0 });
    } catch (e) {
      setError(e?.message || '加载失败');
      setData({ list: [], total: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / pageSize));

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <ShieldCheck className="text-blue-600" /> 审计日志
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            全站敏感操作留痕：登录与账号安全、角色权限、奖状与实物材料审核、系统设置。
            <b>该页面仅最高级管理员可见</b>，不会记录任何密码或凭据。
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} 刷新
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-slate-200 p-4">
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
          className="rounded-xl border px-3 py-2 text-sm bg-white"
        >
          {catalog.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            placeholder="按操作者呼号 / 动作 / 对象 / 详情内容搜索"
            className="w-full rounded-xl border py-2 pl-9 pr-3 text-sm bg-white"
          />
        </div>
        <div className="text-xs text-slate-500">
          共 <b className="text-slate-700">{data.total}</b> 条 · 第 {page} / {totalPages} 页
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 记录表 */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs">
                <th className="px-4 py-3 text-left font-bold whitespace-nowrap">时间</th>
                <th className="px-4 py-3 text-left font-bold whitespace-nowrap">操作者 / IP</th>
                <th className="px-4 py-3 text-left font-bold whitespace-nowrap">操作</th>
                <th className="px-4 py-3 text-left font-bold whitespace-nowrap">对象</th>
                <th className="px-4 py-3 text-left font-bold">详情</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> 加载中...
                  </td>
                </tr>
              )}
              {!loading && data.list.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    暂无审计记录
                  </td>
                </tr>
              )}
              {!loading &&
                data.list.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-500">{fmtTime(row.created_at)}</td>
                    {/* IP 直接跟在操作者下面：详情里另开一列在窄窗口会被挤出视口，跟在这里永远看得见 */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-bold text-slate-800">{row.actor_callsign || '—'}</div>
                      <div className="text-[11px] text-slate-400">{row.actor_role || '—'}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400" title="来源 IP">
                        {row.ip || 'IP 未知'}
                        {ipHint(row.ip) && <span className="ml-1 font-sans">（{ipHint(row.ip)}）</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${actionStyle(row.action)}`}>
                        {ACTION_LABELS[row.action] || row.action}
                      </span>
                      <div className="mt-1 font-mono text-[10px] text-slate-400">{row.action}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                      {row.target_type ? (
                        <span className="font-mono">{row.target_type}#{row.target_id || '—'}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">{renderDetail(row.detail)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
          <div className="text-xs text-slate-400">每页 {pageSize} 条，按时间倒序</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40"
            >
              <ChevronLeft size={14} /> 上一页
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40"
            >
              下一页 <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        说明：单个奖状的审核时间线（谁提交、谁打回、原因）不在此页展示，它跟随奖状本身，
        可见范围为「该奖状的管理员 + 最高级管理员」。审计记录只记敏感操作，不含密码、两步验证密钥与 LoTW 凭据。
      </p>
    </div>
  );
}
