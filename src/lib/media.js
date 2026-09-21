/**
 * 图片 URL 归属判断。
 *
 * 为什么需要区分「外站」：外站图片（图床、网盘链接）在导出 PDF 时会
 *   1) 跨域污染 canvas → 栅格化直接抛 SecurityError / 缺图；
 *   2) 随时可能失效（对方删图、改防盗链），用户最终拿到的是缺图奖状。
 * 因此在设计器**保存前**要检测并提示。
 *
 * 视为「安全」的图片地址只有两类：
 *   - 同源地址（相对路径、`/api/media` 代理、本站域名）
 *   - 本站对象存储（MinIO 桶，路径含 `/ham-awards/`）
 */

export function isExternalImageUrl(url) {
    if (!url) return false;
    const s = String(url).trim();
    if (!s || /^(data:|blob:)/i.test(s)) return false; // 本地资源 / dataURL
    let u;
    try {
        u = new URL(s, window.location.origin);
    } catch {
        return true; // 无法解析的绝对地址，按外站处理
    }
    if (u.origin === window.location.origin) return false; // 同源
    if (u.pathname.includes('/ham-awards/')) return false; // 本站 MinIO 桶
    return true;
}

/**
 * 收集布局里所有「外站图片」URL（底图 + 图片元素），去重后返回。
 * @param {object} layout v2 布局
 * @returns {string[]}
 */
export function collectExternalImages(layout) {
    const found = [];
    const push = (u) => {
        if (isExternalImageUrl(u) && !found.includes(u)) found.push(u);
    };
    if (layout && layout.canvas && layout.canvas.bgUrl) push(layout.canvas.bgUrl);
    (layout && layout.elements ? layout.elements : []).forEach((el) => {
        if (el && el.type === 'image' && el.src) push(el.src);
    });
    return found;
}
