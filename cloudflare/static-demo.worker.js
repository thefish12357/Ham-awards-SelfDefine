/**
 * Cloudflare Worker：`hamglory.top` 的「静态演示 + 内测已结束」形态
 * ==================================================================
 * 场景（2026-10-07 用户拍板）
 *   暂时**没有服务器**，公网只放**静态演示**：
 *   · 落地页（含「在线演示」的真实渲染示例奖状）＝ 纯前端数据，不需要 API；
 *   · 其余功能（登录 / 注册 / 日志 / 审核 / 校验 …）一律「内测已结束」。
 *
 * 结构（依赖 root 的 `wrangler.toml`）
 *   `[assets] directory = "./dist"` —— Vite 构建产物作为静态资源。
 *   默认行为：**命中静态资源的请求由 Cloudflare 直接返回，不进入本 Worker**
 *   （⇒ 静态请求免费且不限量）；**未命中的路径才调用本 Worker**。
 *
 * 本 Worker 只做三件事
 *   · `/api/*`   → 503 JSON `{"error":"SERVICE_CLOSED"}`（前端据此进入停站模式）
 *   · `/closed`  → 200「内测已结束」说明页
 *   · 其它未命中静态资源的路径 → **404 + 说明页**（别给访客看裸 404）
 *
 * 前端配合
 *   `src/lib/siteMode.js` + `src/app.jsx`：拿到 `SERVICE_CLOSED` 后
 *   把 CTA 与白名单外的 hash 路由都导到 `/closed`。
 *
 * 恢复开放
 *   有了源站后：把这台 Worker 的 Route 删掉（或换回 tunnel 指向），一切照旧。
 *   `demo.hamglory.top` 维持原样（仍由 `closed-notice.worker.js` 全站说明页）。
 *
 * ⚠️ 说明页文案与 `closed-notice.worker.js` 的 `NOTICE_HTML` **是同两份拷贝**：
 *   那份为了能在控制台单文件粘贴而保持自包含，这里不 import 它。**改文案请两处同改**。
 */

// ---- 说明页 HTML（与 closed-notice.worker.js 保持同步）----------------------
const NOTICE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>HamGlory 奖状系统 · 内测已结束</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0A0A0B; color: #e5e7eb; padding: 24px;
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  .card {
    width: 100%; max-width: 520px; padding: 40px 32px; text-align: center;
    background: #141416; border: 1px solid rgba(255,255,255,.07); border-radius: 16px;
  }
  .brand { font-size: 12px; letter-spacing: .22em; color: #22D3EE; }
  h1 { font-size: 24px; margin: 18px 0 14px; font-weight: 800; }
  p { margin: 0; line-height: 1.85; color: #9ca3af; font-size: 14px; }
  .mail { margin-top: 28px; font-size: 12px; color: #6b7280; }
  .mail a { color: #22D3EE; text-decoration: none; }
  .links { margin-top: 28px; padding-top: 22px; border-top: 1px solid rgba(255,255,255,.07); text-align: left; }
  .links-title { font-size: 12px; font-weight: 700; color: #9ca3af; letter-spacing: .08em; margin-bottom: 8px; }
  .links p { font-size: 12px; }
  .links ul { margin: 10px 0 0; padding-left: 18px; }
  .links li { font-size: 12px; line-height: 1.9; color: #9ca3af; }
  .links a { color: #22D3EE; text-decoration: none; word-break: break-all; }
  .links a:hover { text-decoration: underline; }
  .back { display: inline-block; margin-top: 22px; font-size: 12px; color: #22D3EE; text-decoration: none; }
  .back:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main class="card">
    <div class="brand">HAMGLORY AWARDS · 业余无线电奖状系统</div>
    <h1>内测已结束</h1>
    <p>
      本站内测阶段已经结束，系统暂时停止对外服务。<br>
      感谢每一位参与测试的 HAM，恢复开放的时间会另行通知。
    </p>
    <a class="back" href="/">← 查看示例奖状</a>
    <div class="links">
      <div class="links-title">开源与共建</div>
      <p>本项目以 <b>GPL-3.0</b> 开源 —— 欢迎提交 <b>PR / Issue</b>，也欢迎基于它做自己的奖状站。</p>
      <ul>
        <li>本仓库（公开存档）：<a href="https://github.com/thefish12357/Ham-awards-SelfDefine" target="_blank" rel="noreferrer">github.com/thefish12357/Ham-awards-SelfDefine</a></li>
        <li>上游（原作者）：<a href="https://github.com/BH2VSQ/Ham-awards-SelfDefine" target="_blank" rel="noreferrer">github.com/BH2VSQ/Ham-awards-SelfDefine</a></li>
      </ul>
    </div>

    <div class="mail">
      如需联系：<a href="mailto:contact@hamglory.top">contact@hamglory.top</a>
    </div>
  </main>
</body>
</html>`;

const CLOSED_PATH = '/closed';

/** 说明页响应（`status` 可传 404：未知路径时用它，比裸 404 友好） */
const noticeResponse = (status = 200) =>
  new Response(NOTICE_HTML, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

/** 接口统一回 JSON，避免调用方解析一整页 HTML */
const closedApiResponse = () =>
  new Response(
    JSON.stringify({ error: 'SERVICE_CLOSED', message: '本站内测已结束，服务暂时关闭' }),
    {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1) 接口：一律 503（前端 src/lib/siteMode.js 据此进入「停站模式」）
    if (url.pathname.startsWith('/api/')) return closedApiResponse();

    // 2) 说明页：显式路径 + 未知路径都归到它
    if (url.pathname === CLOSED_PATH) return noticeResponse(200);

    // 3) 其它：交给静态资源（命中时其实**不会走到这里**，见文件头说明）
    const res = await env.ASSETS.fetch(request);
    if (res.status === 404) return noticeResponse(404);
    return res;
  },
};
