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
 * 把「本站对象存储」的图片地址换成**同源代理**地址：`/api/media?key=…`
 *
 * 为什么所有展示位都必须过这一层（不只是导出 PDF 时）：
 *   1) 历史数据里的 bg_url / 图片 src 是 `http://localhost:9000/ham-awards/...` 这种
 *      **绝对地址**（上传接口按 MINIO_PUBLIC_ENDPOINT 拼的）。页面一旦跑在 https 下
 *      （cloudflare 隧道、反代 + TLS），浏览器会按「混合内容」把 http 图片拦掉 →
 *      用户看到的是「提示已设置底图，画布却是空白」，非常容易误判成上传失败。
 *   2) 远程访问时 `localhost` 解析到的是用户自己的机器，压根不是服务器。
 *   同源代理走的是本站域名，既能正常加载，也不会污染 canvas（导出 PDF 不会失败）。
 *
 * 认不出来（不是本站桶、相对路径、data:/blob:）的地址原样返回。
 */
export function toSameOriginMediaUrl(url) {
    if (!url) return url;
    const s = String(url).trim();
    if (!s || /^(data:|blob:)/i.test(s)) return url; // 本地资源 / dataURL
    try {
        const u = new URL(s, window.location.origin);
        if (u.origin === window.location.origin) return url; // 同源（含相对路径）直接用
        const idx = u.pathname.indexOf('/awards/');
        if (idx === -1) return url;
        // ⚠️ URL.pathname **保留 percent-encoding**，直接 encodeURIComponent 会二次编码
        //    （`%C3%A6` → `%25C3%25A6`），服务端拿这个 key 去对象存储里找不到对象 → 404。
        //    先解码还原成真实 key，再统一编码一次。
        let key = u.pathname.slice(idx + 1);
        try {
            key = decodeURIComponent(key);
        } catch {
            // key 里含非法 % 序列，保持原样即可
        }
        return `/api/media?key=${encodeURIComponent(key)}`;
    } catch {
        return url;
    }
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
