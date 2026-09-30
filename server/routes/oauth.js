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
// 2FA：与密码登录共用同一个 otplib 实例（server.js 已设 window:1；ESM 单例，这里拿到同一份配置）
import otplib from 'otplib';
// 内测门禁：OAuth 首次建号也要邀请码，否则会绕过注册关（绑定已有账号不需要）
import { consumeInviteCode, inviteError, isInviteRequired } from '../services/invites.js';
import { createTtlStore } from '../services/sessionStore.js';
// 邮箱规范化/校验：与注册接口共用同一套规则
import { normalizeEmail, isEmailTaken } from '../services/email.js';

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
    // 邮箱字段名（HamCQ 实测返回 `email`；换提供方可用 config 的 oauth.emailField 覆盖）
    emailField: c.emailField || 'email',
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
  email: u.email || null,
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

  /**
   * 2FA 强制校验（2026-09-30 安全整改）
   * ------------------------------------------------------------------
   * 原漏洞：密码登录会强制校验 `totp_secret`（见 server.js `/api/auth/login`），
   * 但 OAuth 的两条出 JWT 的路径（`/complete` 绑定已有账号、`/code` 换登录）**都没查** ——
   * 于是**启用了 2FA 的账号只要走一遍 HamCQ 授权就能跳过验证码**，等于 2FA 形同虚设。
   *
   * 现在两条路径都必须带上 `totp_code`。返回 null = 通过；否则把 { status, body } 原样回给前端。
   * ⚠️ 校验失败时调用方**绝不能消费** pendingToken / 一次性换码，否则用户没有机会补验证码重试。
   */
  const TOTP_MAX_FAILS = 5;
  const verifyTotp = (user, provided) => {
    if (!user?.totp_secret) return null; // 未启用 2FA → 不拦
    const code = String(provided || '').trim();
    if (!code) return { status: 403, body: { error: '2FA_REQUIRED', message: '该账号已启用两步验证，请输入动态验证码' } };
    if (!otplib.authenticator.check(code, user.totp_secret)) {
      return { status: 403, body: { error: 'INVALID_2FA', message: '两步验证码无效' } };
    }
    return null;
  };

  /**
   * 强制邮箱验证门槛（与密码登录 /api/auth/login 的 EMAIL_NOT_VERIFIED 对齐，2026-09-30 审计整改）
   * ------------------------------------------------------------------
   * 原漏洞：密码登录会拒绝 `email_verified=false` 的账号，但 OAuth 的两条出 JWT 路径
   * （/complete 绑定已有账号、/code 换登录）**都没查**，于是未验证邮箱的账号只要走一遍
   * HamCQ 授权就能拿到 JWT、使用站内功能 —— 等于绕过了登录策略。
   *
   * 这里统一复用同一套判定：返回 null = 放行；否则把 { status, body } 原样回给前端
   * （含 email 字段，方便前端弹出「重发验证邮件」入口，与密码登录体验一致）。
   * 新建 OAuth 账号一律把 email_verified 置 TRUE（邮箱由受信 IdP HamCQ 提供并认证，
   * 视为已验证），因此新号不会被此门槛卡住；存量未验证账号（无论密码还是 OAuth 绑定）
   * 一律按同一规则拦截。
   */
  const verifyEmailGate = async (req, user) => {
    if (user.email_verified === false) {
      await audit(req, {
        action: 'auth.login_blocked',
        targetType: 'user',
        targetId: user.id,
        detail: { callsign: user.callsign, reason: 'EMAIL_NOT_VERIFIED', channel: 'hamcq' },
      });
      return {
        status: 403,
        body: {
          error: 'EMAIL_NOT_VERIFIED',
          message: '邮箱尚未验证：请到注册时填写的邮箱里点验证链接',
          email: user.email || null,
        },
      };
    }
    return null;
  };

  /**
   * 记一次 2FA 失败。超过上限直接作废本次会话 ——
   * 否则在「换码 60s / 待绑定 10min」这个窗口里可以反复试 6 位验证码。
   */
  const bumpTotpFails = async (store, key, entry) => {
    const fails = (entry?.tfaFails || 0) + 1;
    if (fails >= TOTP_MAX_FAILS) {
      await store.del(key);
      return fails;
    }
    const exp = entry?.exp || entry?.expiresAt || 0;
    await store.set(key, { ...entry, tfaFails: fails }, Math.max(1000, exp - Date.now()));
    return fails;
  };

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
    const authorizeUrl = `${cfg.authorizeUrl}?${params.toString()}`;
    // ★ 日志断点①：把**完整授权地址**打出来，便于直接粘到浏览器复现。
    //   client_id 是公开的应用 ID，可打印；client_secret / token 永不进日志。
    console.log(`[oauth] start: provider=${cfg.provider} redirect_uri=${cfg.redirectUri} scope=${cfg.scope}`);
    console.log(`[oauth] start -> ${authorizeUrl}`);
    res.redirect(authorizeUrl);
  });

  // ---- 授权回调：换 token → 取 userinfo → 登录 / 要求绑定 ----
  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    // ★ 日志断点②：回调是否被触发？带了什么？
    //   code / state 只打印长度与前几位 —— 它们是凭据，绝不完整落盘。
    console.log(
      `[oauth] callback 命中: error=${error || '-'} code=${code ? `${String(code).slice(0, 6)}…(len=${String(code).length})` : '无'} state=${state ? `${String(state).slice(0, 8)}…` : '无'}`,
    );
    if (error) {
      console.error(`[oauth] callback 失败：授权服务器返回 error=${error}`);
      return res.status(400).send('授权被取消或失败');
    }
    if (!code || !state) {
      console.error('[oauth] callback 失败：缺少 code 或 state');
      return res.status(400).send('缺少 code 或 state');
    }

    const stateOk = await states.get(state);
    if (!stateOk) {
      console.error(`[oauth] callback 失败：state 无效或已过期（${String(state).slice(0, 8)}…）`);
      return res.status(400).send('state 无效或已过期');
    }
    await states.del(state); // 一次性消费
    console.log('[oauth] state 校验通过');

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
      console.log(`[oauth] 换令牌 -> POST ${cfg.tokenUrl} 结果 status=${tokenRes.status}`);
      if (!tokenRes.ok) {
        console.error(`[oauth] 换令牌失败 status=${tokenRes.status}`);
        throw new Error(`授权服务器返回错误（${tokenRes.status}）`);
      }
      const tokens = await tokenRes.json();
      const accessToken = tokens.access_token;
      if (!accessToken) {
        console.error(`[oauth] 响应里没有 access_token，仅有字段=${Object.keys(tokens || {}).join(', ')}`);
        throw new Error('授权服务器未返回 access_token');
      }
      console.log('[oauth] 换令牌成功（access_token 不打印）');

      // 2) 取用户信息（HamCQ：token 走 query）
      const uiRes = await fetch(`${cfg.userInfoUrl}?access_token=${encodeURIComponent(accessToken)}`, {
        signal: AbortSignal.timeout(15000),
      });
      console.log(`[oauth] 取用户信息 -> status=${uiRes.status}`);
      if (!uiRes.ok) {
        console.error(`[oauth] 取用户信息失败 status=${uiRes.status}`);
        throw new Error(`获取用户信息失败（${uiRes.status}）`);
      }
      const profile = await uiRes.json();
      // ★ 只打印**字段名**，不打印值 —— userinfo 里有邮箱等隐私，值一律不进日志
      console.log(`[oauth] 用户信息字段: ${Object.keys(profile || {}).join(', ') || '(空)'}`);

      const callsign = String(profile[cfg.callsignField] || '').trim().toUpperCase();
      const sub = String(profile[cfg.userSubField] ?? profile.id ?? '').trim();
      if (!callsign || !sub) {
        console.error(`[oauth] 字段映射失败 callsignField=${cfg.callsignField}->'${callsign}' userSubField=${cfg.userSubField}->'${sub}'`);
        throw new Error('未能从授权服务器获取呼号 / 用户 ID');
      }
      // HamCQ 的邮箱（可能为空，取决于 scope / 是否已验证）。
      // 非法格式一律当作「没有」——绝不因为一个邮箱把整条登录链路打断。
      const providerEmail = normalizeEmail(profile[cfg.emailField]);
      const email = providerEmail === '' ? null : providerEmail;
      // ⚠️ 这一行**必须放在 `email` 声明之后**：`const` 有暂时性死区（TDZ），
      //    写在前面会抛 ReferenceError → 被外层 catch 捕获 → 回调直接 500。
      //    （2026-09-30 审计发现：日志断点最初写在了声明之前。）
      console.log(`[oauth] 解析成功 callsign=${callsign} sub=${sub} 有邮箱=${!!email}（值不打印）`);

      // 3) 已绑定过 → 直接登录
      const bound = await db().query('SELECT * FROM users WHERE oauth_provider=$1 AND oauth_sub=$2', [cfg.provider, sub]);
      if (bound.rows.length > 0) {
        const u = bound.rows[0];
        // 邮箱回填：绝大多数老账号是在「邮箱绑定」上线之前注册/绑定的，
        // 而「已绑定」路径以前直接登录、不会补邮箱 —— 于是这些人永远填不上。
        // 因此每次 HamCQ 登录都检查一次：本站还没有邮箱、且这次 HamCQ 返回了邮箱 → 补上。
        // （绝不覆盖用户已有值）
        // 还要确保该邮箱没被**别的**账号占用（同一邮箱只允许绑一个账号）
        if (!u.email && email && !(await isEmailTaken(db(), email, u.id))) {
          await db().query("UPDATE users SET email=$1, email_source='hamcq', email_verified=TRUE, email_verified_at=NOW() WHERE id=$2", [email, u.id]);
        }
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
        email, // HamCQ 邮箱（可能为 null），补全信息时写入 users.email
        profile,
      }, STATE_TTL_MS);
      return res.redirect(
        `${frontendOrigin(cfg)}/#/oauth/complete?pending_token=${pendingToken}&username=${encodeURIComponent(callsign)}`,
      );
    } catch (e) {
      console.error('[oauth] callback 异常中断:', e?.message || e);
      res.status(500).send('登录失败：授权服务器异常，请稍后重试');
    }
  });

  // ---- 补全信息：确认呼号 → 绑定已有账号（需密码）或创建新账号 ----
  router.post('/complete', async (req, res) => {
    const { pending_token: pendingToken, callsign, password, invite_code: inviteCode, totp_code: totpCode } = req.body || {};
    // ★ 日志断点③：补全信息页提交 —— 第一次建号 / 绑定老账号都从这里过
    console.log(`[oauth] complete: pending=${pendingToken ? `${String(pendingToken).slice(0, 6)}…` : '无'} 呼号=${callsign || '(空)'} 有密码=${!!password} 邀请码=${inviteCode ? '有' : '无'} 2FA=${totpCode ? '有' : '无'}`);
    if (!pendingToken) return res.status(400).json({ error: 'BAD_REQUEST', message: '缺少参数' });
    const pending = await pendingBinds.get(pendingToken);
    if (!pending || pending.expiresAt < Date.now()) {
      console.error(`[oauth] complete 失败：待绑定会话无效/过期（sub=${pending?.sub || '-'}）`);
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

      // ★ 2FA（安全整改）：绑定已有账号 = 一次完整登录，必须和密码登录一样过两步验证。
      //   失败时**不消费** pendingToken，前端可带上 totp_code 重试（TTL 10 分钟）。
      const tfaErr = verifyTotp(u, totpCode);
      if (tfaErr) {
        const fails = await bumpTotpFails(pendingBinds, pendingToken, pending);
        console.error(`[oauth] complete 被 2FA 拦下：callsign=${u.callsign} ${tfaErr.body.error} 第 ${fails} 次`);
        return res.status(tfaErr.status).json(tfaErr.body);
      }

      await db().query('UPDATE users SET oauth_provider=$1, oauth_sub=$2, oauth_raw=$3 WHERE id=$4', [
        pending.provider,
        pending.sub,
        JSON.stringify(pending.profile),
        u.id,
      ]);
      // 邮箱回填：仅当本站账号**还没有邮箱**、HamCQ 返回了邮箱、且该邮箱**未被其它账号占用**时补上
      // —— 既不覆盖用户自己填的，也不去抢别人已绑的邮箱
      const emailTaken = pending.email ? await isEmailTaken(db(), pending.email, u.id) : false;
      const emailBackfilled = !u.email && !!pending.email && !emailTaken;
      if (emailBackfilled) {
        await db().query("UPDATE users SET email=$1, email_source='hamcq', email_verified=TRUE, email_verified_at=NOW() WHERE id=$2", [pending.email, u.id]);
      }
      await pendingBinds.del(pendingToken);
      // 审计：OAuth「绑定已有账号」也是一次登录，必须留痕（此前漏记，导致用户登录查不到）
      await audit(req, {
        action: 'auth.login',
        targetType: 'user',
        targetId: u.id,
        actor: { id: u.id, callsign: u.callsign, role: u.role },
        detail: {
          channel: 'hamcq',
          bound: true,
          email: emailBackfilled ? pending.email : undefined,
          // 邮箱撞车时明确留痕，便于管理员解释"为什么这次没绑上"
          email_conflict: emailTaken || undefined,
        },
      });
      // ★ 邮箱门槛（审计整改）：绑定已有账号 = 一次完整登录，未验证邮箱一律拦下（与密码登录一致）
      const emailGate1 = await verifyEmailGate(req, u);
      if (emailGate1) return res.status(emailGate1.status).json(emailGate1.body);
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
    // 首次建号：把 HamCQ 的邮箱一并绑定（email_source='hamcq'）；
    // 若该邮箱已被**别的**账号占用则留空（不做跨账号重复绑定），并在审计里标注冲突。
    const newEmailTaken = pending.email ? await isEmailTaken(db(), pending.email) : false;
    const bindEmail = pending.email && !newEmailTaken ? pending.email : null;
    const created = await db().query(
      `INSERT INTO users (callsign, password_hash, role, oauth_provider, oauth_sub, oauth_raw, invite_code, email, email_source, email_verified, email_verified_at)
       VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, $8, TRUE, NOW()) RETURNING *`,
      [cs, hash, pending.provider, pending.sub, JSON.stringify(pending.profile), usedCode, bindEmail, bindEmail ? 'hamcq' : null],
    );
    await pendingBinds.del(pendingToken);
    const u = created.rows[0];
    await audit(req, { action: 'auth.register', targetType: 'user', targetId: u.id, detail: { callsign: u.callsign, channel: 'hamcq', invite_code: usedCode || undefined, email: bindEmail || undefined, email_conflict: newEmailTaken || undefined } });
    if (usedCode) {
      await audit(req, { action: 'invite.use', targetType: 'invite', targetId: usedCode, detail: { callsign: u.callsign, channel: 'hamcq' } });
    }
    // 审计：OAuth 首次建号同时也是一次登录
    await audit(req, {
      action: 'auth.login',
      targetType: 'user',
      targetId: u.id,
      actor: { id: u.id, callsign: u.callsign, role: u.role },
      detail: { channel: 'hamcq', created: true },
    });
    // ★ 邮箱门槛（审计整改）：新建 OAuth 账号已在 INSERT 时置 email_verified=TRUE，此处门槛恒通过；
    //   保留检查是防御性一致（万一未来策略变动，不致从这条路径漏过去）。
    const emailGate2 = await verifyEmailGate(req, u);
    if (emailGate2) return res.status(emailGate2.status).json(emailGate2.body);
    return res.json({ token: signToken(u), user: publicUser(u) });
  });

  // ---- 一次性换码：前端拿 URL 里的 code 来换 JWT（code 不长期留在 URL/历史里）----
  router.post('/code', async (req, res) => {
    const { code, totp_code: totpCode } = (req.body || {});
    // ★ 日志断点④：前端拿一次性换码换 JWT（"已绑定 → 直接登录"这条路径的最后一跳）
    console.log(`[oauth] code 换登录: ${code ? `${String(code).slice(0, 6)}…(len=${String(code).length})` : '无'} 2FA=${totpCode ? '有' : '无'}`);
    if (!code) return res.status(400).json({ error: 'BAD_REQUEST', message: '缺少换码' });
    const entry = await sessionCodes.get(code);
    if (!entry || entry.exp < Date.now()) {
      await sessionCodes.del(code);
      console.error('[oauth] code 换登录失败：换码无效或已过期（一次性，可能已被消费）');
      return res.status(401).json({ error: 'CODE_INVALID', message: '登录码无效或已过期，请重新登录' });
    }
    try {
      const r = await db().query('SELECT * FROM users WHERE id=$1', [entry.userId]);
      const u = r.rows[0];
      if (!u) {
        await sessionCodes.del(code);
        return res.status(401).json({ error: 'USER_NOT_FOUND', message: '账号不存在' });
      }
      if (u.status === 'disabled') {
        await sessionCodes.del(code);
        return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: '账号已被禁用' });
      }
      // ★ 2FA（安全整改）：一次性换码只证明「HamCQ 那边授权成功」，**不等于**本站第二因素。
      //   校验失败时**不消费换码**，前端可带上 totp_code 重试（TTL 60s，失败 5 次即作废）。
      const tfaErr = verifyTotp(u, totpCode);
      if (tfaErr) {
        const fails = await bumpTotpFails(sessionCodes, code, entry);
        console.error(`[oauth] code 换登录被 2FA 拦下：${u.callsign} ${tfaErr.body.error} 第 ${fails} 次`);
        return res.status(tfaErr.status).json(tfaErr.body);
      }
      await sessionCodes.del(code); // 2FA 通过后才一次性消费
      // 审计：OAuth 已绑定账号的常规登录（此前漏记，导致用户登录查不到）
      await audit(req, {
        action: 'auth.login',
        targetType: 'user',
        targetId: u.id,
        actor: { id: u.id, callsign: u.callsign, role: u.role },
        detail: { channel: 'hamcq' },
      });
      // ★ 邮箱门槛（审计整改）：一次性换码只证明 HamCQ 授权成功，不等于本站邮箱已验证；
      //   未验证邮箱的存量账号（无论最初密码还是 OAuth 注册）一律拦下，与密码登录一致。
      const emailGate3 = await verifyEmailGate(req, u);
      if (emailGate3) return res.status(emailGate3.status).json(emailGate3.body);
      res.json({ token: signToken(u), user: publicUser(u) });
    } catch (e) {
      res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  return router;
}
