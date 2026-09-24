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
  ChevronsUp,
  ChevronsDown,
  AlertCircle,
  Layers,
  LayoutTemplate,
  FolderOpen,
  Save,
  Pencil,
} from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';
import {
  CANVAS_MM,
  FIELD_BINDINGS,
  FONTS,
  FONT_GROUPS,
  ALIGN,
  VALIGN,
  SHAPES,
  shapeLabel,
  uid,
  newTextElement,
  newShapeElement,
  newImageElement,
  newQrElement,
  presetAwardLayout,
  resolveElementForLevel,
  hasLevelOverride,
} from '../lib/awardLayout.js';
import { ASSET_MAX_DIM, ASSET_LIMIT_TEXT, BG_LIMIT_TEXT, ACCEPT_IMAGE, ACCEPT_IMAGE_TEXT } from '../lib/uploadLimits.js';
import { prepareImageForUpload, BG_UPLOAD_PRESET } from '../lib/imageUpload.js';
import { toSameOriginMediaUrl } from '../lib/media.js';
import { confirmDialog, promptDialog } from '../lib/confirm.jsx';
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

/**
 * 可视化布局编辑器（Step 3）
 * ------------------------------------------------------------------
 * 受控组件：`layout` + `onChange`。内部维护选中态、拖拽/缩放、撤销重做。
 * 底图/图片上传都走各自的接口（**修掉了旧版上传按钮无响应的问题**）：
 *   - 底图      → POST /api/awards/upload-bg     （≤ BG_MAX_MB）
 *   - 图片元素  → POST /api/awards/upload-asset  （≤ ASSET_MAX_MB，仅图片元素用）
 */
export default function VisualDesigner({ layout, onChange, awardName, levels = [] }) {
  const [selectedId, setSelectedId] = useState(null);
  // 多等级差异：'' = 编辑「所有等级共用」的基础设计；否则只改该等级的 levelOverrides
  const [editLevel, setEditLevel] = useState('');
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  // 我的模板库（存在服务端，跨设备可用）；拉取失败静默处理，不阻塞设计
  const [templates, setTemplates] = useState([]);
  const [templatesBusy, setTemplatesBusy] = useState(false);
  const [error, setError] = useState(null);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [canvasPx, setCanvasPx] = useState(900);

  const wrapRef = useRef(null);
  const fileRef = useRef(null);
  const imgFileRef = useRef(null);
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

  // 「我的模板」：进入编辑器时拉一次列表（失败静默，不阻塞设计流程）
  useEffect(() => {
    apiFetch('/award-templates').then(setTemplates).catch(() => {});
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

  /** 层级重排统一入口：传入「从底到顶」的新顺序，重写 z 后落盘 */
  const applyOrder = (ordered) => applyElements(ordered.map((el, i) => ({ ...el, z: i })));

  const layerSorted = () => [...layoutRef.current.elements].sort((a, b) => (a.z || 0) - (b.z || 0));

  /** delta > 0 = 向上一层（更靠前）；delta < 0 = 向下一层（更靠后） */
  const moveLayer = (delta) => {
    if (!selected) return;
    const sorted = layerSorted();
    const idx = sorted.findIndex((el) => el.id === selectedId);
    const j = idx + delta;
    if (idx < 0 || j < 0 || j >= sorted.length) return;
    commitSnapshot(layoutRef.current.elements);
    [sorted[idx], sorted[j]] = [sorted[j], sorted[idx]];
    applyOrder(sorted);
  };

  /** 置于顶层：盖住所有其它元素（含边框装饰） */
  const bringToFront = () => {
    if (!selected) return;
    const sorted = layerSorted();
    const idx = sorted.findIndex((el) => el.id === selectedId);
    if (idx < 0 || idx === sorted.length - 1) return;
    commitSnapshot(layoutRef.current.elements);
    const [el] = sorted.splice(idx, 1);
    sorted.push(el);
    applyOrder(sorted);
  };

  /** 置于底层：压在底图之上、所有元素之下 */
  const sendToBack = () => {
    if (!selected) return;
    const sorted = layerSorted();
    const idx = sorted.findIndex((el) => el.id === selectedId);
    if (idx <= 0) return;
    commitSnapshot(layoutRef.current.elements);
    const [el] = sorted.splice(idx, 1);
    sorted.unshift(el);
    applyOrder(sorted);
  };

  /** 一键载入预设模板（保留当前底图），用于新建时没选模板、或想推倒重来 */
  const loadPreset = async () => {
    const ok = await confirmDialog({
      title: '载入预设模板',
      message: '将用内置模板替换当前所有元素，底图会保留。',
      detail: '模板包含：标题、呼号、等级、证书编号、签发日期、颁发机构、校验二维码与双线边框。当前设计将被清空（可用「撤销」恢复）。',
      confirmText: '载入模板',
    });
    if (!ok) return;
    commitSnapshot(layoutRef.current.elements);
    const next = presetAwardLayout(layoutRef.current.canvas?.bgUrl || '');
    onChange({ ...layoutRef.current, elements: next.elements });
    setSelectedId(null);
  };

  /* ---------------- 我的模板库 ----------------
   * 存在服务端（按创建者私有），跨设备/换浏览器都能用。
   * ⚠️ 只存元素与画布样式，**不存底图**（后端会剥掉 bgUrl）：套模板时保留当前底图。
   * ---------------------------------------------- */

  const refreshTemplates = () => apiFetch('/award-templates').then(setTemplates).catch(() => {});

  const saveAsTemplate = async () => {
    const els = layoutRef.current.elements || [];
    if (els.length === 0) {
      setError('当前设计还没有任何元素，无法保存为模板');
      return;
    }
    const name = await promptDialog({
      title: '另存为我的模板',
      message: `把这套版式（${els.length} 个元素）保存成模板，之后可一键套用到别的奖状。`,
      detail: '只保存元素的排版与样式，不包含底图；套用时会保留当前奖状自己的底图。',
      placeholder: '例如：金边双线版 / A4 横版经典',
      required: true,
      confirmText: '保存模板',
    });
    if (name === null) return;
    setTemplatesBusy(true);
    setError(null);
    try {
      await apiFetch('/award-templates', {
        method: 'POST',
        body: JSON.stringify({ name, layout: layoutRef.current }),
      });
      await refreshTemplates();
    } catch (e) {
      setError(e?.message || '模板保存失败');
    } finally {
      setTemplatesBusy(false);
    }
  };

  const applyTemplate = async (t) => {
    const ok = await confirmDialog({
      title: '套用模板',
      message: `用「${t.name}」替换当前所有元素？`,
      detail: '底图会保留；当前设计可以用左下角的「撤销」恢复。',
      confirmText: '套用',
    });
    if (!ok) return;
    setTemplatesBusy(true);
    setError(null);
    try {
      const full = await apiFetch(`/award-templates/${t.id}`);
      const els = (full?.layout?.elements || []).map((el) => ({ ...el, id: uid() }));
      if (els.length === 0) throw new Error('该模板没有元素');
      commitSnapshot(layoutRef.current.elements);
      // 保留当前底图；画布样式（bgFit/bgOpacity）从模板带过来
      onChange({
        ...layoutRef.current,
        canvas: {
          ...layoutRef.current.canvas,
          bgFit: full.layout?.canvas?.bgFit || layoutRef.current.canvas?.bgFit,
          bgOpacity: full.layout?.canvas?.bgOpacity ?? layoutRef.current.canvas?.bgOpacity,
        },
        elements: els,
      });
      setSelectedId(null);
    } catch (e) {
      setError(e?.message || '模板套用失败');
    } finally {
      setTemplatesBusy(false);
    }
  };

  const renameTemplate = async (t) => {
    const name = await promptDialog({
      title: '重命名模板',
      message: '修改模板名称（不影响已套用的奖状）。',
      defaultValue: t.name,
      required: true,
      confirmText: '保存',
    });
    if (name === null || name === t.name) return;
    setError(null);
    try {
      await apiFetch(`/award-templates/${t.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      await refreshTemplates();
    } catch (e) {
      setError(e?.message || '重命名失败');
    }
  };

  const deleteTemplate = async (t) => {
    const ok = await confirmDialog({
      title: '删除模板',
      message: `确认删除模板「${t.name}」？`,
      detail: '只删除模板本身，已经用该模板设计好的奖状不受影响。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await apiFetch(`/award-templates/${t.id}`, { method: 'DELETE' });
      await refreshTemplates();
    } catch (e) {
      setError(e?.message || '删除失败');
    }
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
    setUploadingBg(true);
    setError(null);
    try {
      // 类型 / 尺寸 / 体积三项校验 + 必要时等比缩小
      const { file: prepared } = await prepareImageForUpload(file, BG_UPLOAD_PRESET);
      const fd = new FormData();
      fd.append('bg', prepared);
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

  // ---------------- 图片元素上传（印章 / logo / 小图标） ----------------
  const onImageFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !selectedId) return;
    setUploadingImg(true);
    setError(null);
    try {
      const { file: prepared, width, height, scaled } = await prepareImageForUpload(file, { label: '图片' });
      const fd = new FormData();
      fd.append('image', prepared);
      const r = await apiFetch('/awards/upload-asset', { method: 'POST', body: fd });
      const url = r.mediaUrl || r.url;
      if (!url) throw new Error('服务端未返回图片地址，请检查对象存储配置');
      // 按上传后的真实宽高比重算元素高度，避免图片被拉伸变形
      const ar = width / height;
      const w = selected.w;
      const h = Math.max(1, Math.round((w / ar) * 10) / 10);
      updateSelected({ src: url, w, h });
      if (scaled) setError(`图片超过最长边 ${ASSET_MAX_DIM}px，已自动等比缩小到 ${width}×${height}px 再上传`);
    } catch (err) {
      setError(err?.message || '图片上传失败，请检查对象存储是否已配置');
    } finally {
      setUploadingImg(false);
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
  // 图层列表按「上层在前」排列（z 大的在前），与「置于顶层/底层」的直觉一致
  const sortedElements = [...elements].sort((a, b) => (b.z || 0) - (a.z || 0));

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
            <input ref={fileRef} type="file" accept={ACCEPT_IMAGE} className="hidden" onChange={onBgFile} />
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
              支持 JPG / PNG / WebP / GIF，{BG_LIMIT_TEXT}。
            </p>
          </div>

          {/* ★ 模板库刻意排在「添加元素」之前：先挑模板/内置模板再补元素，
              也避免被下方很长的图层列表挤到折叠线以下（左栏内容比可视高度高约 2.5 倍）。 */}
          <div>
            <h4 className="font-bold mb-2 text-sm flex items-center justify-between">
              <span className="flex items-center gap-1"><FolderOpen size={14} /> 我的模板</span>
              {templates.length > 0 && <span className="font-normal text-[10px] text-slate-400">{templates.length} 个</span>}
            </h4>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={saveAsTemplate}
                disabled={templatesBusy}
                className="p-2.5 border rounded-xl hover:bg-white flex items-center justify-center gap-1.5 text-xs font-bold text-slate-600 disabled:opacity-60"
                title="把当前版式另存为「我的模板」"
              >
                <Save size={15} /> 存为模板
              </button>
              <button
                type="button"
                onClick={loadPreset}
                className="p-2.5 border rounded-xl hover:bg-white flex items-center justify-center gap-1.5 text-xs font-bold text-slate-600"
                title="用内置模板替换当前元素（标题 / 呼号 / 编号 / 二维码等）"
              >
                <LayoutTemplate size={15} /> 内置模板
              </button>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {templates.length === 0 && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  还没有模板。排好版后点「存为模板」，之后可一键套用到别的奖状。
                </p>
              )}
              {templates.map((t) => (
                <div key={t.id} className="flex items-center gap-1 rounded-lg border bg-white/70 pl-2 pr-1 py-1">
                  <button
                    type="button"
                    onClick={() => applyTemplate(t)}
                    disabled={templatesBusy}
                    className="flex-1 min-w-0 text-left text-xs font-bold text-slate-600 hover:text-blue-600 truncate"
                    title={`套用「${t.name}」（${t.element_count} 个元素）`}
                  >
                    {t.name}
                    <span className="ml-1 font-normal text-[10px] text-slate-400">{t.element_count} 项</span>
                  </button>
                  <button type="button" onClick={() => renameTemplate(t)} className="p-1 text-slate-400 hover:text-slate-700" title="重命名"><Pencil size={12} /></button>
                  <button type="button" onClick={() => deleteTemplate(t)} className="p-1 text-slate-400 hover:text-red-600" title="删除"><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
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
            <h4 className="font-bold mb-2 text-sm">
              图层 <span className="font-normal text-slate-400">（上层在前）</span>
            </h4>
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
                      {el.type === 'text'
                        ? `文字 · ${fieldLabel(el.binding)}`
                        : el.type === 'shape'
                          ? `形状 · ${shapeLabel(el.shape)}`
                          : el.type === 'image'
                            ? '图片'
                            : '二维码'}
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
                <button type="button" onClick={bringToFront} className="p-1.5 border rounded hover:bg-slate-50" title="置于顶层"><ChevronsUp size={14} /></button>
                <button type="button" onClick={() => moveLayer(1)} className="p-1.5 border rounded hover:bg-slate-50" title="上移一层"><ChevronUp size={14} /></button>
                <button type="button" onClick={() => moveLayer(-1)} className="p-1.5 border rounded hover:bg-slate-50" title="下移一层"><ChevronDown size={14} /></button>
                <button type="button" onClick={sendToBack} className="p-1.5 border rounded hover:bg-slate-50" title="置于底层"><ChevronsDown size={14} /></button>
                <button type="button" onClick={duplicateSelected} className="p-1.5 border rounded hover:bg-slate-50" title="复制"><Copy size={14} /></button>
                <button type="button" onClick={removeSelected} className="p-1.5 border rounded text-red-600 hover:bg-red-50" title="删除"><Trash2 size={14} /></button>
              </div>
            </div>
            <p className="text-[10px] leading-tight text-slate-400">
              图层顺序：<b>置于底层</b>压在底图之上、其它元素之下；<b>置于顶层</b>盖住所有元素。
            </p>

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
              <div className="space-y-2">
                <input ref={imgFileRef} type="file" accept={ACCEPT_IMAGE} className="hidden" onChange={onImageFile} />
                <button
                  type="button"
                  onClick={() => imgFileRef.current && imgFileRef.current.click()}
                  disabled={uploadingImg}
                  className="w-full p-3 border-2 border-dashed border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {uploadingImg ? <Loader2 size={16} className="text-slate-400 animate-spin" /> : <Upload size={16} className="text-slate-400" />}
                  {uploadingImg ? '上传中…' : selected.src ? '更换图片' : '上传图片'}
                </button>
                <p className="text-[10px] leading-relaxed text-slate-400">
                  支持 {ACCEPT_IMAGE_TEXT}；{ASSET_LIMIT_TEXT}。上传后存本站对象存储，导出 PDF 不会缺图。
                </p>
                {selected.src ? (
                  <div className="border rounded-lg p-2 bg-slate-50">
                    <img src={toSameOriginMediaUrl(selected.src)} alt="" className="max-h-24 mx-auto object-contain" />
                  </div>
                ) : null}
                <label className="block">
                  <span className="text-xs text-slate-500">或使用外链图片 URL</span>
                  <input className="w-full mt-1 p-2 border rounded-lg font-mono text-xs" placeholder="https://…" value={selected.src || ''} onChange={(e) => updateSelected({ src: e.target.value })} />
                  <span className="text-[10px] text-slate-400">外链图片可能跨域失效、导出缺图，建议改为上传。</span>
                </label>
              </div>
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
                      {SHAPES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-slate-500">线宽 (mm)</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      className="w-full mt-1 p-2 border rounded-lg"
                      value={selected.strokeWidth ?? 1}
                      onChange={(e) => updateSelected({ strokeWidth: Math.max(0.1, Number(e.target.value) || 0.1) })}
                    />
                  </label>
                </div>
                {selected.shape === 'roundRect' && (
                  <label className="block">
                    <span className="text-xs text-slate-500">圆角半径 (mm，留空为默认)</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      placeholder="默认"
                      className="w-full mt-1 p-2 border rounded-lg"
                      value={selected.radius ?? ''}
                      onChange={(e) => updateSelected({ radius: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </label>
                )}
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
                <p className="text-[10px] leading-tight text-slate-400">
                  形状可自由拉伸不变形；线宽按 mm 换算，编辑器里会自动保证至少 1 像素可见（打印仍按 mm）。
                </p>
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
