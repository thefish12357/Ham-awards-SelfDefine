/**
 * 「内测已结束 · 静态演示」模式（无服务器过渡形态）
 * ==================================================================
 * 背景（2026-10-07 用户拍板）
 *   暂时**没有服务器** → 公网（Cloudflare）上**只放静态演示**：
 *   `hamglory.top` 只展示「落地页 + 演示奖状弹窗」（纯前端数据，不需要 API），
 *   其余一切功能入口（登录 / 注册 / 校验页 / 邮件页 …）**一律跳 `/closed`**
 *   —— 也就是 `cloudflare/closed-notice.worker.js` 那份「内测已结束」说明页。
 *   等以后有了服务器，再把 Cloudflare 接回源站即可（删 Route / 恢复 tunnel）。
 *
 * 怎么判定
 *   不依赖构建期注入，而是**从 API 响应推断**：Worker 对 `/api/*` 统一回
 *   `503 {"error":"SERVICE_CLOSED"}`（见 `cloudflare/static-demo.worker.js`），
 *   `apiFetch` 会把它抛成 `{ status:503, error:'SERVICE_CLOSED', message }`，
 *   前端据此进入停站模式。
 *   ⇒ 好处：**静态资源请求完全不经过 Worker**（Cloudflare 上免费且不限量），
 *     Worker 也不必改写 HTML，部署面最小。
 *   ⇒ 注意：本模块只在**接口不可用**时生效；本机 `node server.js`（9993）一切照旧。
 *
 * 本模块是这套规则的**唯一真源**：App 的启动回落、落地页 CTA、hash 白名单都在这里。
 */

/** 「内测已结束」说明页路径（由 `cloudflare/static-demo.worker.js` 提供） */
export const CLOSED_PATH = '/closed';

/**
 * 停站期间**仍允许停留**的 hash 路由（其余 `#/…` 一律跳说明页）。
 * 这 5 个是纯静态公开页，不依赖任何 API，留着反而比"一片 404"更友好。
 */
const CLOSED_ALLOWED_ROUTES = new Set([
  '#/about',
  '#/privacy',
  '#/terms',
  '#/protocol',
  '#/contact',
]);

/**
 * 当前 hash 是否允许在停站状态下停留。
 * - 页内锚点（`#features` / `#workflow` / `#about`）→ **放行**（落地页导航用的就是它们）
 * - 白名单里的公开静态页 → 放行
 * - 其它 `#/…`（`#/auth`、`#/verify/<serial>`、`#/verify-email`、`#/oauth/*` …）→ 不放行
 */
export function isHashAllowedWhenClosed(rawHash) {
  const hash = String(rawHash || '');
  if (!hash.startsWith('#/')) return true; // 不是路由，是页内锚点
  const route = hash.split('?')[0].replace(/\/+$/, '');
  return CLOSED_ALLOWED_ROUTES.has(route);
}

/** 跳转到「内测已结束」说明页（用 replace，避免用户后退又弹回来） */
export function goClosedNotice() {
  window.location.replace(CLOSED_PATH);
}

/** 判断 `apiFetch` 抛出的错误是否为「站点已停（内测已结束）」 */
export function isServiceClosedError(err) {
  return !!err && err.error === 'SERVICE_CLOSED';
}
