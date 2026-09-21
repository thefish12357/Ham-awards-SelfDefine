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

export const apiFetch = async (endpoint, options = {}) => {
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

  const res = await fetch(`/api${endpoint}`, { ...options, headers });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  // ⚠️ 只有「确实是本站登录态出问题」时才自动登出。
  // 上游原实现把**所有** 401 都当成掉线，导致这些正常业务错误会把用户莫名其妙踢出去：
  //   - `/api/user/password` 旧密码错误 → 401 {error:'旧密码错误'}
  //   - `requirePassword` 密码确认失败 → 401 {error:'PASSWORD_INVALID'}
  //   - `/api/user/2fa/disable` 密码错误 → 401 {error:'密码错误'}
  // 因此这里改成按错误码判定；没有响应体时（如代理返回的裸 401）仍按掉线处理。
  const TOKEN_ERRORS = ['TOKEN_MISSING', 'TOKEN_INVALID'];
  const tokenProblem = res.status === 401 && (!data || TOKEN_ERRORS.includes(data.error));

  if (tokenProblem) {
    console.warn('Token expired or invalid. Logging out...');
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.reload();
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

export default apiFetch;
