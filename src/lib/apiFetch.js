/**
 * 统一的后端请求封装
 * ------------------------------------------------------------------
 * 从 `src/app.jsx` 抽出（原第 16–49 行），行为保持一致，仅增强两点：
 *   1. 响应体不是合法 JSON 时不再抛 SyntaxError，而是回落到状态码；
 *   2. 抛出对象的 `message` 一定有值，避免前端 `alert(err.message)` 弹出 "undefined"。
 *
 * 新增代码请不要直接写裸 `fetch('/api/...')`，统一走这里，
 * 否则会漏掉 Authorization / x-2fa-code 注入与 401 自动登出。
 */
export const TOKEN_KEY = 'ham_token';
export const USER_KEY = 'ham_user';
export const TWO_FA_KEY = 'temp_2fa_code';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getStoredUser = () => {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
export const saveSession = (token, user) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
};
export const clearSession = () => localStorage.clear();

// ------------------------------------------------------------------
// 演示环境只读拦截（2026-09-26）
// demoMode 下，任何写操作（POST/PUT/PATCH/DELETE，登录等白名单除外）
// 一律不放行，并跳转到主站登录页，避免演示实例被写入真实数据。
// 由 app.jsx 在拿到 /api/system-status 的 demoMode/demoUrl 后调用 configureDemo。
// ------------------------------------------------------------------
let _demoMode = false;
let _demoRedirect = '';
export function configureDemo(mode, mainUrl) {
  _demoMode = !!mode;
  _demoRedirect = mainUrl || '';
}
export function isDemoMode() {
  return _demoMode;
}
export function getDemoRedirectUrl() {
  if (_demoRedirect) return _demoRedirect;
  // 兜底：演示站本身不回传主站地址，按当前域名去掉 demo. 前缀推导主站
  try {
    const host = window.location.host;
    const mainHost = host.startsWith('demo.') ? host.slice('demo.'.length) : host;
    return `${window.location.protocol}//${mainHost}`;
  } catch {
    return 'https://hamglory.top';
  }
}
// 演示环境仍允许的操作：登录/注册、OAuth、安装、已读标记（均为读性质或演示自身所需）
const DEMO_SAFE = [/^\/api\/auth\//, /^\/api\/install/, /^\/api\/notifications\/read/];
const _isMutation = (m) => m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';

/** 组装请求头：JSON Content-Type + Authorization + 一次性 2FA 码 */
const buildHeaders = (options = {}) => {
  const headers = { ...(options.headers || {}) };

  // 仅在有 body 且非 FormData 时添加 JSON Content-Type
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // 2FA 验证码是一次性的：带上后立即从 sessionStorage 移除
  const twoFaCode = sessionStorage.getItem(TWO_FA_KEY);
  if (twoFaCode) {
    headers['x-2fa-code'] = twoFaCode;
    sessionStorage.removeItem(TWO_FA_KEY);
  }

  return headers;
};

// ⚠️ 只有「确实是本站登录态出问题」时才自动登出。
// 上游原实现把**所有** 401 都当成掉线，导致这些正常业务错误会把用户莫名其妙踢出去：
//   - `/api/user/password` 旧密码错误 → 401 {error:'旧密码错误'}
//   - `requirePassword` 密码确认失败 → 401 {error:'PASSWORD_INVALID'}
//   - `/api/user/2fa/disable` 密码错误 → 401 {error:'密码错误'}
// 因此按错误码判定；没有响应体时（如代理返回的裸 401）仍按掉线处理。
const TOKEN_ERRORS = ['TOKEN_MISSING', 'TOKEN_INVALID'];
const logoutIfAuthProblem = (res, data) => {
  if (!(res.status === 401 && (!data || TOKEN_ERRORS.includes(data.error)))) return false;
  console.warn('Token expired or invalid. Logging out...');
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.reload();
  return true;
};

export const apiFetch = async (endpoint, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  // 演示环境：写操作全部跳转到主站登录页（数据只读，绝不落到演示库）
  if (_demoMode && _isMutation(method) && !DEMO_SAFE.some((re) => re.test(`/api${endpoint}`))) {
    window.location.href = getDemoRedirectUrl();
    return new Promise(() => {});
  }

  const res = await fetch(`/api${endpoint}`, { ...options, headers: buildHeaders(options) });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (logoutIfAuthProblem(res, data)) {
    throw { status: 401, message: '登录已过期，正在跳转...' };
  }

  if (!res.ok) {
    const body = data || {};
    throw {
      status: res.status,
      ...body,
      message: body.message || body.error || `请求失败 (HTTP ${res.status})`,
    };
  }
  return data;
};

/**
 * 取二进制内容（目前用于实物材料照片）。
 * ------------------------------------------------------------------
 * 为什么需要它：这类资源放在**私有桶**，必须带 Authorization 才能取；而 `<img src>`
 * 无法自定义请求头。旧实现返回 MinIO **预签名直链**，但直链 host 是
 * `MINIO_PUBLIC_ENDPOINT`（本部署里是 `localhost:9000`）：
 *   - 页面走 https（cloudflared 隧道）时会被浏览器按**混合内容**拦掉；
 *   - 管理员在别的机器上时，`localhost` 指向管理员自己的电脑。
 * 结果：审核页明明有待审材料，照片位置只显示「图片不可用（可能已删除）」（2026-09-24 用户实测）。
 * 改为同源鉴权代理 `GET /api/evidence/:id/photo`，在这里转成 blob URL 交给 <img>。
 *
 * 鉴权头与 401 处理与 apiFetch 完全一致（复用 buildHeaders / logoutIfAuthProblem）。
 */
export const apiFetchBlob = async (endpoint, options = {}) => {
  const res = await fetch(`/api${endpoint}`, { ...options, headers: buildHeaders(options) });

  if (logoutIfAuthProblem(res, null)) {
    throw { status: 401, message: '登录已过期，正在跳转...' };
  }
  if (!res.ok) {
    let msg = `资源加载失败 (HTTP ${res.status})`;
    try {
      const body = await res.json();
      if (body && body.message) msg = body.message;
    } catch {
      /* 二进制响应解析失败就用默认文案 */
    }
    throw { status: res.status, message: msg };
  }
  return res.blob();
};

export default apiFetch;
