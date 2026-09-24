import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Check, X, RefreshCw, Inbox, ZoomIn, ZoomOut, ExternalLink } from 'lucide-react';
import { apiFetch, apiFetchBlob } from '../lib/apiFetch.js';
import { confirmDialog, promptDialog } from '../lib/confirm.jsx';
import { evidenceType, evidenceTypeLabel } from '../lib/evidenceTypes.js';

/**
 * 实物材料审核页（仅 admin / award_admin）—— M4
 * 列出待审的 QSL 卡片照片，管理员查看后通过 / 驳回。审核后后端会**立即删除对象**。
 *
 * ★ 照片取用方式（2026-09-24 修）：材料在**私有桶**里，必须带 Authorization 才能读，
 *   而 `<img src>` 无法自定义请求头。曾经返回 MinIO **预签名直链**，但直链 host 是
 *   `MINIO_PUBLIC_ENDPOINT`（本部署为 localhost:9000）：页面走 https（cloudflared 隧道）时
 *   被浏览器按**混合内容**拦掉 → 审核页照片位置只有一句「图片不可用（可能已删除）」。
 *   现在改为：列表接口只给 `has_photo`，照片本体用 `apiFetchBlob('/evidence/:id/photo')`
 *   逐条取回（服务端同源代理读私有桶），再转成 blob URL 交给 <img>。
 */
const EvidenceAuditView = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [reviewingId, setReviewingId] = useState(null);
    // 照片：evidenceId → blob URL / 加载失败原因
    const [photoUrls, setPhotoUrls] = useState({});
    const [photoErrors, setPhotoErrors] = useState({});
    // 大图预览（2026-09-24）：卡片照片只有 14rem 高的缩略图，QSL 上的字根本看不清，
    //   管理员必须能放大核对呼号/日期。这里做一个轻量的 lightbox（滚轮 + 按钮 + 键盘）。
    const [preview, setPreview] = useState(null); // { url, title }
    const [zoom, setZoom] = useState(1);
    const stageRef = useRef(null);

    const ZOOM_MIN = 0.4;
    const ZOOM_MAX = 5;
    const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
    const zoomBy = useCallback(
        (delta) => setZoom((z) => clampZoom(z + delta)),
        [],
    );

    // Esc 关闭、+/- 缩放
    useEffect(() => {
        if (!preview) return;
        const onKey = (e) => {
            if (e.key === 'Escape') setPreview(null);
            else if (e.key === '+' || e.key === '=') zoomBy(0.25);
            else if (e.key === '-' || e.key === '_') zoomBy(-0.25);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [preview, zoomBy]);

    // 滚轮缩放：React 的 onWheel 是被动监听，preventDefault 会失效，所以用原生 listener
    useEffect(() => {
        const el = stageRef.current;
        if (!preview || !el) return;
        const onWheel = (e) => {
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? 0.15 : -0.15);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [preview, zoomBy]);

    const openPreview = (ev, url) => {
        if (!url) return;
        setZoom(1);
        setPreview({ url, title: `#${ev.id} · ${ev.user_callsign} · ${evidenceTypeLabel(ev.type)}` });
    };

    const load = () => {
        setLoading(true);
        apiFetch('/evidence/admin')
            .then(setItems)
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    // 逐条把照片取成 blob URL（私有桶需要 Authorization，见文件头说明）。
    // items 变化（刷新 / 审核后移除某条）时回收旧的 blob URL，避免内存泄漏。
    useEffect(() => {
        let cancelled = false;
        const created = [];
        setPhotoErrors({});
        (async () => {
            for (const ev of items) {
                if (!ev.has_photo) continue;
                try {
                    const blob = await apiFetchBlob(`/evidence/${ev.id}/photo`);
                    if (cancelled) break;
                    const url = URL.createObjectURL(blob);
                    created.push(url);
                    setPhotoUrls((prev) => ({ ...prev, [ev.id]: url }));
                } catch (err) {
                    if (cancelled) break;
                    setPhotoErrors((prev) => ({ ...prev, [ev.id]: err?.message || '照片加载失败' }));
                }
            }
        })();
        return () => {
            cancelled = true;
            created.forEach((u) => URL.revokeObjectURL(u));
            setPhotoUrls({});
        };
    }, [items]);

    const review = async (ev, action) => {
        const id = ev.id;
        // 审核后该条会从待审列表移除、blob URL 被回收，先把大图关掉
        setPreview(null);
        const label = evidenceTypeLabel(ev.type);
        let reason = '';
        if (action === 'reject') {
            const r = await promptDialog({
                title: `驳回${label}`,
                message: '请填写驳回原因，申请人会收到这条说明。',
                detail: '照片会在驳回后立即从服务器删除，只保留这条驳回说明。',
                placeholder: '例如：卡片信息不清晰 / 与填写的通联不符',
                confirmText: '驳回',
                danger: true,
            });
            if (!r) return;
            reason = r;
        } else {
            const ok = await confirmDialog({
                title: `通过${label}`,
                message: `确认通过这份${label}？`,
                // QSO 卡会写「已确认」标记；Eyeball / SWL 是收集凭证，不动日志
                detail: evidenceType(ev.type).value === 'qsl_card'
                    ? [
                        '通过后会先按填写的信息匹配该用户的通联日志并打上「已确认」标记；',
                        ev.match_date
                            ? '若日志里没有这条通联，会按卡片信息为该用户自动补建一条（可用于其它奖状申请）。'
                            : '⚠️ 这份材料**没填通联日期**，无法去重也无法判定，因此不会补建任何日志 —— 只有审核结论入库。',
                        '照片随后立即从服务器删除，只保留审核结论。',
                      ].join('\n')
                    : '该类型属于收集凭证（不是通联），通过后**不会**改动任何日志；照片随后立即从服务器删除，只保留审核结论。',
                confirmText: '通过',
            });
            if (!ok) return;
        }
        setReviewingId(id);
        try {
            const res = await apiFetch(`/evidence/admin/${id}/review`, {
                method: 'POST',
                body: JSON.stringify({ action, reason }),
            });
            if (action === 'approve') {
                const matched = res.matched_qso || 0;
                const created = res.created_qso || 0;
                // 三种结果要让管理员当场看明白，否则会像用户一样"以为功能没生效"
                alert(
                    matched > 0
                        ? `已通过，并自动将 ${matched} 条日志标记为「已确认」`
                        : created > 0
                            ? '已通过，并已按卡片信息为该用户新增 1 条日志（可在「全部日志」看到，也能用于其它奖状申请）'
                            : evidenceType(ev.type).value === 'qsl_card'
                                ? '已通过。这份材料没填通联日期（也没匹配到已有日志），因此**没有新建任何日志**，仅有审核结论。'
                                : '已通过。该类型属于收集凭证，不动任何日志。',
                );
            }
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
                                {photoUrls[ev.id] ? (
                                    // 点缩略图 → 打开大图（可滚轮/按钮/键盘缩放）
                                    <button
                                        type="button"
                                        onClick={() => openPreview(ev, photoUrls[ev.id])}
                                        title="点击放大查看"
                                        className="group relative h-full w-full cursor-zoom-in"
                                    >
                                        <img src={photoUrls[ev.id]} alt="实物卡片" className="w-full h-full object-contain" />
                                        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[11px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                                            <ZoomIn size={12} className="mr-1 inline -mt-0.5" />点击放大
                                        </span>
                                    </button>
                                ) : photoErrors[ev.id] ? (
                                    <span className="px-4 text-center text-xs text-red-500">
                                        照片加载失败：{photoErrors[ev.id]}
                                        <br />
                                        点右上「刷新」重试
                                    </span>
                                ) : ev.has_photo ? (
                                    <span className="flex items-center gap-2 text-xs text-slate-400">
                                        <Loader2 size={14} className="animate-spin" /> 照片加载中…
                                    </span>
                                ) : (
                                    <span className="px-4 text-center text-xs text-slate-400">该记录没有照片（已按审核流程删除）</span>
                                )}
                            </div>
                            <div className="p-4 flex-1 flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-sm">呼号 {ev.user_callsign}</span>
                                    <span className="text-xs text-slate-400">#{ev.id}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* 收集要素类型：QSO 卡才参与「已确认」标记，Eyeball/SWL 只是收集凭证 */}
                                    <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                        {evidenceTypeLabel(ev.type)}
                                    </span>
                                    <span className="text-xs text-slate-500">
                                        奖状：<span className="font-semibold text-slate-700">{ev.award_name}</span>
                                    </span>
                                </div>
                                <div className="text-xs text-slate-700 bg-blue-50 rounded p-2">
                                    {evidenceType(ev.type).value === 'eyeball' ? '当面交换：' : evidenceType(ev.type).value === 'swl' ? '收听记录：' : '卡片通联：'}
                                    <b>{ev.match_callsign || '—'}</b>
                                    {ev.match_band ? ` · ${ev.match_band}` : ''}
                                    {ev.match_mode ? ` · ${ev.match_mode}` : ''}
                                    {/* 时间统一按 UTC 显示；若申请人填的是 BJT 等时区，附注他填的是哪个 */}
                                    {ev.match_date ? ` · ${ev.match_date}${ev.match_time ? ' ' + String(ev.match_time).slice(0, 2) + ':' + String(ev.match_time).slice(2) : ''} UTC` : ''}
                                    {ev.match_time && ev.match_tz_offset ? `（申请人按 UTC${ev.match_tz_offset > 0 ? '+' : '-'}${Math.abs(ev.match_tz_offset) / 60} 填写）` : ''}
                                </div>
                                {ev.note && <div className="text-xs text-slate-500 bg-slate-50 rounded p-2">备注：{ev.note}</div>}
                                <div className="text-[11px] text-slate-400">
                                    上传于 {new Date(ev.created_at).toLocaleString('zh-CN')} · {(ev.bytes / 1024).toFixed(1)} KB
                                </div>
                                <div className="flex gap-2 mt-auto pt-2">
                                    <button
                                        onClick={() => review(ev, 'approve')}
                                        disabled={reviewingId === ev.id}
                                        className="flex-1 py-2 rounded-lg bg-green-600 text-white text-sm font-bold flex items-center justify-center gap-1 hover:bg-green-700 disabled:opacity-60"
                                    >
                                        {reviewingId === ev.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 通过
                                    </button>
                                    <button
                                        onClick={() => review(ev, 'reject')}
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

            {/* 大图预览（2026-09-24）：缩略图只有 14rem 高，QSL 上的小字看不清，
                管理员必须能放大核对呼号/日期。滚轮缩放 / +/- 快捷键 / Esc 关闭 / 原图新窗口。
                —— 预览用的是上传时剥离过 EXIF 的那份，不含 GPS。 */}
            {preview && (
                <div className="fixed inset-0 z-[300] flex flex-col bg-black/85" onClick={() => setPreview(null)}>
                    <div
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-white"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="truncate text-sm font-bold">{preview.title}</div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => zoomBy(-0.25)} title="缩小（-）" className="rounded-lg bg-white/10 p-2 hover:bg-white/20"><ZoomOut size={16} /></button>
                            <span className="w-14 text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
                            <button onClick={() => zoomBy(0.25)} title="放大（+）" className="rounded-lg bg-white/10 p-2 hover:bg-white/20"><ZoomIn size={16} /></button>
                            <button onClick={() => setZoom(1)} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/20">适应屏幕</button>
                            <a
                                href={preview.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/20"
                            >
                                <ExternalLink size={14} /> 原图新窗口
                            </a>
                            <button onClick={() => setPreview(null)} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/20">
                                <X size={14} /> 关闭 (Esc)
                            </button>
                        </div>
                    </div>
                    <div ref={stageRef} className="flex-1 overflow-hidden p-4">
                        <div className="flex h-full w-full items-center justify-center">
                            <img
                                src={preview.url}
                                alt="实物材料大图"
                                onClick={(e) => e.stopPropagation()}
                                style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform .12s ease-out' }}
                                className="max-h-full max-w-full object-contain"
                            />
                        </div>
                    </div>
                    <div className="px-4 pb-4 text-center text-xs text-white/60">
                        滚轮缩放 · +/- 快捷键 · 点击空白处或 Esc 关闭
                    </div>
                </div>
            )}
        </div>
    );
};

export default EvidenceAuditView;
