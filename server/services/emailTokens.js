/**
 * 邮件一次性令牌（2026-09-30）
 * ------------------------------------------------------------------
 * 用途：注册后的**邮箱验证链接** 与 **找回密码链接**。
 *
 * 安全约定（与密码同级别对待）：
 *   - **库里只存 sha256(token)**，原文只出现在邮件里 —— 库被读也不能直接拿来用；
 *   - **一次性**：用过即写 `used_at`，重复点链接会明确回「已使用」而不是「无效」；
 *   - **有有效期**：验证链接 24h、重置密码 30min（重置短得多，因为能直接改密码）；
 *   - **同用途并发令牌作废**：重发 / 改密成功后，把该用户其它未用同类令牌全部作废
 *     （否则旧邮件里的链接还能用，等于多把钥匙）；
 *   - 令牌用 `crypto.randomBytes(32)`（256 位），不做短码 —— 短码需要额外的防爆破计数，
 *     而链接形式本来就该足够长。
 */
import crypto from 'node:crypto';

export const PURPOSE = {
    VERIFY_EMAIL: 'verify_email',
    RESET_PASSWORD: 'reset_password',
};

/** 各类令牌有效期 */
export const TTL = {
    [PURPOSE.VERIFY_EMAIL]: 24 * 60 * 60 * 1000,   // 24 小时：用户可能隔天才看邮箱
    [PURPOSE.RESET_PASSWORD]: 30 * 60 * 1000,      // 30 分钟：能直接改密码，从紧
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * 签发令牌（返回**原文**，只此一次能拿到）。
 * @param {import('pg').Pool} db
 * @param {{userId:number, email?:string, purpose:string, ttlMs?:number}} p
 * @returns {Promise<string>} 令牌原文
 */
export async function issueEmailToken(db, { userId, email, purpose, ttlMs }) {
    // 先作废同类旧令牌：用户连点两次「重发」，只有最后一封里的链接有效
    await revokeEmailTokens(db, { userId, purpose });
    const token = crypto.randomBytes(32).toString('hex');
    const ttl = ttlMs || TTL[purpose] || 60 * 60 * 1000;
    await db.query(
        `INSERT INTO email_tokens (user_id, email, purpose, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, email || null, purpose, sha256(token), new Date(Date.now() + ttl)],
    );
    return token;
}

/**
 * 消费令牌。**成功时才**写 `used_at`（校验失败的令牌不再标记，用户可原样重试）。
 * @returns {Promise<{ok:true, row:object}|{ok:false, reason:'NOT_FOUND'|'USED'|'EXPIRED'}>}
 */
export async function consumeEmailToken(db, { token, purpose }) {
    if (!token) return { ok: false, reason: 'NOT_FOUND' };
    const r = await db.query(
        `SELECT * FROM email_tokens WHERE token_hash = $1 AND purpose = $2`,
        [sha256(token), purpose],
    );
    const row = r.rows[0];
    if (!row) return { ok: false, reason: 'NOT_FOUND' };
    if (row.used_at) return { ok: false, reason: 'USED' };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' };
    await db.query(`UPDATE email_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
    return { ok: true, row };
}

/** 作废某用户某用途下所有未用令牌（重发 / 改密成功后调用） */
export async function revokeEmailTokens(db, { userId, purpose }) {
    await db.query(
        `UPDATE email_tokens SET used_at = NOW()
          WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
        [userId, purpose],
    );
}
