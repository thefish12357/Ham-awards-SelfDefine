import React, { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Type,
  Square,
  Image as ImageIcon,
  QrCode,
  Trash2,
  Copy,
  Undo2,
  Redo2,
  Loader2,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Layers,
} from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';
import {
  CANVAS_MM,
  FIELD_BINDINGS,
  FONTS,
  FONT_GROUPS,
  ALIGN,
  VALIGN,
  uid,
  newTextElement,
  newShapeElement,
  newImageElement,
  newQrElement,
  resolveElementForLevel,
  hasLevelOverride,
} from '../lib/awardLayout.js';
import AwardRenderer from './AwardRenderer.jsx';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// 深拷 levelOverrides：撤销/重做靠快照，浅拷会让多个快照共享同一个覆盖对象
const cloneElements = (els) =>
  (els || []).map((el) => ({
    ...el,
    levelOverrides: el.levelOverrides ? JSON.parse(JSON.stringify(el.levelOverrides)) : undefined,
  }));

const RESIZE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function resizeFrom(o, dir, dx, dy) {
  let x = o.x;
  let y = o.y;
  let w = o.w;
  let h = o.h;
  const min = 2;
  if (dir.includes('e')) w = clamp(o.w + dx, min, CANVAS_MM.w - o.x);
  if (dir.includes('s')) h = clamp(o.h + dy, min, CANVAS_MM.h - o.y);
  if (dir.includes('w')) {
    w = clamp(o.w - dx, min, o.x + o.w);
    x = o.x + o.w - w;
  }
  if (dir.includes('n')) {
    h = clamp(o.h - dy, min, o.y + o.h);
    y = o.y + o.h - h;
  }
  return { x, y, w, h };
}

const cursorFor = (dir) =>
  dir === 'n' || dir === 's' ? 'ns-resize' : dir === 'e' || dir === 'w' ? 'ew-resize' : dir === 'ne' || dir === 'sw' ? 'nesw-resize' : 'nwse-resize';

/** 底图大小上限（MB）。必须与后端 `server.js` 的 `uploadBg` limits.fileSize 保持一致 */
const MAX_BG_MB = 10;

/**
 * 可视化布局编辑器（Step 3）
 * ------------------------------------------------------------------
 * 受控组件：`layout` + `onChange`。内部维护选中态、拖拽/缩放、撤销重做。
 * 底图上传直接在这里调用 /api/awards/upload-bg（**修掉了旧版上传按钮无响应的问题**）。
 */
export default function VisualDesigner({ layout, onChange, awardName, levels = [] }) {
  const [selectedId, setSelectedId] = useState(null);
  // 多等级差异：'' = 编辑「所有等级共用」的基础设计；否则只改该等级的 levelOverrides
  const [editLevel, setEditLevel] = useState('');
  const [uploadingBg, setUploadingBg] = useState(false);
  const [error, setError] = useState(null);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [canvasPx, setCanvasPx] = useState(900);

  const wrapRef = useRef(null);
  const fileRef = useRef(null);
  const layoutRef = useRef(layout);
  const dragRef = useRef(null);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const scale = canvasPx / CANVAS_MM.w;
  const px = (mm) => mm * scale;
  const mm = (pxVal) => pxVal / scale;

  // 画布随容器宽度自适应
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 48;
      if (w > 0) setCanvasPx(Math.min(w, 1500));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const elements = layout?.elements || [];
  const selectedRaw = elements.find((el) => el.id === selectedId) || null;
  // 属性面板显示「按当前等级解析后」的值，避免和画布所见不一致
  const selected = selectedRaw ? resolveElementForLevel(selectedRaw, editLevel) : null;

  const sampleData = {
    callsign: 'BG1ABC',
    awardName: awardName || '奖状名称',
    level: 'Gold',
    serial: '1234567890123456',
    issueDate: '2026-09-21',
    score: '42',
    issuer: 'HAM AWARDS',
    verifyUrl: 'https://example.com/verify/1234567890123456',
    description: '奖状描述',
  };

  // 画布上用于预览的等级：选了等级就用它；没选时用一个真实等级名做样张，
  // 同时给渲染器传 ignoreLevelOverrides 关掉覆盖，展示「所有等级共用」的基础设计。
  const previewLevel = editLevel || levels[0] || sampleData.level;
  const renderData = { ...sampleData, level: previewLevel };

  const commitSnapshot = (els) => {
    setPast((p) => [...p, els]);
    setFuture([]);
  };

  const applyElements = (els) => onChange({ ...layoutRef.current, elements: els });

  /**
   * 统一的属性写入：选了等级就写进 levelOverrides[等级]，否则写元素本身。
   * 拖拽 / 缩放 / 属性面板都走这里，保证「编辑范围」语义一致。
   */
  const writePatch = (el, patch) => {
    if (!editLevel) return { ...el, ...patch };
    const prev = (el.levelOverrides || {})[editLevel] || {};
    return {
      ...el,
      levelOverrides: { ...(el.levelOverrides || {}), [editLevel]: { ...prev, ...patch } },
    };
  };

  /** 清除某元素在当前等级上的覆盖，回到「默认设计」 */
  const clearLevelOverride = (id) => {
    if (!editLevel) return;
    commitSnapshot(layoutRef.current.elements);
    applyElements(
      layoutRef.current.elements.map((el) => {
        if (el.id !== id || !el.levelOverrides) return el;
        const next = { ...el.levelOverrides };
        delete next[editLevel];
        return { ...el, levelOverrides: Object.keys(next).length ? next : undefined };
      }),
    );
  };

  // ---------------- 拖拽 / 缩放 ----------------
  const begin = (e, mode, el, dir) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(el.id);
    dragRef.current = {
      mode,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      // 以「当前等级解析后」的几何为基准，拖拽才与画布所见一致
      orig: { ...resolveElementForLevel(el, editLevel) },
      snapshot: cloneElements(layoutRef.current.elements),
      moved: false,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    const dx = mm(e.clientX - d.startX);
    const dy = mm(e.clientY - d.startY);
    const next = layoutRef.current.elements.map((el) => {
      if (el.id !== d.orig.id) return el;
      if (d.mode === 'move') {
        return writePatch(el, {
          x: clamp(d.orig.x + dx, 0, CANVAS_MM.w - d.orig.w),
          y: clamp(d.orig.y + dy, 0, CANVAS_MM.h - d.orig.h),
        });
      }
      return writePatch(el, resizeFrom(d.orig, d.dir, dx, dy));
    });
    applyElements(next);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    if (d && d.moved) commitSnapshot(d.snapshot);
    dragRef.current = null;
  };

  const onElementPointerDown = (e, el) => begin(e, 'move', el);
  const onHandlePointerDown = (e, el, dir) => begin(e, 'resize', el, dir);

  // ---------------- 增删改 / 图层 ----------------
  const addElement = (maker) => {
    const el = maker(CANVAS_MM.w / 2 - 50, CANVAS_MM.h / 2 - 6);
    commitSnapshot(layoutRef.current.elements);
    applyElements([...layoutRef.current.elements, el]);
    setSelectedId(el.id);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    commitSnapshot(layoutRef.current.elements);
    applyElements(layoutRef.current.elements.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    commitSnapshot(layoutRef.current.elements);
    const copy = { ...selected, id: uid(), x: selected.x + 5, y: selected.y + 5 };
    applyElements([...layoutRef.current.elements, copy]);
    setSelectedId(copy.id);
  };

  const moveLayer = (delta) => {
    if (!selected) return;
    const sorted = [...layoutRef.current.elements].sort((a, b) => (a.z || 0) - (b.z || 0));
    const idx = sorted.findIndex((el) => el.id === selectedId);
    const j = idx + delta;
    if (idx < 0 || j < 0 || j >= sorted.length) return;
    commitSnapshot(layoutRef.current.elements);
    [sorted[idx], sorted[j]] = [sorted[j], sorted[idx]];
    sorted.forEach((el, i) => {
      el.z = i;
    });
    applyElements(sorted);
  };

  const updateSelected = (patch) => {
    if (!selectedId) return;
    commitSnapshot(layoutRef.current.elements);
    applyElements(layoutRef.current.elements.map((el) => (el.id === selectedId ? writePatch(el, patch) : el)));
  };

  const undo = () => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, cloneElements(layoutRef.current.elements)]);
    applyElements(cloneElements(prev));
    setSelectedId(null);
  };

  const redo = () => {
    if (!future.length) return;
    const next = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, cloneElements(layoutRef.current.elements)]);
    applyElements(cloneElements(next));
  };

  // ---------------- 底图上传（修复「上传按钮无响应」） ----------------
  const onBgFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    // 先在前端把「类型 / 大小」拦下来并说清原因：后端 multer 拒绝时只会给一句
    // 笼统的「Upload failed」，用户根本不知道是超限还是格式不对。
    if (file.type && !/^image\//.test(file.type)) {
      setError(`「${file.name}」不是图片文件，请选择 JPG / PNG / WebP / GIF 等图片格式`);
      return;
    }
    if (file.size > MAX_BG_MB * 1024 * 1024) {
      setError(`图片约 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 ${MAX_BG_MB} MB 上限，请压缩后再上传`);
      return;
    }
    setUploadingBg(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('bg', file);
      const r = await apiFetch('/awards/upload-bg', { method: 'POST', body: fd });
      // ★ 优先用后端返回的**同源代理**地址（`/api/media?key=…`）：
      //   若存 `http://localhost:9000/...`，https 页面会按「混合内容」把图片拦掉，
      //   表现为「提示已设置底图、画布却一直空白」；远程用户更是解析到自己机器。
      const url = r.mediaUrl || r.url;
      if (!url) throw new Error('服务端未返回图片地址，请检查对象存储配置');
      onChange({ ...layoutRef.current, canvas: { ...layoutRef.current.canvas, bgUrl: url } });
    } catch (err) {
      setError(err?.message || '底图上传失败，请检查对象存储是否已配置');
    } finally {
      setUploadingBg(false);
    }
  };

  // ---------------- 选中态覆盖层 ----------------
  const renderHandles = () => {
    if (!selected) return null;
    const r = { left: px(selected.x), top: px(selected.y), width: px(selected.w), height: px(selected.h) };
    const pos = {
      nw: [r.left - 6, r.top - 6],
      n: [r.left + r.width / 2 - 6, r.top - 6],
      ne: [r.left + r.width - 6, r.top - 6],
      e: [r.left + r.width - 6, r.top + r.height / 2 - 6],
      se: [r.left + r.width - 6, r.top + r.height - 6],
      s: [r.left + r.width / 2 - 6, r.top + r.height - 6],
      sw: [r.left - 6, r.top + r.height - 6],
      w: [r.left - 6, r.top + r.height / 2 - 6],
    };
    return RESIZE_DIRS.map((dir) => (
      <div
        key={dir}
        onPointerDown={(e) => onHandlePointerDown(e, selected, dir)}
        className="absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-sm z-20"
        style={{ left: pos[dir][0], top: pos[dir][1], cursor: cursorFor(dir), touchAction: 'none' }}
      />
    ));
  };

  const fieldLabel = (v) => (FIELD_BINDINGS.find((f) => f.value === v) || {}).label || v;
  const sortedElements = [...elements].sort((a, b) => (a.z || 0) - (b.z || 0));

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左侧：底图 + 元素 + 撤销重做 */}
      <div className="w-64 bg-slate-50 border-r flex flex-col shrink-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-xs flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <h4 className="font-bold mb-2 text-sm">奖状底图</h4>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onBgFile} />
            <button
              type="button"
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={uploadingBg}
              className="w-full p-4 border-2 border-dashed border-slate-300 rounded-xl text-center text-sm text-slate-600 hover:bg-white flex flex-col items-center gap-2 disabled:opacity-60"
            >
              {uploadingBg ? <Loader2 size={20} className="text-slate-400 animate-spin" /> : <Upload size={20} className="text-slate-400" />}
              <span className="font-bold">{uploadingBg ? '上传中…' : layout?.canvas?.bgUrl ? '更换底图' : '点击上传底图'}</span>
            </button>
            <p className="text-xs text-slate-400 mt-1">{layout?.canvas?.bgUrl ? '已设置底图' : '未设置底图（保存前必须上传）'}</p>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              支持 JPG / PNG / WebP 等图片格式，单张不超过 <b>{MAX_BG_MB} MB</b>；建议 A4 横版比例（297×210）。
            </p>
          </div>

          <div>
            <h4 className="font-bold mb-2 text-sm">添加元素</h4>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => addElement(newTextElement)} className="p-3 border rounded-xl hover:bg-white flex flex-col items-center gap-1 text-xs font-bold text-slate-600">
                <Type size={18} /> 文字
              </button>
              <button type="button" onClick={() => addElement(newShapeElement)} className="p-3 border rounded-xl hover:bg-white flex flex-col items-center gap-1 text-xs font-bold text-slate-600">
                <Square size={18} /> 形状
              </button>
              <button type="button" onClick={() => addElement(newImageElement)} className="p-3 border rounded-xl hover:bg-white flex flex-col items-center gap-1 text-xs font-bold text-slate-600">
                <ImageIcon size={18} /> 图片
              </button>
              <button type="button" onClick={() => addElement(newQrElement)} className="p-3 border rounded-xl hover:bg-white flex flex-col items-center gap-1 text-xs font-bold text-slate-600">
                <QrCode size={18} /> 二维码
              </button>
            </div>
          </div>

          <div>
            <h4 className="font-bold mb-2 text-sm">元素列表</h4>
            <div className="space-y-1">
              {sortedElements.length === 0 && <p className="text-xs text-slate-400">尚未添加元素</p>}
              {sortedElements.map((elRaw) => {
                const el = resolveElementForLevel(elRaw, editLevel);
                const overridden = hasLevelOverride(elRaw, editLevel);
                return (
                  <button
                    key={elRaw.id}
                    type="button"
                    onClick={() => setSelectedId(elRaw.id)}
                    title={overridden ? `该项在「${editLevel}」等级有单独设置` : undefined}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between ${selectedId === elRaw.id ? 'bg-blue-100 text-blue-800 font-bold' : 'hover:bg-white text-slate-600'}`}
                  >
                    <span className="truncate flex items-center gap-1">
                      {el.type === 'text' ? `文字 · ${fieldLabel(el.binding)}` : el.type === 'shape' ? '形状' : el.type === 'image' ? '图片' : '二维码'}
                      {overridden && <span className="text-amber-600 font-black">•</span>}
                    </span>
                    <span className="text-slate-400">{Math.round(el.x)},{Math.round(el.y)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-3 border-t flex gap-2">
          <button type="button" onClick={undo} disabled={!past.length} className="flex-1 py-2 border rounded-lg text-xs font-bold text-slate-600 disabled:opacity-40 flex items-center justify-center gap-1">
            <Undo2 size={14} /> 撤销
          </button>
          <button type="button" onClick={redo} disabled={!future.length} className="flex-1 py-2 border rounded-lg text-xs font-bold text-slate-600 disabled:opacity-40 flex items-center justify-center gap-1">
            <Redo2 size={14} /> 重做
          </button>
        </div>
      </div>

      {/* 中间：画布 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 多等级差异：选择编辑范围 */}
        {levels.length > 0 && (
          <div className="bg-slate-700 text-white px-4 py-2 flex flex-wrap items-center gap-3 text-xs shrink-0">
            <span className="font-bold flex items-center gap-1">
              <Layers size={14} /> 编辑范围
            </span>
            <select
              value={editLevel}
              onChange={(e) => setEditLevel(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1"
            >
              <option value="">默认（所有等级共用）</option>
              {levels.map((lv) => (
                <option key={lv} value={lv}>
                  {lv}
                </option>
              ))}
            </select>
            {editLevel ? (
              <span className="text-amber-300">正在编辑「{editLevel}」的差异，只影响该等级</span>
            ) : (
              <span className="text-slate-400">改动应用到所有等级（除非某等级已单独覆盖）</span>
            )}
          </div>
        )}
        <div
          ref={wrapRef}
          className="flex-1 bg-slate-800 p-4 overflow-auto flex items-start justify-center"
          onPointerDown={() => setSelectedId(null)}
          style={{ touchAction: 'none' }}
        >
          <div className="relative shadow-2xl bg-white" style={{ width: canvasPx, height: px(CANVAS_MM.h), flexShrink: 0 }}>
            <AwardRenderer
              layout={layout}
              data={renderData}
              widthPx={canvasPx}
              interactable
              selectedId={selectedId}
              onElementPointerDown={onElementPointerDown}
              ignoreLevelOverrides={!editLevel}
            />
            {renderHandles()}
          </div>
        </div>
      </div>

      {/* 右侧：属性面板 */}
      <div className="w-72 border-l bg-white overflow-y-auto p-4 shrink-0">
        {!selected ? (
          <div className="text-sm text-slate-400 text-center py-10">点击画布上的元素进行编辑</div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <h4 className="font-bold">元素属性</h4>
              <div className="flex gap-1">
                <button type="button" onClick={() => moveLayer(-1)} className="p-1.5 border rounded hover:bg-slate-50" title="上移一层"><ChevronUp size={14} /></button>
                <button type="button" onClick={() => moveLayer(1)} className="p-1.5 border rounded hover:bg-slate-50" title="下移一层"><ChevronDown size={14} /></button>
                <button type="button" onClick={duplicateSelected} className="p-1.5 border rounded hover:bg-slate-50" title="复制"><Copy size={14} /></button>
                <button type="button" onClick={removeSelected} className="p-1.5 border rounded text-red-600 hover:bg-red-50" title="删除"><Trash2 size={14} /></button>
              </div>
            </div>

            {editLevel ? (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-2 text-xs space-y-1">
                <div>正在编辑「{editLevel}」的差异，只对该等级生效。</div>
                {hasLevelOverride(selectedRaw, editLevel) && (
                  <button type="button" onClick={() => clearLevelOverride(selectedId)} className="font-bold underline">
                    清除本元素在该等级的覆盖
                  </button>
                )}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-slate-500">X (mm)</span>
                <input type="number" className="w-full mt-1 p-2 border rounded-lg" value={Math.round(selected.x)} onChange={(e) => updateSelected({ x: Number(e.target.value) || 0 })} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Y (mm)</span>
                <input type="number" className="w-full mt-1 p-2 border rounded-lg" value={Math.round(selected.y)} onChange={(e) => updateSelected({ y: Number(e.target.value) || 0 })} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">宽 (mm)</span>
                <input type="number" className="w-full mt-1 p-2 border rounded-lg" value={Math.round(selected.w)} onChange={(e) => updateSelected({ w: Math.max(1, Number(e.target.value) || 0) })} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">高 (mm)</span>
                <input type="number" className="w-full mt-1 p-2 border rounded-lg" value={Math.round(selected.h)} onChange={(e) => updateSelected({ h: Math.max(1, Number(e.target.value) || 0) })} />
              </label>
            </div>

            {selected.type === 'text' && (
              <>
                <label className="block">
                  <span className="text-xs text-slate-500">内容</span>
                  <select className="w-full mt-1 p-2 border rounded-lg" value={selected.binding || 'custom'} onChange={(e) => updateSelected({ binding: e.target.value })}>
                    {FIELD_BINDINGS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </label>
                {(!selected.binding || selected.binding === 'custom') && (
                  <label className="block">
                    <span className="text-xs text-slate-500">固定文字</span>
                    <input className="w-full mt-1 p-2 border rounded-lg" value={selected.text || ''} onChange={(e) => updateSelected({ text: e.target.value })} />
                  </label>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs text-slate-500">字号（=元素高 mm）</span>
                    <input type="number" className="w-full mt-1 p-2 border rounded-lg" value={Math.round(selected.h)} onChange={(e) => updateSelected({ h: Math.max(1, Number(e.target.value) || 0) })} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">字重</span>
                    <select className="w-full mt-1 p-2 border rounded-lg" value={selected.weight || 400} onChange={(e) => updateSelected({ weight: Number(e.target.value) })}>
                      <option value={400}>常规</option>
                      <option value={700}>加粗</option>
                      <option value={300}>细体</option>
                    </select>
                  </label>
                </div>
                {/* 字体选项较多，独占一行并按分组折叠 */}
                <label className="block">
                  <span className="text-xs text-slate-500">字体（仅开源可商用 / 系统字体）</span>
                  <select
                    className="w-full mt-1 p-2 border rounded-lg"
                    value={selected.font || ''}
                    onChange={(e) => updateSelected({ font: e.target.value })}
                  >
                    <option value="">系统默认</option>
                    {FONT_GROUPS.map((g) => (
                      <optgroup key={g} label={g}>
                        {FONTS.filter((f) => f.group === g).map((f) => (
                          <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                            {f.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <span className="text-[10px] text-slate-400">
                    需本机已安装才生效，未安装会按栈顺序回退；列表只收录开源可商用授权与系统字体。
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">颜色</span>
                  <input type="color" className="w-full mt-1 p-1 border rounded-lg h-9" value={selected.color || '#111827'} onChange={(e) => updateSelected({ color: e.target.value })} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs text-slate-500">水平对齐</span>
                    <select className="w-full mt-1 p-2 border rounded-lg" value={selected.align || 'center'} onChange={(e) => updateSelected({ align: e.target.value })}>
                      {ALIGN.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">垂直对齐</span>
                    <select className="w-full mt-1 p-2 border rounded-lg" value={selected.valign || 'middle'} onChange={(e) => updateSelected({ valign: e.target.value })}>
                      {VALIGN.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}

            {selected.type === 'image' && (
              <label className="block">
                <span className="text-xs text-slate-500">图片 URL</span>
                <input className="w-full mt-1 p-2 border rounded-lg font-mono text-xs" placeholder="https://…" value={selected.src || ''} onChange={(e) => updateSelected({ src: e.target.value })} />
                <span className="text-xs text-slate-400">例如印章、logo 的公开地址</span>
              </label>
            )}

            {selected.type === 'qrcode' && (
              <label className="block">
                <span className="text-xs text-slate-500">二维码内容</span>
                <select className="w-full mt-1 p-2 border rounded-lg" value={selected.binding || 'verifyUrl'} onChange={(e) => updateSelected({ binding: e.target.value })}>
                  <option value="verifyUrl">校验链接（推荐）</option>
                  <option value="custom">自定义文字</option>
                </select>
                {selected.binding === 'custom' && (
                  <input className="w-full mt-2 p-2 border rounded-lg" value={selected.text || ''} onChange={(e) => updateSelected({ text: e.target.value })} />
                )}
              </label>
            )}

            {selected.type === 'shape' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs text-slate-500">形状</span>
                    <select className="w-full mt-1 p-2 border rounded-lg" value={selected.shape || 'rect'} onChange={(e) => updateSelected({ shape: e.target.value })}>
                      <option value="rect">矩形边框</option>
                      <option value="line">直线</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">线宽 (mm)</span>
                    <input type="number" step="0.1" className="w-full mt-1 p-2 border rounded-lg" value={selected.strokeWidth || 0.5} onChange={(e) => updateSelected({ strokeWidth: Number(e.target.value) || 0 })} />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs text-slate-500">边框色</span>
                    <input type="color" className="w-full mt-1 p-1 border rounded-lg h-9" value={selected.stroke || '#c8a45c'} onChange={(e) => updateSelected({ stroke: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">填充色</span>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="color" className="p-1 border rounded-lg h-9" value={selected.fill === 'none' || !selected.fill ? '#ffffff' : selected.fill} onChange={(e) => updateSelected({ fill: e.target.value })} />
                      <button type="button" className="text-xs text-slate-500 border rounded px-2 py-1" onClick={() => updateSelected({ fill: 'none' })}>无</button>
                    </div>
                  </label>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-slate-500">透明度</span>
                <input type="number" step="0.05" min="0" max="1" className="w-full mt-1 p-2 border rounded-lg" value={selected.opacity ?? 1} onChange={(e) => updateSelected({ opacity: clamp(Number(e.target.value) || 0, 0, 1) })} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">旋转 (度)</span>
                <input type="number" step="1" className="w-full mt-1 p-2 border rounded-lg" value={selected.rotation || 0} onChange={(e) => updateSelected({ rotation: Number(e.target.value) || 0 })} />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
