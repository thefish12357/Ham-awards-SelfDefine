/**
 * 轻量 Hash 路由
 * ------------------------------------------------------------------
 * 背景：本项目**原本没有路由**。页面切换靠 `App` 组件里的 `view` + `subView`
 * 两个 state 做条件渲染（`src/app.jsx` 尾部），导致刷新一定回到「概览」、
 * 链接无法分享。这里在不引入 react-router 的前提下补上最小可用的 Hash 路由：
 * 让 `subView` 与 `location.hash` 双向同步。
 *
 * 约定：
 *   - Hash 形如 `#/award_audit_list`，名称即 subView 的 id；
 *   - 非法的 hash 一律回落 `DEFAULT_ROUTE`，避免出现"所有条件都不满足"的白屏；
 *   - 角色不可见的页面（例如普通用户访问 `#/admin_audit`）也会被守卫拦回默认页。
 */

export const DEFAULT_ROUTE = 'dashboard';

/** 全部可作为 subView 的路由 id（与 app.jsx 里的菜单 id / 渲染分支一一对应） */
export const ALL_ROUTES = [
  'dashboard',
  'awards',
  'my_awards',
  'logbook',
  'lotw_import',
  'all_logs',
  'award_create',
  'award_drafts',
  'award_returned',
  'award_audit_list',
  'admin_audit',
  'admin_overview',
  'issuanceManager',
  'users',
  'userCenter',
];

const ROUTE_SET = new Set(ALL_ROUTES);

/** 各角色可见的路由（与 app.jsx 的 menu.show 条件保持一致） */
export const ROUTES_BY_ROLE = {
  user: ['dashboard', 'awards', 'my_awards', 'logbook', 'lotw_import', 'all_logs', 'userCenter'],
  award_admin: [
    'dashboard',
    'awards',
    'award_create',
    'award_drafts',
    'award_returned',
    'award_audit_list',
    'userCenter',
  ],
  admin: [
    'dashboard',
    'awards',
    'admin_audit',
    'admin_overview',
    'issuanceManager',
    'users',
    'userCenter',
  ],
};

export const isRouteAllowed = (route, role) => {
  const allowed = ROUTES_BY_ROLE[role] || ROUTES_BY_ROLE.user;
  return allowed.includes(route);
};

/**
 * 公开校验页：#/verify/<序列号>
 * 这条路径**不在** ALL_ROUTES 里，因为它不需要登录、也不属于 subView 体系，
 * 由 `App` 在登录校验之前单独拦截渲染。
 */
export const VERIFY_HASH_RE = /^#\/verify\/(\d{6,32})$/;

export const parseVerifyHash = () => {
  if (typeof window === 'undefined') return null;
  const m = VERIFY_HASH_RE.exec(window.location.hash || '');
  return m ? m[1] : null;
};

/** 是否处于「公开路由」，此时不要用 subView 覆盖 URL */
export const isPublicHashRoute = () => !!parseVerifyHash();

/** 读取当前 URL 中的路由；非法或为空时返回 null */
export const readRoute = () => {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#\/?/, '');
  const name = raw.split(/[?&]/)[0].trim();
  if (!name) return null;
  return ROUTE_SET.has(name) ? name : null;
};

/**
 * 把路由写回 URL。
 * 默认使用 push 语义（`location.hash = ...`），这样浏览器前进/后退可以在
 * 页面间移动；`replace` 为 true 时不产生历史记录。
 */
export const writeRoute = (route, { replace = false } = {}) => {
  if (typeof window === 'undefined' || !ROUTE_SET.has(route)) return;
  const target = `#/${route}`;
  if (window.location.hash === target) return;
  if (replace) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${target}`,
    );
  } else {
    window.location.hash = target;
  }
};
