import React, { useEffect, useState } from 'react';
import { Ticket, Plus, Trash2, Copy, Loader2, ChevronDown, ChevronRight, ShieldOff, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';
import { confirmDialog } from '../lib/confirm.jsx';

/**
 * 内测邀请码面板（仅最高级管理员可见，挂在「用户管理」页顶部）
 * ------------------------------------------------------------------
 * 门禁语义（与后端 `server/services/invites.js` 一致）：
 *   - 只作用于**新账号产生**：密码注册 + HamCQ 首次建号；
 *   - **存量账号登录完全不受影响**（否则内测期间会把自己人锁在门外）；
 *   - 关闭开关后立即恢复正常注册，配置写进 `config.json`，重启也保留。
 *
 * 生成 / 停用 / 删除全部写审计（`invite.*`）。
 */
const fmtTime = (ts) => {
  if (!ts) return '不过期';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString('zh-CN', { hour12: false });
};

export default function InviteCodePanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [requireInvite, setRequireInvite] = useState(false);
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ max_uses: 1, note: '', days: 0 });
  const [copied, setCopied] = useState('');

  const load = async () => {
    try {
      const res = await apiFetch('/admin/invite-codes');
      setRequireInvite(!!res?.requireInvite);
      setList(res?.list || []);
    } catch (e) {
      console.error('load invite codes failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createInvite = async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/admin/invite-codes', {
        method: 'POST',
        body: JSON.stringify({
          max_uses: Number(form.max_uses) || 1,
          note: form.note,
          expires_in_days: Number(form.days) || 0,
        }),
      });
      setForm({ max_uses: 1, note: '', days: 0 });
      await load();
      const code = res?.code?.code;
      if (code) {
        try { await navigator.clipboard.writeText(code); setCopied(code); } catch { /* 剪贴板不可用就算了 */ }
      }
    } catch (e) {
      alert(e.message || '生成失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleInvite = async (row) => {
    const ok = await confirmDialog({
      title: row.disabled ? '启用邀请码' : '停用邀请码',
      message: row.disabled ? `确认重新启用「${row.code}」？` : `确认停用「${row.code}」？`,
      detail: row.disabled
        ? '启用后可继续用于注册（前提是没有过期、也还有剩余次数）。'
        : '停用后该码立即不能用于注册，已用它注册的账号不受影响。',
      confirmText: row.disabled ? '启用' : '停用',
      danger: !row.disabled,
    });
    if (!ok) return;
    try {
      await apiFetch(`/admin/invite-codes/${row.id}/toggle`, { method: 'POST' });
      await load();
    } catch (e) { alert(e.message || '操作失败'); }
  };

  const deleteInvite = async (row) => {
    const ok = await confirmDialog({
      title: '删除邀请码',
      message: `确认删除「${row.code}」？`,
      detail: `已使用 ${row.used_count} / ${row.max_uses} 次。删除后无法恢复（已注册账号不受影响，但列表里再也看不到这个码与它的使用记录）。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/admin/invite-codes/${row.id}`, { method: 'DELETE' });
      await load();
    } catch (e) { alert(e.message || '删除失败'); }
  };

  const switchRequireInvite = async (next) => {
    const ok = await confirmDialog({
      title: next ? '开启邀请制' : '关闭邀请制',
      message: next
        ? '确认开启内测邀请制？'
        : '确认关闭内测邀请制（所有人可自由注册）？',
      detail: next
        ? '开启后，密码注册与 HamCQ 首次建号都必须填写有效邀请码；已有账号登录不受影响。'
        : '关闭后注册不再需要邀请码，已生成的码会保留但不再被要求。内测结束后用这个开关即可。',
      confirmText: next ? '开启' : '关闭邀请制',
      danger: !next,
    });
    if (!ok) return;
    try {
      await apiFetch('/admin/invite-settings', { method: 'POST', body: JSON.stringify({ requireInvite: next }) });
      setRequireInvite(next);
    } catch (e) { alert(e.message || '操作失败'); }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
    } catch {
      alert(`邀请码：${code}`);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {/* 标题行：开关状态 + 展开/收起 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-sm font-bold text-slate-800"
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Ticket size={16} className="text-blue-600" /> 内测邀请码
        </button>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
            requireInvite ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'
          }`}
        >
          {requireInvite ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
          {requireInvite ? '邀请制已开启' : '邀请制未开启'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => switchRequireInvite(!requireInvite)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
              requireInvite ? 'text-slate-600 hover:bg-slate-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            {requireInvite ? '关闭邀请制' : '开启邀请制'}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 p-4">
          <p className="text-xs leading-relaxed text-slate-500">
            门禁只作用于<b>新账号产生</b>（密码注册、HamCQ 首次建号）；
            <b>已有账号登录不受影响</b>。关闭开关后立即恢复自由注册，配置写入 <code>config.json</code>，重启也保留。
          </p>

          {/* 生成表单 */}
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500">可用次数</span>
              <input
                type="number"
                min={1}
                max={999}
                value={form.max_uses}
                onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
                className="mt-1 w-24 rounded-lg border p-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500">有效期（天，0 = 不过期）</span>
              <input
                type="number"
                min={0}
                value={form.days}
                onChange={(e) => setForm({ ...form, days: e.target.value })}
                className="mt-1 w-32 rounded-lg border p-2 text-sm"
              />
            </label>
            <label className="block min-w-[200px] flex-1">
              <span className="text-[11px] font-bold text-slate-500">备注（发给谁 / 用途）</span>
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="例如：给 BH7CSA 邀请的 3 位朋友"
                className="mt-1 w-full rounded-lg border p-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={createInvite}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 生成邀请码
            </button>
          </div>

          {copied && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              新邀请码已复制到剪贴板：<span className="font-mono font-bold">{copied}</span>
            </div>
          )}

          {/* 列表 */}
          {loading ? (
            <div className="py-8 text-center text-slate-400"><Loader2 size={18} className="mx-auto animate-spin" /></div>
          ) : list.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">还没有生成过邀请码</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500">
                    <th className="px-3 py-2 text-left font-bold">邀请码</th>
                    <th className="px-3 py-2 text-left font-bold whitespace-nowrap">用量</th>
                    <th className="px-3 py-2 text-left font-bold whitespace-nowrap">有效期</th>
                    <th className="px-3 py-2 text-left font-bold">备注 / 使用者</th>
                    <th className="px-3 py-2 text-right font-bold whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => copyCode(row.code)}
                          title="复制邀请码"
                          className={`inline-flex items-center gap-1 font-mono font-bold ${row.disabled ? 'text-slate-400 line-through' : 'text-blue-600'}`}
                        >
                          {row.code} <Copy size={12} />
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-600">
                        {row.used_count} / {row.max_uses}
                        {row.used_count >= row.max_uses && <span className="ml-1 text-slate-400">（已用完）</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{fmtTime(row.expires_at)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {row.note || '—'}
                        {row.used_by && row.used_by.length > 0 && (
                          <div className="mt-0.5 font-mono text-[11px] text-slate-400">已用于：{row.used_by.join('、')}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => toggleInvite(row)}
                            className="rounded-lg border px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                          >
                            {row.disabled ? '启用' : '停用'}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteInvite(row)}
                            title="删除邀请码"
                            className="rounded-lg border border-red-200 p-1.5 text-red-500 hover:bg-red-50"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
