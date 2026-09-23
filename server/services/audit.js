/**
 * 全站操作审计（Audit Log）
 * ------------------------------------------------------------------
 * 目标：把**敏感操作**留痕，供**最高级管理员（role='admin'）**事后追溯——
 * 例如「某张奖状被谁删了」「某个账号是谁提权到 award_admin 的」「谁改过系统设置」。
 *
 * 设计取舍：
 *   - **只记敏感操作，不做全量埋点**（登录、账号/密码/2FA、角色、奖状增删审、
 *     实物材料审核、系统设置）。发通知、切主题这类不属于审计范围。
 *   - **绝不记录凭据**：密码 / TOTP secret / LoTW 账号密码一律不进 `detail`，
 *     只记「做了什么、对哪个对象」。
 *   - `actor_callsign` **冗余存一份**：`actor_id` 用 `ON DELETE SET NULL`，
 *     账号注销后仍能看出"当时是谁操作的"。
 *   - 写入是 **best-effort**：审计失败绝不打断业务（自己吞异常并打日志）。
 *
 * 与「单个奖状的审核流水」的区别：
 *   - `awards.audit_log`（JSONB）= 那一张奖状的**业务流水**，可见范围 =
 *     该奖状的管理员 + 最高级管理员（见 `/api/admin/awards/*` 与 `/api/awards/my`）；
 *   - 本模块的 `audit_logs` 表 = **全站级**操作记录，只有最高级管理员能查。
 */
import express from 'express';

/**
 * 取调用方真实 IP。
 *
 * 取值优先级（越靠前越可信，都是"反代写进来的"头）：
 *   1. `CF-Connecting-IP` —— Cloudflare（含 Cloudflare Tunnel）写入的**单个**真实客户端 IP，最干净；
 *   2. `X-Real-IP`        —— nginx `proxy_set_header X-Real-IP $remote_addr`；
 *   3. `X-Forwarded-For`  —— 通用反代链，取**第一段**（最左 = 最初的客户端）；
 *   4. `req.ip` / socket  —— 没有反代时（直连）才是真实地址。
 *
 * ⚠️ 两个必须处理的格式问题：
 *   - **IPv4-mapped IPv6**：Node 双栈监听时，本机 IPv4 会写成 `::ffff:127.0.0.1`，剥掉前缀才好看；
 *   - **回环地址**：本机访问会拿到 `::1`（IPv6）或 `127.0.0.1`，那是**正常现象**，不是采集错误 ——
 *     部署到公网/隧道后才会变成访客的真实公网 IP。
 */
const clientIp = (req) => {
  if (!req) return null;
  const h = req.headers || {};
  const first = (v) => String(v || '').split(',')[0].trim();
  const raw =
    first(h['cf-connecting-ip']) ||
    first(h['x-real-ip']) ||
    first(h['x-forwarded-for']) ||
    req.ip ||
    req.socket?.remoteAddress ||
    '';
  if (!raw) return null;
  const ip = raw.replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '');
  return ip.slice(0, 64);
};

/**
 * 写一条审计记录（best-effort，失败只打日志，不抛异常）。
 *
 * @param {import('pg').Pool} pool 数据库连接池（未初始化时直接跳过）
 * @param {import('express').Request} req 用于取 actor / IP / UA
 * @param {object} entry
 * @param {string} entry.action        动作标识，形如 `user.password_change`
 * @param {string} [entry.targetType]  目标类型：user / award / evidence / role_request / settings
 * @param {string|number} [entry.targetId] 目标主键
 * @param {object} [entry.detail]      补充说明（**不要放密码等凭据**）
 * @param {object} [entry.actor]       覆盖操作者（登录失败时还没有 req.user）
 */
export async function logAudit(pool, req, entry = {}) {
  const { action, targetType = null, targetId = null, detail = null, actor = null } = entry;
  if (!pool || !action) return;
  try {
    const who = actor || req?.user || null;
    const ua = String(req?.headers?.['user-agent'] || '').slice(0, 300) || null;
    await pool.query(
      `INSERT INTO audit_logs
         (actor_id, actor_callsign, actor_role, action, target_type, target_id, detail, ip, ua)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        who?.id || null,
        String(who?.callsign || detail?.callsign || 'anonymous').slice(0, 32),
        who?.role || null,
        String(action).slice(0, 64),
        targetType ? String(targetType).slice(0, 32) : null,
        targetId === null || targetId === undefined ? null : String(targetId).slice(0, 64),
        detail ? JSON.stringify(detail) : null,
        clientIp(req),
        ua,
      ],
    );
  } catch (e) {
    // 审计写入失败不能影响业务
    console.error('audit log failed:', e.message);
  }
}

/**
 * 审计日志查询（`GET /api/admin/audit-logs`）——**仅最高级管理员**。
 * 支持筛选：`action`（精确或前缀，如 `award.`）、`actor`（呼号模糊）、
 * `target`（目标 ID）、`q`（全字段模糊）、`from`/`to`（ISO 日期）、分页 `page`/`pageSize`。
 * 工厂函数注入依赖，避免与 server.js 循环 import（与 lotw / evidence 路由同一套路）。
 */
export function createAuditRouter({ getDbPool, verifyToken, verifyAdmin }) {
  const router = express.Router();

  router.get('/', verifyToken, verifyAdmin, async (req, res) => {
    const db = getDbPool();
    if (!db) return res.status(503).json({ error: 'DB_NOT_READY' });

    const q = req.query || {};
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 30));

    const where = [];
    const params = [];
    const push = (sql, value) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    const action = String(q.action || '').trim();
    if (action) {
      // 以 `.` 结尾视为前缀匹配（例：award. → 全部奖状相关动作）
      if (action.endsWith('.')) push('action LIKE ?', `${action}%`);
      else push('action = ?', action);
    }
    const actor = String(q.actor || '').trim();
    if (actor) push('actor_callsign ILIKE ?', `%${actor}%`);
    const target = String(q.target || '').trim();
    if (target) push('target_id = ?', target);
    const keyword = String(q.q || '').trim();
    if (keyword) {
      params.push(`%${keyword}%`);
      const i = `$${params.length}`;
      where.push(
        `(actor_callsign ILIKE ${i} OR action ILIKE ${i} OR target_id ILIKE ${i} OR detail::text ILIKE ${i})`,
      );
    }
    if (q.from) push('created_at >= ?', new Date(String(q.from)));
    if (q.to) push('created_at <= ?', new Date(String(q.to)));

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    try {
      const total = await db.query(`SELECT count(*)::int AS n FROM audit_logs ${whereSql}`, params);
      const list = await db.query(
        `SELECT id, actor_id, actor_callsign, actor_role, action, target_type, target_id, detail, ip, created_at
           FROM audit_logs ${whereSql}
          ORDER BY created_at DESC, id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize],
      );
      res.json({ list: list.rows, total: total.rows[0].n, page, pageSize });
    } catch (e) {
      console.error('audit query failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
