import React, { useEffect, useState } from 'react';
import { MailCheck, Send, Loader2, AlertCircle, Info, RefreshCw, Users } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';
import { TWO_FA_KEY } from '../lib/apiFetch.js';

/**
 * 邮件通知设置（2026-09-30）
 * ------------------------------------------------------------------
 * 入口：侧边栏「后台管理 → 邮件通知」→ `#/mail_notify`，**仅最高级管理员（admin）**可见。
 *
 * 作用：把「**哪些站内事件同时发邮件**」交给管理员配置（用户明确要求）。
 * ★ 两层开关，缺一不可（界面里必须讲清楚，否则会被误解为"勾了就一定发"）：
 *   ① 本页：总开关 + 勾选事件（存 config.json 的 `mail` 段）；
 *   ② 用户中心「邮件提醒」：用户自己是否愿意收（`users.email_notify`，**默认关**）。
 *
 * 数据源：
 *   GET  /api/admin/mail-settings  → 当前设置 + 事件目录 + 发信通道状态 + 已订阅人数
 *   POST /api/admin/mail-settings  → 保存（需 2FA，若管理员开了 2FA）
 *   POST /api/admin/mail-test      → 给自己发一封测试信（验通道 + 模板）
 */

/** 管理员若开了 2FA，写接口需要一次性验证码：与用户中心同一套做法（存 sessionStorage 后重试） */
const with2FA = async (run, retries = 3) => {
  try {
    return await run();
  } catch (e) {
    if (retries > 0 && (e?.error === '2FA_REQUIRED' || e?.error === 'INVALID_2FA')) {
      const code = window.prompt('此操作需要两步验证，请输入 6 位验证码：');
      if (!code) throw e;
      sessionStorage.setItem(TWO_FA_KEY, code.trim());
      return with2FA(run, retries - 1);
    }
    throw e;
  }
};

export default function MailNotifyView() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ enabled: false, types: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/admin/mail-settings');
      setData(res);
      setForm({
        enabled: !!res?.settings?.enabled,
        types: Array.isArray(res?.settings?.types) ? res.settings.types : [],
      });
    } catch (e) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleType = (type) => {
    setNotice('');
    setForm((f) => ({
      ...f,
      types: f.types.includes(type) ? f.types.filter((t) => t !== type) : [...f.types, type],
    }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await with2FA(() =>
        apiFetch('/admin/mail-settings', { method: 'POST', body: JSON.stringify(form) }),
      );
      setData((d) => ({ ...d, settings: res.settings }));
      setNotice('设置已保存，立即生效（无需重启服务）');
    } catch (e) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setError('');
    setNotice('');
    try {
      const res = await with2FA(() => apiFetch('/admin/mail-test', { method: 'POST' }));
      setNotice(`测试邮件已发出 → ${res.to}，请查收（也看一眼垃圾箱）`);
    } catch (e) {
      setError(e?.message || '发送失败');
    } finally {
      setTesting(false);
    }
  };

  const catalog = data?.catalog || [];
  const audience = data?.audienceLabels || {};
  const mailer = data?.mailer || {};
  const mailerReady = !!mailer.ready;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <MailCheck className="text-blue-600" /> 邮件通知
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            决定<b>哪些站内事件同时发一封邮件</b>（审核待办、审核结果、角色申请等）。
            只有<b>在用户中心开启了「邮件提醒」且邮箱已验证</b>的账号才会收到，未开启的用户只收站内通知。
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

      {/* 发信通道状态：把「没配置」和「配了但被演示站禁掉」区分开，避免误判 */}
      <div
        className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${
          mailerReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
        }`}
      >
        {mailerReady ? <MailCheck size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
        <div className="min-w-0">
          {mailerReady ? (
            <>
              <div className="font-bold">邮件通道就绪</div>
              <div className="mt-0.5 text-xs">
                发信服务器 {mailer.host}:{mailer.port} · 发件地址 {mailer.from}（显示名「{mailer.fromName}」）
              </div>
            </>
          ) : (
            <>
              <div className="font-bold">当前无法发信，本页设置不会真正生效</div>
              <div className="mt-0.5 text-xs break-words">原因：{mailer.reason || '未配置 SMTP'}</div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
          <Info size={18} className="mt-0.5 shrink-0" />
          <span className="break-words">{notice}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">
          <Loader2 size={20} className="mx-auto mb-2 animate-spin" /> 加载中…
        </div>
      ) : (
        <>
          {/* 总开关 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <label className="flex items-start justify-between gap-4 cursor-pointer">
              <div className="min-w-0">
                <div className="font-bold text-slate-800">启用邮件通知</div>
                <div className="mt-1 text-xs text-slate-500">
                  关闭时所有事件都只发站内通知（下面的勾选会被保留，重新打开即恢复）。
                </div>
              </div>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-slate-900"
                checked={form.enabled}
                onChange={(e) => {
                  setNotice('');
                  setForm((f) => ({ ...f, enabled: e.target.checked }));
                }}
              />
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                <Users size={13} /> 已订阅邮件提醒的用户：{data?.subscribed ?? 0} 人
              </span>
              <button
                type="button"
                onClick={sendTest}
                disabled={testing || !mailerReady}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
                title={mailerReady ? '发到你自己账号绑定的邮箱' : '当前通道不可用'}
              >
                {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 给我发测试邮件
              </button>
            </div>
          </div>

          {/* 事件勾选 */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="font-bold text-slate-800">哪些事件发邮件</div>
              <div className="mt-1 text-xs text-slate-500">
                未勾选的事件只产生站内通知（铃铛 + 侧栏红点），不发邮件。
              </div>
            </div>
            <ul className="divide-y divide-slate-100">
              {catalog.map((item) => {
                const checked = form.types.includes(item.type);
                return (
                  <li key={item.type}>
                    <label className="flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-slate-900"
                        checked={checked}
                        onChange={() => toggleType(item.type)}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm font-bold ${checked ? 'text-slate-800' : 'text-slate-500'}`}>{item.label}</span>
                          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                            {audience[item.audience] || item.audience}
                          </span>
                          <span className="font-mono text-[10px] text-slate-300">{item.type}</span>
                        </div>
                        <div className="mt-1 text-xs leading-relaxed text-slate-500">{item.desc}</div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : null} 保存设置
            </button>
            <span className="text-xs text-slate-400">
              保存写入 config.json 并立即生效；若管理员开启了 2FA，会要求输入一次验证码。
            </span>
          </div>

          <p className="text-xs text-slate-400">
            说明：邮件由公共邮箱以「系统通知」身份发出（<b>请勿直接回复</b>），
            回信地址已指向对外信箱；用户随时可在「用户中心 → 邮件提醒」关闭，站内通知不受影响。
          </p>
        </>
      )}
    </div>
  );
}
