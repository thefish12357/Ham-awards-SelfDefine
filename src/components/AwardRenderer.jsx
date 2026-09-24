import React, { useEffect, useRef, useState } from 'react';
import { resolveElementForLevel, resolveElementValue } from '../lib/awardLayout.js';
import { toSameOriginMediaUrl } from '../lib/media.js';

/**
 * 奖状渲染器（纯展示，无状态）
 * ------------------------------------------------------------------
 * 把一份 v2 布局渲染成 DOM。编辑器画布、用户「我的奖状」、将来 M3 的
 * 校验页共用同一个组件，保证「所见即所得」与 PDF 一致。
 *
 * Props:
 *   - layout      v2 布局（含 canvas + elements）
 *   - data        动态字段取值，如 { callsign, awardName, serial, ... }
 *   - widthPx     渲染宽度（px），高度按 297:210 比例自动算出
 *   - interactable 是否把 pointerdown 透出（编辑器用）
 *   - selectedId  选中元素 id（只画一层淡蓝色描边）
 *   - onElementPointerDown(event, element)
 */

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };
const ALIGN_ITEMS = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
const fontFamilyOf = (f) => f || 'inherit';

export default function AwardRenderer({
  layout,
  data = {},
  widthPx = 800,
  interactable = false,
  selectedId = null,
  onElementPointerDown,
  ignoreLevelOverrides = false,
}) {
  const canvas = layout?.canvas || { w: 297, h: 210 };
  const w = canvas.w || 297;
  const h = canvas.h || 210;
  const scale = widthPx / w;
  const px = (mm) => mm * scale;

  // 多等级差异：按 data.level 合并元素的 levelOverrides。
  // 编辑器在「默认（所有等级共用）」模式下会传 ignoreLevelOverrides 关掉它。
  const level = ignoreLevelOverrides ? null : data.level || null;
  const elements = [...(layout?.elements || [])]
    .map((el) => resolveElementForLevel(el, level))
    .sort((a, b) => (a.z || 0) - (b.z || 0));

  return (
    <div
      className="relative overflow-hidden select-none"
      style={{ width: widthPx, height: px(h), background: '#fff' }}
    >
      {/* 底图一律经 toSameOriginMediaUrl 换成 `/api/media?key=…`：
          历史数据里存的是 `http://localhost:9000/...` 绝对地址，在 https 页面下会被
          浏览器按「混合内容」拦掉（表现为「已设置底图但画布空白」），远程用户更是
          解析到自己的机器。同源代理同时也避免 canvas 跨域污染。 */}
      {canvas.bgUrl ? (
        <img
          src={toSameOriginMediaUrl(canvas.bgUrl)}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: canvas.bgFit || 'cover',
            opacity: canvas.bgOpacity ?? 1,
          }}
        />
      ) : null}

      {elements.map((el) => {
        const selected = interactable && selectedId === el.id;
        const box = {
          position: 'absolute',
          left: px(el.x),
          top: px(el.y),
          width: px(el.w),
          height: px(el.h),
          transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
          opacity: el.opacity ?? 1,
          cursor: interactable ? 'move' : undefined,
          touchAction: interactable ? 'none' : undefined,
          boxShadow: selected ? '0 0 0 1.5px #3b82f6' : undefined,
        };

        let content;
        if (el.type === 'text') {
          content = (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                justifyContent: JUSTIFY[el.align] || 'center',
                alignItems: ALIGN_ITEMS[el.valign] || 'center',
                color: el.color || '#111827',
                fontFamily: fontFamilyOf(el.font),
                fontWeight: el.weight || 400,
                fontSize: px(el.h),
                lineHeight: 1.05,
                whiteSpace: 'pre-wrap',
                overflow: 'hidden',
              }}
            >
              {resolveElementValue(el, data)}
            </div>
          );
        } else if (el.type === 'image') {
          content = el.src ? (
            <img src={toSameOriginMediaUrl(el.src)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ border: '1px dashed #cbd5e1', color: '#94a3b8', fontSize: px(4) }}
            >
              图片
            </div>
          );
        } else if (el.type === 'qrcode') {
          // 有序列号时渲染真二维码（同源接口，导出 PDF 不会污染画布）；
          // 编辑器预览里没有序列号，退化成占位框。
          const serial = data && data.serial;
          content = serial ? (
            <img
              src={`/api/verify/${encodeURIComponent(serial)}/qr`}
              alt="校验二维码"
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.04)', border: '1px dashed #94a3b8', color: '#94a3b8', fontSize: px(3.5) }}
            >
              二维码
            </div>
          );
        } else if (el.type === 'shape') {
          const strokePx = px(el.strokeWidth || 0.5);
          const s = {
            width: '100%',
            height: '100%',
            background: el.fill && el.fill !== 'none' ? el.fill : 'transparent',
            borderRadius: el.shape === 'rect' ? px(1.5) : undefined,
          };
          if (el.shape === 'line') {
            s.border = 'none';
            s.borderTop = `${strokePx}px solid ${el.stroke || '#c8a45c'}`;
          } else {
            s.border = `${strokePx}px solid ${el.stroke || '#c8a45c'}`;
          }
          content = <div style={s} />;
        } else {
          content = null;
        }

        return (
          <div
            key={el.id}
            data-elid={el.id}
            onPointerDown={interactable ? (e) => onElementPointerDown(e, el) : undefined}
            style={box}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 自适应宽度的渲染器：量出容器宽度后按比例渲染。
 * 用于「我的奖状」这类宽度由栅格布局决定的场景（渲染器本身需要的是像素宽）。
 */
export function ResponsiveAwardRenderer({ layout, data, className, style, ...rest }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ width: '100%', ...(style || {}) }}>
      {width > 0 ? <AwardRenderer layout={layout} data={data} widthPx={width} {...rest} /> : null}
    </div>
  );
}
