/**
 * Cloudflare Worker：站外「内测已结束」说明页
 * ==================================================================
 * 用途
 *   在 **关闭 cloudflared 隧道 / 关掉本机服务** 之后，让访客访问
 *   `hamglory.top` / `demo.hamglory.top` 仍能看到一个说明页，
 *   而不是 Cloudflare 的 `1033 / 502` 错误页。
 *
 * 原理（为什么关隧道也能用）
 *   Worker 运行在 Cloudflare **边缘**，不依赖任何源站；
 *   Worker Route 会在「隧道」类型的 DNS 记录**之前**拦截请求
 *   —— 所以 **不需要改 DNS**，隧道开或关都一样生效。
 *
 * 绑定（zone = hamglory.top，两条都要加）
 *   hamglory.top/*
 *   demo.hamglory.top/*
 *   详细步骤见同目录 README.md
 *
 * 行为
 *   · `/api/*`  → 503 JSON（避免接口调用方拿到一整页 HTML）
 *   · 其它路径  → 200 说明页（`cache-control: no-store`，防止被缓存住）
 *
 * 恢复
 *   删掉上面两条 Route（或禁用本 Worker）即可，隧道与站点原样恢复。
 *   管理员仍可用 `http://127.0.0.1:9993` 直连本机调试，不受本 Worker 影响。
 *
 * ⚠️ 想改成「维护中」而不是「已结束」，只改下面这段 HTML 文案即可。
 */

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
    <div class="mail">
      如需联系：<a href="mailto:contact@hamglory.top">contact@hamglory.top</a>
    </div>
  </main>
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 接口路径回 JSON，避免调用方解析 HTML
    if (url.pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ error: 'SERVICE_CLOSED', message: '本站内测已结束，服务暂时关闭' }),
        {
          status: 503,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        },
      );
    }

    return new Response(NOTICE_HTML, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  },
};
