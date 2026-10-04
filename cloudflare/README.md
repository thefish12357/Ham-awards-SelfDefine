# `cloudflare/` —— 站外「内测已结束」说明页

> 场景：**关闭 cloudflared 隧道 / 关掉本机服务** 之后，希望访客访问 `hamglory.top`
> 或 `demo.hamglory.top` 看到的是「内测已结束」说明页，而不是 Cloudflare 的
> `1033 / 502` 错误页。

核心思路：把说明页交给 **Cloudflare Worker（边缘运行，不需要源站）**。
Worker Route 会在「隧道」类型的 DNS 记录**之前**拦截请求 —— 所以 **不需要改 DNS**，
隧道开着还是关着都生效。

---

## 一、部署（网页控制台，不用装任何工具）

> ⚠️ **容易卡住的一点**：这个入口**不在域名页左侧栏**（那里只有「管理账户」那类），
> 而在**账号级**。直接开 `https://dash.cloudflare.com/?to=/:account/workers-and-pages` 最快；
> 或点左上角账号名进账号级导航找 **Workers 和 Pages**。

1. 登录 Cloudflare 控制台（用 `hamglory.top` 所在账号）。
2. 账号级 **Workers 和 Pages** → 右上 **创建应用程序 / Create** → 选 **从 Hello World! 开始**。
   - ⚠️ **不要**选 `Connect GitHub` / `Connect with GitLab` / `Upload your static files`，也不用点
     「继续前往 Pages / 旧版 Pages 工作流」——那些是 CI / Pages 路线，我们要的是 **Worker**。
3. 填 Worker 名称（如 `closed-notice`）→ 点 **部署 / Deploy**。
   - 创建流程里那段 **Worker preview 代码是只读的，删不掉也改不了**（正常现象，别在这改）。
4. 部署完成后进入该 Worker 详情页 → **编辑代码 / Edit code** → **全选删除**示例代码 →
   粘贴 `closed-notice.worker.js` 的**全部内容** → 再点 **部署 / Deploy**。
   - 粘贴时务必**整段替换**（从 `/**` 到文件末尾的 `};`），漏掉闭合的 `` ` `` 或 `};` 会部署失败。
5. **先在 workers.dev 上验证**（此时还没动 DNS/路由）：打开
   `https://<worker名>.<账号子域>.workers.dev/`（本项目子域是 `thefish12357`，
   即 `https://closed-notice.thefish12357.workers.dev/`）→ 应看到「内测已结束」页；
   再试 `/api/xxx` → 应返回 503 的 `{"error":"SERVICE_CLOSED",...}`。
6. 验证 OK 后，回到**域名页** `hamglory.top` → **Workers 路由 → 添加路由**，加两条：

   | Route | Zone |
   |---|---|
   | `hamglory.top/*` | `hamglory.top` |
   | `demo.hamglory.top/*` | `hamglory.top` |

7. 完成。此时**即使隧道/本机全关**，公网访问这两个域名都会看到说明页。

## 二、部署（wrangler CLI，可选）

```bash
npm i -g wrangler
wrangler login
# 单文件 Worker 可直接部署，然后在控制台按上面第 6 步加 Route
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

- ⚠️ **路由建了但不生效？** 若「Worker」列显示 **「Workers 已在此路由上禁用」**，
  说明这条路由**没绑定 Worker**（只是建了 pattern）。点该行右侧 **编辑** → 在 **Worker**
  下拉里选 `closed-notice` → 保存。两条都要选。绑定后 Worker 列会显示 `closed-notice`。
- 路由的 Worker 下拉里找不到 `closed-notice` 时：确认当前在**建 Worker 的那个账号**下，
  且 Worker 已部署成功（能打开 `https://closed-notice.<子域>.workers.dev/` 即成功）。

- **管理员调试不受影响**：Worker 只拦公网域名；本机 `http://127.0.0.1:9993` 直连照旧可用。
- 说明页返回 **200**（`no-store`，不会被缓存住）。若希望搜索引擎更快摘除，可把
  `closed-notice.worker.js` 里 HTML 那段的 `status: 200` 改成 `503`。
- **只影响这两个 hostname**；`hamglory.top` 的邮件（MX/SPF，走 `mxbiz*.qq.com`）与
  证书、其它子域都不受影响。
- 免费套餐 Worker 额度（10 万次/天）对这种说明页绰绰有余。
- 想改文案：只改 `closed-notice.worker.js` 里的 `NOTICE_HTML` 然后重新 Deploy。
