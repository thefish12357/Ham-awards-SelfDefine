/**
 * 按需加载（动态 import）失败的自愈（2026-09-24）
 * ------------------------------------------------------------------
 * 现象：部署新版本后，**旧页面标签**里点击「下载效果 PDF / 预览」会弹出
 *   `Failed to fetch dynamically imported module: …/assets/exportAwardPdf-<旧 hash>.js`
 *
 * 原因：Vite 会把按需加载的模块切成带**内容 hash** 的独立 chunk（如 `exportAwardPdf-87692641.js`）。
 * 重新构建后旧 hash 文件被删掉，而**还开着的旧页面**（内存里跑的是旧主包）仍然会去请求它 → 404。
 * 这不是缓存问题，而是"页面版本已经过期"，重载页面即可恢复。
 *
 * 处理策略：识别这类错误 → **自动刷新一次**（用 sessionStorage 记录时间戳防止无限刷新循环，
 * 例如服务器真的挂了 / 资源真的缺失时不能在刷新里死循环）；若 15 秒内已经刷过一次，
 * 就抛出人话错误让调用方提示用户手动刷新。
 */

const RELOAD_FLAG = 'ham_chunk_reload_at';

/** 判断是否为「chunk 已被新版本替换」类错误 */
export const isChunkLoadError = (err) => {
  const msg = String((err && (err.message || err)) || '');
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
};

/**
 * 尝试自动刷新一次以拿到新版本页面。
 * @returns {boolean} true = 已触发刷新（调用方不要再走"失败"分支）
 */
export const reloadForNewVersion = () => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    // 15 秒内已经自动刷过一次 → 不再刷，避免死循环（说明不是版本问题）
    if (Date.now() - last < 15000) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch (e) {
    // sessionStorage 不可用（隐私模式等）：仍然刷新一次，但无法防循环
  }
  window.location.reload();
  return true;
};

/**
 * 带自愈的按需加载。
 * @param {() => Promise<any>} loader 形如 `() => import('./x.js')`
 * @param {{label?:string}} [opts] label 用于错误文案，如「PDF 导出模块」
 */
export async function importWithRetry(loader, opts = {}) {
  const { label = '页面功能' } = opts;
  try {
    return await loader();
  } catch (err) {
    if (!isChunkLoadError(err)) throw err;
    if (reloadForNewVersion()) {
      // 正在刷新，返回一个永不 settle 的 Promise：避免调用方在刷新前闪一下"失败"提示
      return new Promise(() => {});
    }
    throw new Error(`${label}加载失败：当前页面是旧版本（网站已更新）。请按 Ctrl+F5 强制刷新后重试。`);
  }
}
