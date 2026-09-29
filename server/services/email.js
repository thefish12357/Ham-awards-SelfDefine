/**
 * 邮箱规范化与校验（注册绑定 / HamCQ OAuth 绑定共用）
 * ------------------------------------------------------------------
 * 为什么单独抽出来：两条绑定路径（`/api/auth/register` 与 OAuth `/complete`）
 * 必须用**同一套**规范化与校验规则，否则会出现「注册能过的邮箱 OAuth 存不进去」
 * 这类两边不一致的问题。
 *
 * 设计取舍：
 *   - **规范化**：去空格 + 转小写（邮箱域名大小写不敏感，统一小写便于去重/展示）。
 *   - **不做唯一性约束**：HamCQ 返回的邮箱可能为空、也可能与既有账号重合；
 *     若在数据库上加 UNIQUE，OAuth 首次建号会直接失败，用户将无法登录。
 *     因此唯一性由业务自行把握，本模块只负责「格式是否合法」。
 *   - 长度上限 254（RFC 5321 的邮箱最大长度），超长直接判非法。
 */

/** 宽松但足够用的邮箱正则：本地部分@域名.顶级域（顶级域至少 2 位） */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * 规范化并校验邮箱。
 * @param {unknown} raw 原始输入
 * @returns {string|null|''} 规范化后的邮箱字符串；**未填/空值返回 `null`**；**格式非法返回 `''`**
 */
export function normalizeEmail(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v.length > 254 || !EMAIL_RE.test(v)) return '';
  return v;
}

/**
 * 该邮箱是否已被**其它**账号占用（大小写不敏感）。
 *
 * 调用方（注册 / 用户中心改邮箱 / OAuth 绑定）据此实现「同一邮箱只绑一个账号」。
 * 注意仍然**没有数据库唯一约束**：OAuth 建号时若邮箱撞车只跳过绑定、不能让登录失败，
 * 所以唯一性在业务层判断，而不是靠 UNIQUE 抛异常。
 *
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }} db 连接池 / 客户端
 * @param {string|null} email 已规范化的邮箱（空值直接返回 false）
 * @param {number|null} excludeUserId 需要排除的账号 id（用户改自己的邮箱时排除自己）
 * @returns {Promise<boolean>}
 */
export async function isEmailTaken(db, email, excludeUserId = null) {
  if (!email) return false;
  const r = await db.query(
    'SELECT 1 FROM users WHERE LOWER(email) = $1 AND ($2::int IS NULL OR id <> $2) LIMIT 1',
    [email, excludeUserId],
  );
  return r.rows.length > 0;
}
