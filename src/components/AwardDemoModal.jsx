import React from 'react';
import { ResponsiveAwardRenderer } from './AwardRenderer.jsx';
import { normalizeLayout } from '../lib/awardLayout.js';
import { TARGET_SPECS } from '../lib/awardTargets.js';
import { X, LogIn, UserPlus, Info, Filter, Calculator, Trophy, CheckCircle2 } from 'lucide-react';

/**
 * 落地页「在线演示」用的只读奖状详情弹层
 * ------------------------------------------------------------------
 * 与奖状大厅里真实的 `AwardDetailModal` 不同：这里**不调任何接口**、
 * 不展示「你的进度 / 申领」，进度与申领区替换为登录 / 注册引导 —— 因为
 * 访客还没登录，进度本来也算不出来，硬算只会误导。
 *
 * 设计预览用「真实渲染」（AwardRenderer，与用户实际拿到的奖状一致），
 * 只是数据来自示例（src/lib/demoAwards.js）。
 *
 * Props:
 *   - award      示例奖状对象（含 layout / rules / name / description / tracking_id）
 *   - onClose    关闭弹层
 *   - onLogin    进入登录
 *   - onRegister 进入注册
 */
export default function AwardDemoModal({ award, onClose, onLogin, onRegister }) {
  const rules = award.rules || {};
  const hasComplex = !!rules.v2;

  // 设计预览用示例数据渲染（与用户申领后看到的样式一致）
  const data = {
    callsign: 'BG1ABC',
    awardName: award.name || '',
    level: rules.thresholds?.[0]?.name || 'Award',
    // 留空：qrcode 元素在 serial 为空时渲染占位框，不向 /api/verify/<serial>/qr 发请求，
    // 避免演示用假序列号触发 400（演示无需真实可扫码的二维码）
    serial: '',
    issueDate: '2026-09-25',
    score: '—',
    issuer: award.tracking_id || '',
    verifyUrl: `${window.location.origin}/#/verify/demo`,
    description: award.description || '',
  };

  const targetLabel =
    rules.targets?.type && rules.targets.type !== 'any'
      ? TARGET_SPECS[rules.targets.type]?.label || rules.targets.type
      : '任意 QSO';

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-6xl rounded-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左：设计预览（真实渲染，示例数据） */}
        <div className="w-full md:w-5/12 bg-slate-100 h-48 md:h-auto min-h-[200px] flex flex-col gap-3 p-4 overflow-y-auto">
          <div className="relative w-full aspect-[297/210] rounded-xl overflow-hidden border border-slate-300 shadow-lg bg-white shrink-0">
            <ResponsiveAwardRenderer layout={normalizeLayout(award.layout, award.bg_url)} data={data} />
            <div className="absolute bottom-0 left-0 right-0 bg-black/55 backdrop-blur-sm p-3 text-white">
              <div className="text-xs font-bold opacity-70 uppercase tracking-wider mb-0.5">示例奖状</div>
              <h2 className="text-lg font-black leading-tight">{award.name}</h2>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 shrink-0">
            上方为示例数据渲染的真实效果，与用户实际获得的奖状样式一致。
          </p>
        </div>

        {/* 右：规则 / 等级（只读） */}
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="flex justify-between items-start mb-6">
            <div className="space-y-1">
              <h3 className="font-bold text-slate-800 text-lg">规则说明</h3>
              <div className="text-xs font-mono text-slate-400">编号: {award.tracking_id || award.id}</div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
              <X />
            </button>
          </div>

          <div>
            <h4 className="font-bold text-sm text-slate-500 mb-2 uppercase flex items-center gap-2">
              <Info size={14} /> 简介
            </h4>
            <p className="text-slate-700 leading-relaxed text-sm bg-slate-50 p-4 rounded-xl border">
              {award.description || '暂无描述'}
            </p>
          </div>

          <div className="mt-6">
            <h4 className="font-bold text-sm text-slate-500 mb-2 uppercase flex items-center gap-2">
              <Filter size={14} /> 判定条件
            </h4>
            <div className="bg-slate-50 rounded-xl p-4 border text-sm space-y-2">
              {rules.basic?.startDate && (
                <div>📅 时间范围: {rules.basic.startDate} 至 {rules.basic.endDate || '至今'}</div>
              )}
              {rules.basic?.qslRequired != null && (
                <div className={rules.basic.qslRequired ? 'text-green-600 font-bold' : 'text-slate-500'}>
                  {rules.basic.qslRequired ? '✅ 需要 QSL 确认' : '❌ 不要求 QSL 确认'}
                </div>
              )}
              {(!rules.filters || rules.filters.length === 0) && (
                <div className="text-slate-400 text-xs">无特殊筛选条件</div>
              )}
            </div>
          </div>

          {hasComplex && (
            <div className="grid grid-cols-2 gap-4 mt-6">
              <div>
                <h4 className="font-bold text-sm text-slate-500 mb-2 uppercase flex items-center gap-2">
                  <Calculator size={14} /> 计分模式
                </h4>
                <div className="bg-slate-50 p-3 rounded-lg border text-sm">
                  <div className="font-bold text-slate-700 mb-1">
                    {rules.logic === 'collection' ? '📦 收集型 (计数)' : '🔢 计分型 (累计)'}
                  </div>
                  <div className="text-xs text-slate-500">目标: {targetLabel}</div>
                </div>
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-500 mb-2 uppercase flex items-center gap-2">
                  <Trophy size={14} /> 等级要求
                </h4>
                <div className="bg-slate-50 p-3 rounded-lg border text-sm space-y-1">
                  {(rules.thresholds || [{ value: 0, name: 'Basic' }]).map((t, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span>{t.name}</span>
                      <span className="font-bold">
                        {t.fullCollection && rules.logic === 'collection' && rules.targets?.list
                          ? `${rules.targets.list.split(',').map((s) => s.trim()).filter(Boolean).length} 项全收集`
                          : `${t.value}${t.fullCollection ? ' + 全收集' : ''}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 登录引导：替代「你的进度 / 申领」 */}
          <div className="mt-8 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-indigo-700 mb-2">
              <CheckCircle2 size={15} /> 这是示例奖状的只读预览
            </div>
            <p className="text-xs leading-relaxed text-slate-600 mb-4">
              上方仅为演示数据。登录或注册后，你可以查看<strong>完整的奖状大厅</strong>、导入自己的 LoTW / ADIF 日志，
              并由系统按规则实时计算<strong>你的真实进度</strong>，达成后即可在线申领证书。
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={onLogin}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition-all hover:-translate-y-0.5"
              >
                <LogIn size={16} /> 登录查看
              </button>
              <button
                onClick={onRegister}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-300 px-4 py-2.5 text-sm font-bold text-indigo-700 transition-all hover:bg-indigo-100"
              >
                <UserPlus size={16} /> 免费注册
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
