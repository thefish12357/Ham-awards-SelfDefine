import React, { useState, useEffect } from 'react';
import { Loader2, Check, X, RefreshCw, Inbox } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';

/**
 * 实物材料审核页（仅 admin）—— M4
 * 列出待审的 QSL 卡片照片（presigned URL），管理员查看后通过 / 驳回。
 * 审核后后端会**立即删除对象**，照片不再占用空间。
 */
const EvidenceAuditView = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [reviewingId, setReviewingId] = useState(null);

    const load = () => {
        setLoading(true);
        apiFetch('/evidence/admin')
            .then(setItems)
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const review = async (id, action) => {
        let reason = '';
        if (action === 'reject') {
            const r = window.prompt('请输入驳回原因：');
            if (!r || !r.trim()) return;
            reason = r.trim();
        }
        setReviewingId(id);
        try {
            await apiFetch(`/evidence/admin/${id}/review`, {
                method: 'POST',
                body: JSON.stringify({ action, reason }),
            });
            load();
        } catch (err) {
            alert('操作失败: ' + (err.message || err.error || '未知错误'));
        } finally {
            setReviewingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold flex items-center gap-2">
                    <Inbox className="text-blue-500" /> 实物材料审核
                </h3>
                <button
                    onClick={load}
                    className="text-xs flex items-center gap-1 text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg border"
                >
                    <RefreshCw size={13} /> 刷新
                </button>
            </div>

            {loading ? (
                <div className="text-center py-16 text-slate-400">
                    <Loader2 size={24} className="animate-spin mx-auto mb-2" /> 加载中…
                </div>
            ) : items.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                    <Inbox size={32} className="mx-auto mb-2 opacity-50" /> 没有待审核的材料
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {items.map((ev) => (
                        <div key={ev.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col">
                            <div className="h-56 bg-slate-100 flex items-center justify-center overflow-hidden">
                                {ev.photo_url ? (
                                    <img src={ev.photo_url} alt="实物卡片" className="w-full h-full object-contain" />
                                ) : (
                                    <span className="text-xs text-slate-400">图片不可用（可能已删除）</span>
                                )}
                            </div>
                            <div className="p-4 flex-1 flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-sm">呼号 {ev.user_callsign}</span>
                                    <span className="text-xs text-slate-400">#{ev.id}</span>
                                </div>
                                <div className="text-xs text-slate-500">
                                    奖状：<span className="font-semibold text-slate-700">{ev.award_name}</span>
                                </div>
                                {ev.note && <div className="text-xs text-slate-500 bg-slate-50 rounded p-2">备注：{ev.note}</div>}
                                <div className="text-[11px] text-slate-400">
                                    上传于 {new Date(ev.created_at).toLocaleString('zh-CN')} · {(ev.bytes / 1024).toFixed(1)} KB
                                </div>
                                <div className="flex gap-2 mt-auto pt-2">
                                    <button
                                        onClick={() => review(ev.id, 'approve')}
                                        disabled={reviewingId === ev.id}
                                        className="flex-1 py-2 rounded-lg bg-green-600 text-white text-sm font-bold flex items-center justify-center gap-1 hover:bg-green-700 disabled:opacity-60"
                                    >
                                        {reviewingId === ev.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 通过
                                    </button>
                                    <button
                                        onClick={() => review(ev.id, 'reject')}
                                        disabled={reviewingId === ev.id}
                                        className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-bold flex items-center justify-center gap-1 hover:bg-red-600 disabled:opacity-60"
                                    >
                                        {reviewingId === ev.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} 驳回
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default EvidenceAuditView;
