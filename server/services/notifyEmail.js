/**
 * 站内通知 → 邮件转发（2026-09-30）
 * ------------------------------------------------------------------
 * 由 `notifications.js` 的 `notifyUsers()` 在**写库之后**调用（没写库就不发信，
 * 保证「邮件里说的」和「铃铛里看到的」永远一致）。
 *
 * 放行条件（**四道闸全过才发**，任一不满足就安静跳过）：
 *   ① 管理员在「后台管理 → 邮件通知」里开了总开关，并勾选了该事件类型；
 *   ② 发信通道就绪（`SMTP_ENABLED` + host/user/pass，且**非演示站**）；← 由 mailer 判定
 *   ③ 收件人 `users.email_notify = TRUE`（用户自己在用户中心主动开，默认关）;
 *   ④ 收件人邮箱**已验证**且非空。
 *
 * ⚠️ 一定不能因为发信把业务请求搞崩：整个函数体包 try/catch，只打日志、**绝不抛**；
 *    真正的 SMTP 发送走 `enqueueMail()`（串行队列，不阻塞请求）。
 */

import { getMailSettings, isNotifyTypeEnabled } from './mailSettings.js';
import { isMailReady, enqueueMail } from './mailer.js';
import { notificationTemplate } from './emailTemplates.js';

/** 事件 → 站内页面（与前端 NOTIF_TARGET 保持一致；点邮件里的链接直达对应页面） */
const TARGET_ROUTE = {
  award_pending: 'admin_audit',
  award_approved: 'award_drafts',
  award_returned: 'award_returned',
  award_withdrawn: 'issuanceManager',
  evidence_pending: 'evidence_audit',
  evidence_approved: 'my_awards',
  evidence_rejected: 'my_awards',
  role_request: 'users',
  role_approved: 'userCenter',
  role_rejected: 'userCenter',
  email_unbound: 'userCenter',
};

const baseUrl = () => String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const linkFor = (type) => {
  const base = baseUrl();
  const route = TARGET_ROUTE[type];
  return base && route ? `${base}/#/${route}` : base || '';
};

/**
 * 去重（防骚扰）：同一收件人 + 同一事件 + 同一标题，在 5 分钟内只发一封。
 * 典型场景：同一张奖状被连续重新提交、或管理员连点批量提醒。
 * 纯内存、进程级；重启即清零（无状态、不落库）。
 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const DEDUPE_MAX_KEYS = 1000;
const recent = new Map();

function isDuplicate(key) {
  const now = Date.now();
  const hit = recent.get(key);
  if (hit && now - hit < DEDUPE_WINDOW_MS) return true;
  recent.set(key, now);
  if (recent.size > DEDUPE_MAX_KEYS) {
    for (const [k, ts] of recent) {
      if (now - ts > DEDUPE_WINDOW_MS) recent.delete(k);
    }
  }
  return false;
}

/**
 * 把一条站内通知按需转发成邮件。
 * @param {import('pg').Pool} pool
 * @param {number[]} userIds 与写通知时完全相同的收件人集合
 * @param {{type:string, title:string, body:string}} payload
 * @returns {Promise<{sent:number, skipped:string}>} 仅用于日志/自检，调用方无需处理
 */
export async function forwardNotificationEmails(pool, userIds, { type, title, body }) {
  try {
    if (!pool) return { sent: 0, skipped: 'NO_POOL' };
    if (!getMailSettings().enabled) return { sent: 0, skipped: 'DISABLED' };
    if (!isNotifyTypeEnabled(type)) return { sent: 0, skipped: 'TYPE_OFF' };
    // 通道未就绪（含演示站禁发）时不查库，省一次往返
    if (!isMailReady()) return { sent: 0, skipped: 'MAIL_NOT_READY' };

    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return { sent: 0, skipped: 'NO_RECIPIENT' };

    const r = await pool.query(
      `SELECT id, callsign, email
         FROM users
        WHERE id = ANY($1::int[])
          AND email_notify = TRUE
          AND email_verified = TRUE
          AND email IS NOT NULL
          AND email <> ''`,
      [ids],
    );
    if (!r.rows.length) return { sent: 0, skipped: 'NO_SUBSCRIBER' };

    const link = linkFor(type);
    let sent = 0;
    for (const u of r.rows) {
      if (isDuplicate(`${u.id}|${type}|${title}`)) continue;
      const tpl = notificationTemplate({ callsign: u.callsign, title, body, link });
      enqueueMail({ to: u.email, subject: tpl.subject, text: tpl.text });
      sent += 1;
    }
    if (sent) console.log(`[mail] 通知转发（${type}）→ ${sent}/${ids.length} 位订阅用户`);
    return { sent, skipped: sent ? '' : 'DEDUPED' };
  } catch (e) {
    // 邮件是"锦上添花"，绝不能影响站内通知与业务流程
    console.error('[mail] 通知转发失败:', e.message);
    return { sent: 0, skipped: 'ERROR' };
  }
}
