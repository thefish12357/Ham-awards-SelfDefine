# `cloudflare/` —— 站外「内测已结束」说明页

> 场景：**关闭 cloudflared 隧道 / 关掉本机服务** 之后，希望访客访问 `hamglory.top`
> 或 `demo.hamglory.top` 看到的是「内测已结束」说明页，而不是 Cloudflare 的
> `1033 / 502` 错误页。

核心思路：把说明页交给 **Cloudflare Worker（边缘运行，不需要源站）**。
Worker Route 会在「隧道」类型的 DNS 记录**之前**拦截请求 —— 所以 **不需要改 DNS**，
隧道开着还是关着都生效。

---

## 一、部署（网页控制台，不用装任何工具）

1. 登录 Cloudflare 控制台（用 `hamglory.top` 所在账号）。
2. 左侧 **Workers & Pages** → **Create** → 选 **Worker**（不是 Pages）→ 命名，例如 `closed-notice`。
3. 把 **`closed-notice.worker.js` 的全部内容**粘进编辑器（覆盖默认的 hello world）→ **Deploy**。
4. 进入这个 Worker → **Settings → Domains & Routes → Add → Route**，加两条：

   | Route | Zone |
   |---|---|
   | `hamglory.top/*` | `hamglory.top` |
   | `demo.hamglory.top/*` | `hamglory.top` |

5. 完成。此时**即使隧道/本机全关**，公网访问这两个域名都会看到说明页。

## 二、部署（wrangler CLI，可选）

```bash
npm i -g wrangler
wrangler login
# 单文件 Worker 可直接部署，然后在控制台按上面第 4 步加 Route
wrangler deploy cloudflare/closed-notice.worker.js --name closed-notice
```

> ⚠️ Route 绑定建议在控制台做（`wrangler.toml` 里配 `routes` 需要对 zone 有权限）。

## 三、验证

```bash
# 先把隧道停掉（或本机 node 停掉），再执行：
curl -s -i https://hamglory.top/ | head -n 5          # 期望 HTTP/2 200 + text/html
curl -s    https://hamglory.top/api/system-status     # 期望 {"error":"SERVICE_CLOSED",...} + 503
curl -s -i https://demo.hamglory.top/ | head -n 5
```

⚠️ 本机 curl 直连公网域名要加 `--noproxy '*'`（本机开着 xray 代理）。

## 四、恢复开放

- **首选**：删掉上面两条 Route（或把 Worker 禁用）→ 隧道与站点原样恢复；
- 隧道重新起来后无需任何其他改动。

## 五、注意点

- **管理员调试不受影响**：Worker 只拦公网域名；本机 `http://127.0.0.1:9993` 直连照旧可用。
- 说明页返回 **200**（`no-store`，不会被缓存住）。若希望搜索引擎更快摘除，可把
  `closed-notice.worker.js` 里 HTML 那段的 `status: 200` 改成 `503`。
- **只影响这两个 hostname**；`hamglory.top` 的邮件（MX/SPF，走 `mxbiz*.qq.com`）与
  证书、其它子域都不受影响。
- 免费套餐 Worker 额度（10 万次/天）对这种说明页绰绰有余。
- 想改文案：只改 `closed-notice.worker.js` 里的 `NOTICE_HTML` 然后重新 Deploy。
