/**
 * 离线回归自测：OAuth 的 2FA 强制 + 回调不再 TDZ 崩溃
 * ------------------------------------------------------------------
 * 背景：2026-09-30 安全审计发现两条高危 ——
 *   ① OAuth 的 `/complete`（验密绑定）与 `/code`（换登录）两条出 JWT 的路径**都没校验 totp_secret**，
 *      启用 2FA 的账号走一遍 HamCQ 授权就能跳过验证码；
 *   ② 回调里的日志断点在 `const email` 声明前引用了它（暂时性死区）→ 回调必然 500。
 *
 * 本脚本把「对 HamCQ 的两次出网请求」与数据库换成桩，其余走**真实路由、真实逻辑**，
 * 因此能端到端复现并锁死上面两个问题（项目暂无其它测试设施）。
 *
 * 运行：node scripts/selftest-oauth-2fa.mjs     （全部通过退出码 0，有失败退出码 1）
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import otplib from 'otplib';
import { createOauthRouter } from '../server/routes/oauth.js';

const SECRET = otplib.authenticator.generateSecret();
const PASS = 'correct-horse-battery';
const HASH = bcrypt.hashSync(PASS, 4);

const realFetch = globalThis.fetch;

// ---- 假 DB ----
const boundUser = { id: 42, callsign: 'BH7CSA', role: 'admin', totp_secret: SECRET, token_version: 0, status: 'active', email: null, password_hash: null };
const existingUser = { ...boundUser, id: 43, password_hash: HASH };
let mode = 'bound'; // 'bound'（已绑定过）| 'unbound'（未绑定，走补全信息页）
const dbPool = {
  query: async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (/^SELECT \* FROM users WHERE oauth_provider=/.test(s)) return { rows: mode === 'bound' ? [boundUser] : [] };
    if (/^SELECT \* FROM users WHERE callsign=/.test(s)) return { rows: mode === 'unbound' ? [existingUser] : [] };
    if (/^SELECT \* FROM users WHERE id=/.test(s)) return { rows: [boundUser] };
    return { rows: [] };
  },
};

// ---- 桩掉对 HamCQ 的出网（换令牌 / 取用户信息）----
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at-stub' }) };
  if (u.includes('/user')) return { ok: true, status: 200, json: async () => ({ id: 42, username: 'BH7CSA', email: null }) };
  return { ok: false, status: 404, text: async () => 'not stubbed', json: async () => ({}) };
};

const config = {
  jwtSecret: 'test-secret',
  oauth: {
    enabled: true, provider: 'hamcq', clientId: 'cid', clientSecret: 'sec',
    authorizeUrl: 'https://stub/authorize', tokenUrl: 'https://stub/token', userInfoUrl: 'https://stub/user',
    redirectUri: 'http://localhost:9993/api/auth/oauth/callback',
    callsignField: 'username', userSubField: 'id', emailField: 'email',
  },
};

const app = express();
app.use(express.json());
app.use('/api/auth/oauth', createOauthRouter({ getDbPool: () => dbPool, getConfig: () => config, logAudit: async () => {} }));
// ⚠️ 不要用 listen(0)：系统随机端口可能落在 fetch 规范的「禁止端口」里（如 1719/1720），
//    会让请求直接报 `bad port`。这里固定取一个安全区间内的随机端口。
const PORT = 41000 + Math.floor(Math.random() * 8000);
const server = app.listen(PORT);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${PORT}`;

const post = async (path, body) => {
  const r = await realFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { /* 可能不是 JSON */ }
  return { status: r.status, json };
};
/** 走一遍 /start → /callback，返回后端 302 的落点（不跟随跳转） */
const runCallback = async () => {
  const start = await realFetch(base + '/api/auth/oauth/start', { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cb = await realFetch(`${base}/api/auth/oauth/callback?code=stub-code&state=${state}`, { redirect: 'manual' });
  return { status: cb.status, location: cb.headers.get('location') || '' };
};
const paramsOf = (loc) => new URLSearchParams(String(loc).split('?')[1] || '');
const totp = () => otplib.authenticator.generate(SECRET);

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  → ${extra}` : ''}`);

// ===== A. 已绑定账号：/callback → /code =====
mode = 'bound';
const a = await runCallback();
check('A1 /callback 正常跳换码页（日志断点 TDZ 已修，不再 500）', a.status === 302 && a.location.includes('#/oauth/code?code='), `status=${a.status}`);
const codeA = paramsOf(a.location).get('code');

const no2fa = await post('/api/auth/oauth/code', { code: codeA });
check('A2 有 2FA 却不带验证码 → 403 2FA_REQUIRED', no2fa.status === 403 && no2fa.json?.error === '2FA_REQUIRED', JSON.stringify(no2fa.json));

const bad = await post('/api/auth/oauth/code', { code: codeA, totp_code: '000000' });
check('A3 验证码错误 → 403 INVALID_2FA', bad.status === 403 && bad.json?.error === 'INVALID_2FA', JSON.stringify(bad.json));

const good = await post('/api/auth/oauth/code', { code: codeA, totp_code: totp() });
check('A4 失败后换码未被消费，带正确验证码可登录', good.status === 200 && !!good.json?.token, `status=${good.status} token=${good.json?.token ? '有' : '无'}`);

const reuse = await post('/api/auth/oauth/code', { code: codeA, totp_code: totp() });
check('A5 换码一次性：通过后不可复用', reuse.status === 401 && reuse.json?.error === 'CODE_INVALID', JSON.stringify(reuse.json));

// ===== B. 未绑定 → 验密绑定：/complete =====
mode = 'unbound';
const b = await runCallback();
check('B1 /callback 跳补全信息页', b.status === 302 && b.location.includes('#/oauth/complete?pending_token='), `status=${b.status}`);
const pt = paramsOf(b.location).get('pending_token');

const bindNo2fa = await post('/api/auth/oauth/complete', { pending_token: pt, callsign: 'BH7CSA', password: PASS });
check('B2 绑定已有账号（有 2FA）不带验证码 → 403 2FA_REQUIRED', bindNo2fa.status === 403 && bindNo2fa.json?.error === '2FA_REQUIRED', JSON.stringify(bindNo2fa.json));

const bindBad = await post('/api/auth/oauth/complete', { pending_token: pt, callsign: 'BH7CSA', password: PASS, totp_code: '000000' });
check('B3 验证码错误 → 403 INVALID_2FA', bindBad.status === 403 && bindBad.json?.error === 'INVALID_2FA', JSON.stringify(bindBad.json));

const bindOk = await post('/api/auth/oauth/complete', { pending_token: pt, callsign: 'BH7CSA', password: PASS, totp_code: totp() });
check('B4 带正确验证码可完成绑定并拿到 JWT', bindOk.status === 200 && !!bindOk.json?.token, `status=${bindOk.status}`);

// ===== C. 未启用 2FA 的账号不受影响（回归） =====
boundUser.totp_secret = null;
mode = 'bound';
const c = await runCallback();
const cLogin = await post('/api/auth/oauth/code', { code: paramsOf(c.location).get('code') });
check('C1 未启用 2FA 仍可一步登录（无回归）', cLogin.status === 200 && !!cLogin.json?.token, `status=${cLogin.status}`);

console.log(`\n${results.join('\n')}\n`);
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(failed === 0 ? `全部 ${results.length} 项通过 ✅` : `有 ${failed} 项失败 ❌`);
server.close();
process.exit(failed === 0 ? 0 : 1);
