/**
 * 内测邀请码（closed beta 门禁）
 * ------------------------------------------------------------------
 * 目的：内测阶段只放行"拿到邀请码的人"，但**不影响已在册账号的正常登录**。
 *
 * 设计取舍：
 *   - **门禁只加在"新账号产生"这一步**：`/api/auth/register`（密码注册）与
 *     `/api/auth/oauth/complete` 的**新建账号分支**。登录、绑定已有账号一律不看邀请码
 *     —— 否则内测期间的存量用户会被自己锁在门外。
 *   - **总开关在 `config.json` 的 `beta.requireInvite`**（默认 false）：内测结束
 *     在后台点一下"关闭邀请制"即可，不用删代码、不用停服。
 *   - 消费邀请码用**一条原子 UPDATE**（`used_count < max_uses` 写在 WHERE 里），
 *     多人同时用同一个码不会超发。
 *   - 留痕：`users.invite_code` 记住"这个账号是用哪个码进来的"；
 *     审计里另有 `invite.use`（谁在什么时候用了哪个码），管理页可直接按码看使用者。
 */
import crypto from 'crypto';

/** 建表语句（由 server.js 的 upgradeSchema 调用，保持单一来源便于迁移核对） */
export const INVITE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS invite_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(32) UNIQUE NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    expires_at TIMESTAMP,
    disabled BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );
`;

/** 邀请制是否开启（读 config.json 的 beta.requireInvite） */
export const isInviteRequired = (config) => !!(config && config.beta && config.beta.requireInvite);

/**
 * 生成邀请码：`HAM-XXXX-XXXX`，字符集去掉了易混的 I / O / 0 / 1
 * （内测期靠人肉转发，念错一个字符就是一次客服）。
 */
export const genInviteCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
  return `HAM-${block()}-${block()}`;
};

/**
 * 校验并**消费**一次邀请码（原子）。
 * @returns {Promise<{ok: boolean, code?: string, reason?: 'MISSING'|'INVALID'}>}
 */
export const consumeInviteCode = async (db, code) => {
  const raw = String(code || '').trim().toUpperCase();
  if (!raw) return { ok: false, reason: 'MISSING' };
  const r = await db.query(
    `UPDATE invite_codes
        SET used_count = used_count + 1
      WHERE code = $1
        AND disabled = FALSE
        AND (expires_at IS NULL OR expires_at > NOW())
        AND used_count < max_uses
      RETURNING code, used_count, max_uses`,
    [raw],
  );
  if (r.rows.length === 0) return { ok: false, reason: 'INVALID' };
  return { ok: true, code: r.rows[0].code };
};

/** 门禁失败时的统一响应体（前端按 error 码分辨"没填码"与"码不对"） */
export const inviteError = (reason, channel = 'register') => {
  const missing = reason === 'MISSING';
  return {
    status: 400,
    body: {
      error: missing ? (channel === 'oauth' ? 'NEED_INVITE' : 'INVITE_REQUIRED') : 'INVITE_INVALID',
      message: missing ? '本站内测中，请填写邀请码' : '邀请码无效、已过期或用完',
    },
  };
};
