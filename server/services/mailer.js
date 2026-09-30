/**
 * 邮件发送（2026-09-30）
 * ------------------------------------------------------------------
 * 目标：把「发信」收在一个地方 —— 业务代码只调 `sendMail()` / `enqueueMail()`，
 *       不关心 SMTP 细节，且**绝不会因为发信失败而把业务接口搞崩**。
 *
 * 硬约定：
 *   1. **未启用就静默跳过**（SMTP_ENABLED 非 true，或缺 host/user/pass）→ 记一行日志返回
 *      `{ skipped:true }`，业务侧照常成功（没配邮箱的站点不会因为发信功能报错）。
 *   2. **DEMO_MODE=true 强制跳过**（演示站不许刷爆企业邮配额、也不许把测试信发给真人）。
 *   3. 发信**串行 + 最小间隔**：腾讯企业邮对并发/频率敏感，且基础版对外约 500 封/天。
 *   4. 失败只 `console.error`，**不抛**；永不打印密码。
 *
 * 凭据（见 .env）：腾讯企业邮 / 企业微信邮箱
 *   SMTP_HOST=smtp.exmail.qq.com  SMTP_PORT=465  SMTP_SECURE=true
 *   SMTP_USER=发信邮箱完整地址（公共邮箱也可）  SMTP_PASS=客户端专用密码 / 授权码
 * ⚠️ 腾讯要求 **From 地址与登录账号一致**，所以发件地址固定用 SMTP_USER，
 *    只有**显示名**可配（SMTP_FROM_NAME）。留 SMTP_REPLY_TO 可把回信引到别的邮箱。
 */
import nodemailer from 'nodemailer';

const truthy = (v, dflt = false) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (s === '') return dflt;
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
};

/** 当前 SMTP 配置（只读环境变量，不缓存 —— 便于容器改 env 后重启即生效） */
export function mailerConfig() {
    return {
        enabled: truthy(process.env.SMTP_ENABLED, false),
        host: String(process.env.SMTP_HOST || '').trim(),
        port: Number(process.env.SMTP_PORT || 465),
        secure: truthy(process.env.SMTP_SECURE, true),
        user: String(process.env.SMTP_USER || '').trim(),
        pass: String(process.env.SMTP_PASS || ''),
        fromName: String(process.env.SMTP_FROM_NAME || 'HamGlory 奖状系统').trim(),
        replyTo: String(process.env.SMTP_REPLY_TO || '').trim(),
    };
}

const isDemoMode = () => truthy(process.env.DEMO_MODE, false);

/**
 * 发信能力状态。给 `/api/system-status` 与管理员界面用 ——
 * 明确区分「没配置」和「配置了但被演示模式禁掉」，排障时一眼看清。
 */
export function mailerStatus() {
    const c = mailerConfig();
    const reasons = [];
    if (!c.enabled) reasons.push('SMTP_ENABLED 未开启');
    if (!c.host) reasons.push('缺 SMTP_HOST');
    if (!c.user) reasons.push('缺 SMTP_USER');
    if (!c.pass) reasons.push('缺 SMTP_PASS');
    if (isDemoMode()) reasons.push('演示站禁发（DEMO_MODE=true）');
    return {
        enabled: c.enabled,
        ready: reasons.length === 0,
        reason: reasons.join('；'),
        host: c.host,
        port: c.port,
        from: c.user,
        fromName: c.fromName,
    };
}

export const isMailReady = () => mailerStatus().ready;

let transport = null;
function getTransport() {
    if (transport) return transport;
    const c = mailerConfig();
    transport = nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,          // 465 = 隐式 TLS → true；587 STARTTLS → false
        auth: { user: c.user, pass: c.pass },
        // 单连接串行发送：腾讯对企业邮的并发连接有限制，池子开大反而容易触发风控
        pool: true,
        maxConnections: 1,
        maxMessages: 50,
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
    });
    return transport;
}

/**
 * 真发一封。**不抛异常**，返回 `{ok}` / `{skipped}` / `{ok:false, error}`。
 * @param {{to:string, subject:string, text:string, html?:string, replyTo?:string}} msg
 */
export async function sendMail(msg) {
    const st = mailerStatus();
    const to = String(msg?.to || '').trim();
    if (!to) return { ok: false, error: 'EMPTY_TO' };
    if (!st.ready) {
        console.log(`[mail] 跳过（${st.reason}）：→ ${to} 「${msg.subject}」`);
        return { skipped: true, reason: st.reason };
    }
    const c = mailerConfig();
    try {
        const info = await getTransport().sendMail({
            from: `"${c.fromName}" <${c.user}>`,
            to,
            subject: msg.subject,
            text: msg.text,
            html: msg.html || undefined,
            replyTo: msg.replyTo || c.replyTo || undefined,
        });
        console.log(`[mail] 已发出 → ${to} 「${msg.subject}」 id=${info.messageId || '(无)'}`);
        return { ok: true, messageId: info.messageId };
    } catch (e) {
        // 常见：535 凭据失效（公共邮箱授权码被成员变更作废）、550 收件人不存在、配额超限
        console.error(`[mail] 发送失败 → ${to}：「${e.message}」`);
        return { ok: false, error: e.message };
    }
}

/**
 * 串行队列：请求链路里只入队、不等待（避免 SMTP 抖动把接口拖慢甚至超时）。
 * 每条之间固定间隔，降低触发腾讯频率风控的概率。
 */
const MAIL_GAP_MS = 300;
let chain = Promise.resolve();
export function enqueueMail(msg) {
    const task = chain.then(() => sendMail(msg)).catch((e) => ({ ok: false, error: e.message }));
    chain = task.then(() => new Promise((r) => setTimeout(r, MAIL_GAP_MS)));
    return task;
}
