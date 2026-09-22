/**
 * 站内通知（M4.1，2026-09-22）
 * ------------------------------------------------------------------
 * 用户要求做「站内提醒」：审核员收到「有新实物材料待审核」，申请人收到「审核通过/驳回」等。
 *
 * 事件 → 通知对象（在业务路由里调用 `notifyUsers`）：
 *   - 用户上传实物材料      → 审核员（所有 admin + 该奖状创建者）
 *   - 实物材料审核通过/驳回 → 上传者
 *   - 奖状审核通过/打回     → 奖状创建者
 *
 * 通知只做「站内」，不接邮件（邮件另议成本）。前端轮询未读数显示红点，
 * 点开面板可读详情、一键全部已读。
 */
import express from 'express';

/**
 * 批量插入通知。userIds 去重、过滤空值。
 * @param {import('pg').Pool} pool
 * @param {number[]} userIds
 * @param {{type:string, title:string, body:string}} payload
 */
export async function notifyUsers(pool, userIds, { type, title, body }) {
    if (!pool) return;
    const uniq = [...new Set((userIds || []).filter(Boolean))];
    if (!uniq.length) return;
    const values = uniq.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(',');
    const params = [];
    uniq.forEach((uid) => params.push(uid, type, title, body));
    try {
        await pool.query(
            `INSERT INTO notifications (user_id, type, title, body) VALUES ${values}`,
            params,
        );
    } catch (e) {
        console.error('notifyUsers error:', e.message);
    }
}

export function createNotificationsRouter({ getDbPool, verifyToken }) {
    const router = express.Router();
    const db = () => getDbPool();

    // 当前用户的通知（未读优先，最近 50 条）+ 未读总数
    router.get('/', verifyToken, async (req, res) => {
        try {
            const list = await db().query(
                `SELECT id, type, title, body, read, created_at
                 FROM notifications
                 WHERE user_id = $1
                 ORDER BY read ASC, created_at DESC
                 LIMIT 50`,
                [req.user.id],
            );
            const unread = await db().query(
                `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read = FALSE`,
                [req.user.id],
            );
            res.json({ list: list.rows, unread: unread.rows[0].n });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 标记已读：{ all: true } 或 { id }
    router.post('/read', verifyToken, async (req, res) => {
        try {
            const { all, id } = req.body || {};
            if (all) {
                await db().query(`UPDATE notifications SET read = TRUE WHERE user_id = $1`, [req.user.id]);
            } else if (id) {
                await db().query(`UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
}
