/**
 * HamCQ OAuth2 登录（M5）
 * ------------------------------------------------------------------
 * 让用户用 HamCQ 论坛账号登录本站。做成**可配置的通用 OAuth2 客户端**，
 * 不硬编码 HamCQ —— 三个端点、字段映射、scope 全部来自 `config.json` 的 `oauth` 段。
 *
 * 关键安全点：
 *   1. **一次性 state** 防 CSRF（内存 Map，TTL 10 分钟，用后即删）；
 *   2. `client_secret` 只在服务端出现，永不进前端 / 仓库；
 *   3. `redirect_uri` 严格使用配置值，不做任何动态拼接；
 *   4. **同名账号冒名接管防护**：HamCQ 的 `username` 就是呼号，而本站
 *      `users.callsign` 是唯一键。因此首次 OAuth 登录若发现同名账号已存在，
 *      **绝不自动合并**，必须先让用户输入该账号的本站密码完成绑定；
 *   5. `oauth_sub` 用 HamCQ 的 **`id`**（稳定），不用 `username`（呼号会变）。
 *
 * HamCQ 的非标约定（实测/官方帖确认）：
 *   - token 端点收 **form-urlencoded**（非 JSON）；
 *   - userinfo 端点的 access_token 走 **query 参数**（非 Authorization 头）；
 *   - 无独立 callsign 字段，`username` 即呼号；scope 用 `user.read`；
 *   - 参数表无 PKCE（code_challenge/code_verifier），故默认关闭。
 *
 * 路由通过工厂函数注入依赖，避免与 server.js 循环 import。
 */
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
// 内测门禁：OAuth 首次建号也要邀请码，否则会绕过注册关（绑定已有账号不需要）
import { consumeInviteCode, inviteError, isInviteRequired } from '../services/invites.js';
import { createTtlStore } from '../services/sessionStore.js';

const STATE_TTL_MS = 10 * 60 * 1000;

/** 从配置里读 oauth 段，套一层默认值 */
const oauthConfig = (getConfig) => {
  const c = (getConfig && getConfig().oauth) || {};
  return {
    enabled: c.enabled === true,
    provider: c.provider || 'hamcq',
    label: c.label || '使用 HamCQ 登录',
    clientId: c.clientId || '',
    clientSecret: c.clientSecret || '',
    authorizeUrl: c.authorizeUrl || '',
    tokenUrl: c.tokenUrl || '',
    userInfoUrl: c.userInfoUrl || '',
    scope: c.scope || 'user.read',
    callsignField: c.callsignField || 'username',
    userSubField: c.userSubField || 'id',
    redirectUri: c.redirectUri || '',
    tokenRequestFormat: c.tokenRequestFormat || 'form',
  };
};

/** 前端首页 origin：从 redirectUri 推导（本机 http://localhost:9993） */
const frontendOrigin = (cfg) => {
  try {
    return new URL(cfg.redirectUri).origin;
  } catch {
    return '';
  }
};

const publicUser = (u) => ({
  id: u.id,
  callsign: u.callsign,
  role: u.role,
  has2fa: !!u.totp_secret,
});

export function createOauthRouter({ getDbPool, getConfig, logAudit }) {
  const router = express.Router();
  const db = () => getDbPool();
  // 审计由 server.js 注入；未注入时静默跳过（best-effort）
  const audit = (req, entry) => (typeof logAudit === 'function' ? logAudit(db(), req, entry) : Promise.resolve());

  // 一次性 state / 待绑定 / 一次性换码：用统一 TTL 存储。
  // 配了 REDIS_URL 时走 Redis（多实例共享），否则内存回退（单实例 / 本地开发）。
  const states = createTtlStore('oauth:state'); // state -> true（一次性，TTL 10 分钟）
  const pendingBinds = createTtlStore('oauth:bind'); // bindToken -> { expiresAt, provider, sub, username, profile }
  const sessionCodes = createTtlStore('oauth:code'); // code -> { userId, exp }（短时效，防长期 JWT 进 URL）

  const signToken = (user) =>
    jwt.sign({ id: user.id, role: user.role, callsign: user.callsign, tv: user.token_version ?? 0 }, getConfig().jwtSecret, { expiresIn: '24h' });

  // ---- 前端查询：当前启用的 OAuth 提供方（登录页据此渲染按钮）----
  router.get('/providers', (req, res) => {
    const cfg = oauthConfig(getConfig);
    if (!cfg.enabled || !cfg.clientId) return res.json({ providers: [] });
    res.json({ providers: [{ id: cfg.provider, label: cfg.label }] });
  });

  // ---- 发起授权：生成 state，302 到 HamCQ 授权页 ----
  router.get('/start', async (req, res) => {
    const cfg = oauthConfig(getConfig);
    if (!cfg.enabled || !cfg.clientId) {
      return res.status(503).send('OAuth 登录未启用');
    }
    const state = crypto.randomBytes(16).toString('hex');
    await states.set(state, true, STATE_TTL_MS); // TTL 自动过期，无需手动清理

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: 'code',
      redirect_uri: cfg.redirectUri,
      scope: cfg.scope,
      state,
    });
    res.redirect(`${cfg.authorizeUrl}?${params.toString()}`);
  });

  // ---- 授权回调：换 token → 取 userinfo → 登录 / 要求绑定 ----
  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send('授权被取消或失败');
    if (!code || !state) return res.status(400).send('缺少 code 或 state');

    const stateOk = await states.get(state);
    if (!stateOk) return res.status(400).send('state 无效或已过期');
    await states.del(state); // 一次性消费

    const cfg = oauthConfig(getConfig);
    try {
      // 1) 换 access_token（form-urlencoded，client_secret 只在服务端）
      const tokenBody = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
      });
      const tokenRes = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
        // 防止 HamCQ 卡住时我们的回调页无限转圈（无超时 = 浏览器一直等）
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenRes.ok) {
        const t = await tokenRes.text().catch(() => '');
        throw new Error(`换令牌失败（${tokenRes.status}）${t.slice(0, 120)}`);
      }
      const tokens = await tokenRes.json();
      const accessToken = tokens.access_token;
      if (!accessToken) throw new Error('授权服务器未返回 access_token');

      // 2) 取用户信息（HamCQ：token 走 query）
      const uiRes = await fetch(`${cfg.userInfoUrl}?access_token=${encodeURIComponent(accessToken)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!uiRes.ok) throw new Error(`获取用户信息失败（${uiRes.status}）`);
      const profile = await uiRes.json();

      const callsign = String(profile[cfg.callsignField] || '').trim().toUpperCase();
      const sub = String(profile[cfg.userSubField] ?? profile.id ?? '').trim();
      if (!callsign || !sub) throw new Error('未能从授权服务器获取呼号 / 用户 ID');

      // 3) 已绑定过 → 直接登录
      const bound = await db().query('SELECT * FROM users WHERE oauth_provider=$1 AND oauth_sub=$2', [cfg.provider, sub]);
      if (bound.rows.length > 0) {
        const u = bound.rows[0];
        // 安全加固（审计整改）：不直接把长期 JWT 放进 URL（会进浏览器历史/扩展/截图）。
        // 改为签发一次性短时效换码，前端再 POST /code 换取 JWT。
        const oauthCode = crypto.randomBytes(16).toString('hex');
        await sessionCodes.set(oauthCode, { userId: u.id, exp: Date.now() + 60_000 }, 60_000);
        return res.redirect(`${frontendOrigin(cfg)}/#/oauth/code?code=${oauthCode}`);
      }

      // 4) 未绑定 → 跳「补全信息」页，由用户确认呼号。
      // ★ 不能直接拿 HamCQ 的 username 当呼号：实测存在昵称型用户名（如 "YofoaStudio"）。
      //   因此无论本站是否已有同名账号，都让用户输入/确认呼号，再决定
      //   「绑定已有账号（需密码，防冒名接管）」还是「创建新账号」。
      const pendingToken = crypto.randomBytes(16).toString('hex');
      await pendingBinds.set(pendingToken, {
        expiresAt: Date.now() + STATE_TTL_MS,
        provider: cfg.provider,
        sub,
        username: callsign, // HamCQ 用户名，仅作输入框预填
        profile,
      }, STATE_TTL_MS);
      return res.redirect(
        `${frontendOrigin(cfg)}/#/oauth/complete?pending_token=${pendingToken}&username=${encodeURIComponent(callsign)}`,
      );
    } catch (e) {
      console.error('oauth callback error:', e);
      res.status(500).send(`登录失败：${e.message}`);
    }
  });

  // ---- 补全信息：确认呼号 → 绑定已有账号（需密码）或创建新账号 ----
  router.post('/complete', async (req, res) => {
    const { pending_token: pendingToken, callsign, password, invite_code: inviteCode } = req.body || {};
    if (!pendingToken) return res.status(400).json({ error: 'BAD_REQUEST', message: '缺少参数' });
    const pending = await pendingBinds.get(pendingToken);
    if (!pending || pending.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'BIND_EXPIRED', message: '会话已过期，请重新登录' });
    }

    // 呼号规范化与格式校验（宽松：2-20 位字母数字）
    const cs = String(callsign || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,20}$/.test(cs)) {
      return res.status(400).json({ error: 'INVALID_CALLSIGN', message: '呼号格式不正确（2-20 位字母数字）' });
    }

    const existing = await db().query('SELECT * FROM users WHERE callsign=$1', [cs]);
    if (existing.rows.length > 0) {
      // 呼号已注册 → 必须验证本站密码才允许绑定（防冒名接管）
      const u = existing.rows[0];
      if (!u.password_hash) {
        return res.status(400).json({ error: 'NO_PASSWORD', message: '该账号没有设置密码，无法绑定，请联系管理员' });
      }
      if (!password) {
        return res.status(400).json({ error: 'NEED_PASSWORD', message: '该呼号已注册，请输入该账号的本站密码完成绑定' });
      }
      const ok = await bcrypt.compare(password, u.password_hash);
      if (!ok) return res.status(401).json({ error: 'AUTH_FAILED', message: '密码错误，绑定失败' });

      await db().query('UPDATE users SET oauth_provider=$1, oauth_sub=$2, oauth_raw=$3 WHERE id=$4', [
        pending.provider,
        pending.sub,
        JSON.stringify(pending.profile),
        u.id,
      ]);
      await pendingBinds.del(pendingToken);
      return res.json({ token: signToken(u), user: publicUser(u) });
    }

    // 新账号：呼号用用户输入的值；填了密码就一并设置（以后也能密码登录）
    // ★ 内测门禁（默认关闭）：新建账号需要邀请码；「绑定已有账号」在上面就返回了，不受影响
    let usedCode = null;
    if (isInviteRequired(getConfig())) {
      const check = await consumeInviteCode(db(), inviteCode);
      if (!check.ok) {
        const { status, body } = inviteError(check.reason, 'oauth');
        return res.status(status).json(body);
      }
      usedCode = check.code;
    }

    const hash = password ? await bcrypt.hash(password, 10) : null;
    const created = await db().query(
      `INSERT INTO users (callsign, password_hash, role, oauth_provider, oauth_sub, oauth_raw, invite_code)
       VALUES ($1, $2, 'user', $3, $4, $5, $6) RETURNING *`,
      [cs, hash, pending.provider, pending.sub, JSON.stringify(pending.profile), usedCode],
    );
    await pendingBinds.del(pendingToken);
    const u = created.rows[0];
    await audit(req, { action: 'auth.register', targetType: 'user', targetId: u.id, detail: { callsign: u.callsign, channel: 'hamcq', invite_code: usedCode || undefined } });
    if (usedCode) {
      await audit(req, { action: 'invite.use', targetType: 'invite', targetId: usedCode, detail: { callsign: u.callsign, channel: 'hamcq' } });
    }
    return res.json({ token: signToken(u), user: publicUser(u) });
  });

  // ---- 一次性换码：前端拿 URL 里的 code 来换 JWT（code 不长期留在 URL/历史里）----
  router.post('/code', async (req, res) => {
    const { code } = (req.body || {});
    if (!code) return res.status(400).json({ error: 'BAD_REQUEST', message: '缺少换码' });
    const entry = await sessionCodes.get(code);
    if (!entry || entry.exp < Date.now()) {
      await sessionCodes.del(code);
      return res.status(401).json({ error: 'CODE_INVALID', message: '登录码无效或已过期，请重新登录' });
    }
    await sessionCodes.del(code); // 一次性消费
    try {
      const r = await db().query('SELECT * FROM users WHERE id=$1', [entry.userId]);
      const u = r.rows[0];
      if (!u) return res.status(401).json({ error: 'USER_NOT_FOUND', message: '账号不存在' });
      if (u.status === 'disabled') return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: '账号已被禁用' });
      res.json({ token: signToken(u), user: publicUser(u) });
    } catch (e) {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  return router;
}
