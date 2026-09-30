#!/usr/bin/env node
/**
 * SMTP 连通性 / 凭据自检（2026-09-30）
 * ------------------------------------------------------------------
 * **默认不发送任何邮件**：只做「TCP+TLS 能否连上 → EHLO 看服务端能力 →（可选）AUTH 登录」三步。
 * 用于把「邮件发不出去」拆成两段定位：是**连不上/凭据错**，还是**发信被拒（配额/反垃圾）**。
 * 加 `--send-to <地址>` 才会**真的投递一封测试信**（显式 opt-in，避免误发给真人）。
 *
 * 用法（默认读项目根 .env 的 SMTP_*，命令行参数优先）：
 *   node scripts/check-smtp.mjs
 *   node scripts/check-smtp.mjs --auth                       # 额外验证账号密码/授权码
 *   node scripts/check-smtp.mjs --user a@b.com --pass xxx --auth
 *   node scripts/check-smtp.mjs --host smtp.exmail.qq.com --port 465
 *   node scripts/check-smtp.mjs --auth --send-to me@x.com     # 端到端：真投递一封测试信
 *
 * 腾讯企业邮 / 企业微信邮箱参数：
 *   host=smtp.exmail.qq.com  port=465（SSL，隐式 TLS）  user=**完整邮箱地址**  pass=客户端专用密码
 *   公共邮箱同理：user=公共邮箱**完整地址**，pass=**客户端授权码**（公共邮箱没有独立登录密码）
 *
 * ⚠️ 故意用 node 内置 tls 手写 SMTP，不引入 nodemailer：
 *    这样「网络/端口/账号」这层能独立于发信库验证，排障时不会被库的封装遮住原因。
 * ⚠️ 密码永不打印（只回显长度），避免日志/截图泄露。
 */
import tls from 'node:tls';
import '../server/services/loadEnv.js';

// ---------------- 参数解析（命令行 > 环境变量 > 默认） ----------------
const argv = process.argv.slice(2);
const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name) => argv.includes(`--${name}`);

const host = arg('host') || process.env.SMTP_HOST || 'smtp.exmail.qq.com';
const port = Number(arg('port') || process.env.SMTP_PORT || 465);
const user = arg('user') || process.env.SMTP_USER || '';
const pass = arg('pass') || process.env.SMTP_PASS || '';
const wantAuth = flag('auth') || !!arg('pass') || (!!user && !!pass);
/** 端到端投递目标；**不传就不发信**（默认零打扰）。 */
const sendTo = arg('send-to') || '';

console.log(`[检查目标] ${host}:${port}  账号=${user ? user : '(未提供)'}  密码=${pass ? `已提供(${pass.length} 位)` : '(未提供)'}`);
console.log(`[模式] EHLO 能力探测${wantAuth ? ' + AUTH 登录验证' : '（未验证登录，加 --auth 开启）'}${sendTo ? ` + 真投递测试信 → ${sendTo}` : ''}\n`);
if (sendTo && !wantAuth) {
    console.log('⚠️ --send-to 必须先通过 AUTH，请同时加 --auth 并提供账号与密码/授权码');
    process.exit(2);
}

const t0 = Date.now();
const socket = tls.connect({ host, port, servername: host, timeout: 20000 });
let buf = '';
let stage = 'greeting';
let exitCode = 1;
const done = (code, msg) => {
    exitCode = code;
    if (msg) console.log(msg);
    stage = 'closed';  // 之后的 `221 Bye`（QUIT 的响应）不再参与状态机，否则会被当成上一步的失败
    try { socket.write('QUIT\r\n'); } catch { /* 已断开 */ }
    setTimeout(() => { socket.destroy(); process.exit(exitCode); }, 150);
};

socket.on('secureConnect', () => {
    console.log(`✅ TCP + TLS 握手成功（${Date.now() - t0}ms）`);
    console.log(`   协议=${socket.getProtocol()}  证书CN/SAN 校验=${socket.authorized ? '通过' : `未通过（${socket.authorizationError}）`}`);
    console.log(`   对端=${socket.remoteAddress}:${socket.remotePort}\n`);
});

socket.on('timeout', () => done(1, `❌ 超时（${Date.now() - t0}ms 无响应）—— 端口被防火墙/ISP 拦截，或 host 写错`));
socket.on('error', (e) => done(1, `❌ 连接失败：${e.code || ''} ${e.message}`));

socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (/^\d{3} /.test(line)) onReply(line);           // 3 位码 + 空格 = 该响应最后一行
        else if (/^\d{3}-/.test(line)) console.log(`   ${line}`); // 多行响应的续行
    }
});

function onReply(line) {
    if (stage === 'closed') return;   // 已收尾（QUIT 的 221），不再解析
    const code = line.slice(0, 3);
    console.log(`← ${line}`);
    switch (stage) {
        case 'greeting':
            if (code !== '220') return done(1, `❌ 服务端问候码异常：${code}`);
            stage = 'ehlo';
            socket.write(`EHLO ${process.env.SMTP_EHLO_NAME || 'hamglory.top'}\r\n`);
            break;
        case 'ehlo':
            if (code !== '250') return done(1, `❌ EHLO 被拒：${code}`);
            console.log('\n✅ SMTP 服务可用（已拿到能力列表）');
            if (!wantAuth) return done(0, 'ℹ️ 未做登录验证（要验证账号请加 --auth）');
            if (!user || !pass) return done(1, '❌ 要验证登录必须提供 --user 与 --pass（或 .env 的 SMTP_USER / SMTP_PASS）');
            stage = 'authUser';
            socket.write('AUTH LOGIN\r\n');
            break;
        case 'authUser':
            if (code !== '334') return done(1, `❌ 服务端不支持 AUTH LOGIN（${code}）`);
            stage = 'authPass';
            socket.write(`${Buffer.from(user, 'utf8').toString('base64')}\r\n`);
            break;
        case 'authPass':
            if (code !== '334') return done(1, `❌ 用户名被拒（${code}）—— 账号格式必须是**完整邮箱地址**`);
            stage = 'authResult';
            socket.write(`${Buffer.from(pass, 'utf8').toString('base64')}\r\n`);
            break;
        case 'authResult':
            if (code !== '235') {
                // 535 = 认证失败（密码/授权码不对，或该账号未开启 SMTP 服务）
                return done(1, `\n❌ AUTH 失败（${code}）：常见原因 —— ① 用了邮箱登录密码而不是**客户端专用密码/授权码**；`
                    + `② 账号未开启 SMTP 服务（管理员放通服务范围 + 在邮箱网页端开启 IMAP/SMTP）；③ 用户名不是完整邮箱地址`);
            }
            console.log(`\n✅ AUTH 登录成功 —— 地址与密码正确（${Date.now() - t0}ms）`);
            if (!sendTo) return done(0, 'ℹ️ 未投递测试信（要端到端验证请加 --send-to <地址>）');
            console.log(`\n--- 开始真投递 → ${sendTo} ---`);
            stage = 'mailFrom';
            socket.write(`MAIL FROM:<${user}>\r\n`);
            break;
        case 'mailFrom':
            if (code[0] !== '2') return done(1, `❌ MAIL FROM 被拒（${code}）—— 多半是 From 与登录账号不一致，或该账号被限制发信`);
            stage = 'rcptTo';
            socket.write(`RCPT TO:<${sendTo}>\r\n`);
            break;
        case 'rcptTo':
            if (code[0] !== '2') return done(1, `❌ RCPT TO 被拒（${code}）—— 收件地址不存在/拒收，或发件人被反垃圾策略拦下`);
            stage = 'data';
            socket.write('DATA\r\n');
            break;
        case 'data':
            if (code !== '354') return done(1, `❌ DATA 被拒（${code}）`);
            stage = 'dataDone';
            socket.write(buildTestMessage());
            break;
        case 'dataDone':
            if (code[0] !== '2') return done(1, `❌ 投递失败（${code}）—— 常见于触发配额/反垃圾（基础版对外约 500 封/天）`);
            return done(0, `\n✅ 测试信投递成功（整轮 ${Date.now() - t0}ms）\n   收件箱：${sendTo}（若没看到，先翻垃圾箱）`);
        default:
            break;
    }
}

/** 构造一封最小但合规的测试邮件（中文主题/正文都用标准编码，能暴露编码配置错误） */
function buildTestMessage() {
    const now = new Date();
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const headers = [
        `From: =?UTF-8?B?${b64('HamGlory 奖状系统')}?= <${user}>`,
        `To: <${sendTo}>`,
        `Subject: =?UTF-8?B?${b64('SMTP 自检测试信（可忽略）')}?=`,
        `Date: ${now.toUTCString()}`,
        `Message-ID: <check-smtp-${now.getTime()}@${String(user).split('@')[1] || 'localhost'}>`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'X-Mailer: ham-awards/check-smtp',
    ];
    const body = [
        '这是一封来自 HamGlory 奖状系统 SMTP 自检脚本的测试邮件，可以忽略。',
        '',
        `发信账号：${user}`,
        `收件地址：${sendTo}`,
        `发送时间：${now.toISOString()}`,
        '',
        '收到它说明：① 服务器到 smtp.exmail.qq.com:465 的网络与 TLS 正常；',
        '           ② From 与登录账号一致，投递未被反垃圾策略拦截。',
    ].join('\r\n');
    // ⚠️ dot-stuffing：正文里若出现「单独一个 .」的行，必须写成「..」，否则会被当成邮件结束
    const safeBody = body.split('\r\n').map((l) => (l.startsWith('.') ? `.${l}` : l)).join('\r\n');
    return `${headers.join('\r\n')}\r\n\r\n${safeBody}\r\n.\r\n`;
}
