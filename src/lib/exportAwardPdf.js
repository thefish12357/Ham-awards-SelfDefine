/**
 * 奖状 PDF 导出（客户端栅格化）
 * ------------------------------------------------------------------
 * 做法：把 `AwardRenderer` 渲染到一个离屏容器里 → `html-to-image` 按 300 DPI 栅格化
 *      → `jsPDF` 铺满 A4（尺寸取自布局的 canvas，默认 297×210 mm）→ 下载。
 *
 * 为什么走客户端：
 *   - 不用往仓库塞 CJK 字体（服务端矢量方案需要 Noto Sans SC，约 8–10 MB）；
 *   - 浏览器自己渲染中文，所见即所得，与编辑器预览、我的奖状完全一致。
 *
 * ⚠️ 关键坑：**画布跨域污染**。底图存在 MinIO（另一个端口），直接画进 canvas 会让
 * `toDataURL` 抛 SecurityError。因此这里把「本站对象存储」的图片 URL 统一换成
 * 同源代理 `/api/media?key=...`（见 server.js）。非本站的图片地址无法保证，会在导出时失败。
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import AwardRenderer from '../components/AwardRenderer.jsx';
import { toSameOriginMediaUrl } from './media.js';

const MM_PER_INCH = 25.4;
const EXPORT_DPI = 300;
/** 离屏渲染使用的 CSS 宽度；再用 pixelRatio 放大到目标像素 */
const RENDER_CSS_WIDTH = 1200;

// 同源代理地址换算已上提到 `src/lib/media.js`（展示位与导出共用同一份实现）。
export function prepareLayoutForExport(layout) {
  if (!layout) return layout;
  return {
    ...layout,
    canvas: { ...layout.canvas, bgUrl: toSameOriginMediaUrl(layout.canvas?.bgUrl) },
    elements: (layout.elements || []).map((el) =>
      el.type === 'image' ? { ...el, src: toSameOriginMediaUrl(el.src) } : el,
    ),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 等待离屏容器里的图片结束加载。
 *
 * ⚠️ 这里曾经有个「永久卡在生成中」的严重 bug，两个坑都必须防：
 *
 * 1) **`complete === true` 表示加载已经结束**（不管成功还是失败），此时若还去监听
 *    `load` / `error`，就是在等一个**永远不会再触发**的事件 → Promise 永不 resolve。
 *    图片加载失败正是 `complete=true` 且 `naturalWidth === 0` —— 最常见的情形
 *    （外链图片挂掉、MinIO 里对象不存在），所以这条路径必须直接跳过。
 *
 * 2) 极端情况下图片既不 `load` 也不 `error`（TCP 连接挂起），必须有**超时兜底**，
 *    否则整个导出会无限期停住。
 *
 * @returns {Promise<string[]>} 加载失败的图片地址，供上层提示用户
 *   —— 不能让用户拿到一张静默缺图的奖状却毫不知情。
 */
const waitForImages = async (root, timeoutMs = 8000) => {
  const imgs = Array.from(root.querySelectorAll('img'));

  const pending = imgs
    .filter((img) => !img.complete) // 已结束的（含失败）不再等待
    .map(
      (img) =>
        new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }),
    );

  if (pending.length) {
    await Promise.race([Promise.all(pending), sleep(timeoutMs)]);
  }

  return imgs
    .filter((img) => img.complete && img.naturalWidth === 0)
    .map((img) => img.getAttribute('src') || '');
};

/**
 * html-to-image 会自己 fetch 并内联所有图片，遇到跨域或不可达的图片可能**永久挂起**，
 * 因此必须加超时 —— 不然按钮就一直是「生成中…」。
 */
const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(message);
    }),
  ]);

/**
 * 提取可读的错误信息。
 * html-to-image 在图片拉取失败时抛的是 **Event**（不是 Error），没有 message，
 * 直接用 `e.message || e` 只会得到让人摸不着头脑的「[object Event]」。
 */
const describeError = (e) => {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;
  if (e.message) return e.message;
  if (typeof Event !== 'undefined' && e instanceof Event) {
    return `图片资源加载失败（事件类型：${e.type || 'error'}），多半是设计里用了外部链接的图片`;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
};

/**
 * 等待 React 把内容真正挂到离屏容器里。
 * ⚠️ 不能用「等两帧」——React 18 的 createRoot 走 scheduler 的宏任务，
 * 实测 rAF 会先于它执行，导致 firstElementChild 还是 null。轮询最稳。
 */
const waitForNode = async (host, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const node = host.firstElementChild;
    if (node) return node;
    await sleep(30);
  }
  return null;
};

/**
 * 生成 PDF Blob（不触发下载），便于测试与复用（例如将来的批量导出）。
 * @returns {Promise<{blob: Blob, widthMm: number, heightMm: number, failedImages: string[]}>}
 *   `failedImages` 非空表示 PDF 里缺了这些图片 —— 调用方**必须提示用户**，
 *   否则用户会以为导出成功，却拿到一张缺图的奖状。
 */
export async function buildAwardPdf({ layout, data }) {
  const canvas = layout?.canvas || {};
  const widthMm = canvas.w || 297;
  const heightMm = canvas.h || 210;
  const targetPxWidth = Math.round((widthMm / MM_PER_INCH) * EXPORT_DPI);
  const pixelRatio = targetPxWidth / RENDER_CSS_WIDTH;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;background:#ffffff;';
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    root.render(
      React.createElement(AwardRenderer, {
        layout: prepareLayoutForExport(layout),
        data,
        widthPx: RENDER_CSS_WIDTH,
      }),
    );
    const node = await waitForNode(host);
    if (!node) throw new Error('渲染奖状超时（离屏容器未就绪）');

    // 字体：@font-face 用的是 font-display: swap，不等字体就栅格化会拿到回退字体，
    // 导致 PDF 的字形与设计器看到的不一致（见 AGENTS.md §7 第 12 条）。
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, sleep(5000)]);
    }

    const failedImages = await waitForImages(host);

    // ⚠️ 必须把加载失败的 <img> 从 DOM 里摘掉：
    // html-to-image 会逐张 fetch 并内联图片，遇到拉不动的就抛出一个**没有 message 的 Event**，
    // 整个导出会因此失败（用户只能看到「[object Event]」这种莫名其妙的提示）。
    // 摘掉后 PDF 仍能正常生成，只是缺这几张图 —— 再由 failedImages 提示用户去修。
    // 用同尺寸占位 div 顶替，避免其余元素整体位移。
    if (failedImages.length) {
      Array.from(host.querySelectorAll('img')).forEach((img) => {
        if (!img.complete || img.naturalWidth !== 0) return;
        const holder = document.createElement('div');
        holder.style.cssText = `width:${img.clientWidth || 0}px;height:${img.clientHeight || 0}px;`;
        img.replaceWith(holder);
      });
    }

    const pngDataUrl = await withTimeout(
      toPng(node, {
        pixelRatio,
        backgroundColor: '#ffffff',
        cacheBust: false,
        // ★ 必须开启！html-to-image 的资源缓存 key 默认会**剥掉 query string**
        //   （getCacheKey 里 `url.replace(/\?.*/, '')`）。而我们的底图统一走
        //   `/api/media?key=<对象名>`——不同奖状只有 key 这个 query 不同，剥掉后
        //   缓存 key 全都退化成同一个 `/api/media`：**连续导出多份奖状时，第二份
        //   会直接命中第一份的缓存，底图被替换成上一份奖状的图**（2026-09-21
        //   实测复现：先导「测试」再导 M3，M3 的 PDF 里出现「测试」的底图）。
        //   开启后用完整 URL 作缓存 key，互不污染。
        includeQueryParams: true,
      }),
      30000,
      '生成图片超时：奖状里有图片无法访问。外部链接的图片请先上传到本站',
    );

    const pdf = new jsPDF({ unit: 'mm', format: [widthMm, heightMm], orientation: 'landscape' });
    pdf.addImage(pngDataUrl, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST');
    const blob = pdf.output('blob');
    console.info(
      `[award-pdf] 已生成 ${blob.size} 字节，页面 ${pdf.internal.pageSize.getWidth()}x${pdf.internal.pageSize.getHeight()} mm，DPI=${EXPORT_DPI}`,
    );
    return { blob, widthMm, heightMm, failedImages };
  } catch (e) {
    const msg = /tainted|SecurityError/i.test(String(e && e.message))
      ? '底图或图片存在跨域限制，请把图片上传到本站再试'
      : describeError(e);
    throw new Error(`导出失败：${msg}`);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** 生成并触发浏览器下载 */
export async function downloadAwardPdf({ layout, data, filename = 'award.pdf' }) {
  const { blob, failedImages } = await buildAwardPdf({ layout, data });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { blob, failedImages };
}
