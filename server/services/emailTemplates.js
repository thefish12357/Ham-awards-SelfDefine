/**
 * 邮件正文模板（2026-09-30）
 * ------------------------------------------------------------------
 * 纯函数：`{subject, text}` —— 只做纯文本正文。
 *
 * 为什么先只发**纯文本**：企业邮对外发信有反垃圾策略，「纯文本 + 明确链接」比
 * 「HTML 里塞隐藏文字/图片」更容易过检；而且找回密码这种邮件本来也不需要排版。
 * 真要 HTML 时，在 `sendMail` 里补 `html` 字段即可（签名不用改）。
 *
 * ⚠️ 文案里**刻意不写「点不动就复制到浏览器」之外的任何诱导**，也不放短链 ——
 *    避免被判定为钓鱼特征；链接一律是本站公网地址（PUBLIC_BASE_URL）。
 */

/**
 * 统一的邮件签名。
 * ★ 2026-09-30 追加：发信账号是 `no-reply@`（**只发不收**，回信没人看）。
 *   所以签名里必须给出**求助入口** —— 否则等于把用户堵死。
 *   优先用 `SMTP_REPLY_TO`（本站配的是公共邮箱 `contact@hamglory.top`）；
 *   没配时退化为「回信本邮件」（此时 sendMail 不带 Reply-To，回信进 no-reply 邮箱，
 *   由运维自行评估是否需要配置）。
 */
const helpEmail = () => String(process.env.SMTP_REPLY_TO || '').trim();

const sign = () => {
  const help = helpEmail();
  return [
    '',
    '——',
    'HamGlory 业余无线电奖状系统',
    '（本邮件由系统自动发送，请勿直接回复本地址）',
    help ? `如遇问题需要人工协助，请写信到 ${help}` : '如遇问题需要人工协助，请联系本站管理员',
  ].join('\r\n');
};

/** 注册后的邮箱验证 */
export function verifyEmailTemplate({ callsign, link }) {
  return {
        subject: '【HamGlory 奖状系统】请验证你的邮箱',
        text: [
            `${callsign || '火腿'}，你好：`,
            '',
            '感谢注册 HamGlory 业余无线电奖状系统。请点击下面的链接完成邮箱验证：',
            '',
            link,
            '',
            '链接 24 小时内有效，只能使用一次。',
            '验证完成后即可正常登录、导入通联日志与申领奖状。',
            '',
            '如果这不是你本人的操作，忽略本邮件即可（不验证就无法登录该账号）。',
            sign(),
        ].join('\r\n'),
    };
}

/** 找回密码 */
export function resetPasswordTemplate({ callsign, link }) {
    return {
        subject: '【HamGlory 奖状系统】重置密码',
        text: [
            `${callsign || '火腿'}，你好：`,
            '',
            '我们收到了重置该账号密码的请求。请点击下面的链接设置新密码：',
            '',
            link,
            '',
            '链接 30 分钟内有效，只能使用一次；设置成功后其它设备上的登录会立即失效。',
            '',
            '如果这不是你本人的操作，忽略本邮件即可，你的密码不会被改动。',
            sign(),
        ].join('\r\n'),
    };
}

/**
 * 站内通知 → 邮件转发（2026-09-30）
 * ------------------------------------------------------------------
 * 由 `server/services/notifyEmail.js` 调用。文案刻意保持「标题 + 站内通知原文 + 入口」，
 * 与铃铛里的内容一致，避免用户在两处看到不同说法。
 *
 * @param {{callsign?:string, title:string, body:string, link?:string}} p
 */
export function notificationTemplate({ callsign, title, body, link }) {
    const lines = [
        `${callsign || '火腿'}，你好：`,
        '',
        String(body || '').trim(),
        '',
    ];
    if (link) lines.push(`查看详情：${link}`, '');
    lines.push(
        '你收到本邮件是因为在「用户中心 → 邮件提醒」中开启了邮件通知。',
        '不想再收信可以随时在那里关闭（站内通知不受影响）。',
        sign(),
    );
    return {
        subject: `【HamGlory 奖状系统】${title}`,
        text: lines.join('\r\n'),
    };
}
