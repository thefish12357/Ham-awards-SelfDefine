# ROADMAP — 业余无线电奖状申请与管理平台

> 基础：上游 `BH2VSQ/Ham-awards-SelfDefine` v2.2.0（GPL-3.0）+ 本仓库的 Docker 化改造
> 起草日期：2026-09-21
> 配套文档：`AGENTS.md`（项目约定与雷区）、`DOCKER.md`（部署）

---

## 0. 现状核对（读码结论，含对 AGENTS.md 的更正）

### 0.1 ⚠️ 更正：本项目**没有**路由

- `src/app.jsx` 中检索 `hash` / `location.hash` **零命中**，`package.json` 无 `react-router`。
- 实际"路由"是 `App` 组件（1985–2260 行）里的两个 state：`view`（`loading|install|auth|main`）与 `subView`（14 个菜单 id），渲染靠 `{subView === 'xxx' && <Comp/>}` 条件分发。
- 因此 `AGENTS.md` §2「Hash 模式 / 后台入口 `/#/admin`」、§6「`/api/system-status` 返回 adminPath」的表述**与实际不符**：`adminPath` 只被写进 `config.json` 并被 `/api/system-status` 回显，**前端从未使用**，任何 URL 都进同一个入口。
- 后果：**页面无法分享链接、刷新会回到概览页**。这是后续做「奖状校验页 / 分享链接」时必须先补的能力。

### 0.2 能力盘点

| 项 | 现状 |
|---|---|
| 日志来源 | 只有 ADIF 文件上传（`POST /api/logbook/upload`），依赖用户自己导出 |
| 奖状模板 | `awards.layout` 字段存在但恒写 `[]`；`AwardDesigner` 只能裁剪底图，**没有元素布局能力** |
| 奖状产出 | 纯 HTML/CSS 卡片，**无 PDF**，无下载 |
| 实物材料 | 完全不存在 |
| 登录 | 仅本站账号 + TOTP 2FA |
| 底图上传 | 唯一入口在 `AwardDesigner` step 3（`src/app.jsx:1493-1497`） |
| 图片存储 | MinIO 单桶 `ham-awards`，**桶策略为公开读** |
| 前端构建 | Tailwind 走外网 CDN；`devDependencies` 里已有 `tailwindcss/postcss/autoprefixer` 但**无配置文件**（原计划本地构建，未落地） |
| 本地环境 | `node_modules` 不存在，说明尚未在本机跑起来过 |

### 0.3 `src/install.jsx` 是死代码

`app.jsx` 第 3 行的 import 被注释，`install.jsx` 无人引用（`app.jsx` 内自带同名 `InstallView`）。规划中可删，避免两处修改。

---

## 1. 需求 → 技术方案

### 1.1 需求①：免上传日志，直接读 LoTW（不落服务器）

#### 技术事实（已核实 ARRL 官方文档 + BetterLoTW 源码）

- 端点：`https://lotw.arrl.org/lotwuser/lotwreport.adi`，**HTTP GET**，参数全在 query string。
- 必需参数：`login`、`password`、`qso_query=1`。
- 关键参数：

| 参数 | 值 | 说明 |
|---|---|---|
| `qso_qsl` | `yes`/`no` | `yes`=只返回已确认 QSL；`no`=返回全部已上传 QSO |
| `qso_qslsince` | `1900-01-01` | **只对 `qso_qsl=yes` 生效**，取"收到/更新"时间戳（不接受上界） |
| `qso_qsorxsince` | `1900-01-01` | **只对 `qso_qsl=no` 生效** |
| `qso_startdate` / `qso_enddate` | `YYYY-MM-DD` | QSO **通联日期**窗口，两种报表都有效 → **分批必须用这两个** |
| `qso_qsldetail` | `yes` | 返回对方 DXCC / COUNTRY / GRID / STATE / CQZ / IOTA（仅 `QSL_RCVD=Y` 的记录有） |
| `qso_mydetail` | `yes` | 返回 `MY_*` 本站位置字段 |
| `qso_owncall` | 呼号 | 多呼号账号下筛选本站呼号 |
| `qso_withown` | `yes` | 附加 `STATION_CALLSIGN` |

- 失败时返回 **HTML 错误页**而非 ADIF → 用「缺少 `<EOH>` 头结束标记」判定失败。
- **浏览器不能直连**：LoTW 不返回 CORS 头。BetterLoTW 是为此专门部署了一个 Cloudflare Worker 做代理（POST `/sync`，凭据单次转发不存储）。
- 重要限制：`qso_qsl=no`（全量 QSO）**不含 DXCC / COUNTRY / GRID / STATE**。想按 DXCC/州/网格判定奖状，**只能**用 `qso_qsl=yes` 报表。
  → 结论：与 BetterLoTW 一致，**串行拉两份报表**（`qsl` + `qso`），在服务端按 `APP_LoTW_QSO_TIMESTAMP` 合并。

#### 采纳方案：服务端**内存会话代理**（不落盘、不落库、可主动清除）

```
POST /api/lotw/connect   { login, password, ownCall?, from?, to?, includeAllQso }
   → 服务端串行拉 LoTW（服务端 fetch，绕开浏览器 CORS）
   → 按 <EOR> 流式分块解析，只保留奖状判定需要的字段，其余丢弃
   → 结果存进程内 Map<sessionId, {records, bytes, createdAt, lastAccess}>
   → 返回 { sessionId, quota, qsoCount, qslCount, fields, expiresAt }
POST /api/lotw/evaluate  { sessionId, awardId }   → 复用奖状判定引擎 → 进度/达标结果
POST /api/lotw/apply     { sessionId, awardId }   → 只落库「申请记录 + 分数快照」，QSO 不落库
DELETE /api/lotw/session { sessionId }            → 主动清除
```

**"不保存在服务器上"的落实措施（必须全部做到）**

1. 凭据只出现在请求体，**不写 config、不写日志、不进 DB**；进程内用完立即置空变量。
2. ADIF 原文只在内存里短暂存在，**解析后即丢弃**，只留精简字段数组（约 100 byte/QSO）。
3. 内存会话 TTL 默认 **30 分钟**（`lotw.cacheTtlMinutes` 可配）+ 每分钟 GC + 容量上限（默认 `lotw.maxMemoryMb=64`，超限拒绝新会话）。
4. 前端关闭/切走时用 `navigator.sendBeacon('/api/lotw/session')` 通知服务端立刻删除。
5. 进程重启即全清（内存态天然满足）。
6. 给用户一个可视化的「当前临时会话」状态条 + 手动「立即清除」按钮。
7. **不做**"自动把 LoTW 日志导入本站库"的隐式行为；用户想长期保存仍走原有 `/logbook/upload`，两条路径明确分开。

**分批与超时**

- BetterLoTW 的经验值：单批 ADIF 超过 **12 MiB** 就按日期二分重试。我们做成 `lotw.batchMaxBytes`（默认 12 MiB），服务端自动二分，最多重试 5 层。
- 单次上游超时 `lotw.timeoutMs`（默认 90s）；整体任务上限 `lotw.maxTotalMs`（默认 10 min），超时返回部分结果并提示缩小日期范围。
- 建议前端提供"最近 N 年 / 自定义范围"选择，避免一上来就拉全量。

**合规（照搬 HamCQ Echo 的做法）**

首次使用前弹「数据出境提示」：说明 LoTW 接收方为 ARRL（美国）、出境目的、字段范围、保存期限、用户可撤回。用户勾选同意后才允许调用。文案可参考 `echo.hamcq.cn/update`。

**配置项（`config.json` 新增 `lotw` 段）**

```json
"lotw": {
  "enabled": true,
  "proxyMode": "server",            // server | external
  "externalProxyUrl": "",           // 若用户自建 Cloudflare Worker，可切到外部代理
  "timeoutMs": 90000,
  "batchMaxBytes": 12582912,
  "maxTotalMs": 600000,
  "cacheTtlMinutes": 30,
  "maxMemoryMb": 64
}
```

> `externalProxyUrl` 是给"不想把凭据过我们服务器"的部署方留的开关，直连 Worker 后浏览器侧解析、零服务端留存。

---

### 1.2 需求②：自定义奖状模板 + 拖拽式设计器

#### 布局 Schema（写进 `awards.layout` JSONB，`v:2`）

单位统一用 **毫米（mm）**，画布默认 **A4 横版 297×210 mm**，PDF 端可直接换算，无 DPI 歧义。

```json
{
  "v": 2,
  "canvas": { "w": 297, "h": 210, "bgUrl": "http://.../bg.jpg", "bgFit": "cover", "bgOpacity": 1 },
  "elements": [
    { "id": "e1", "type": "text", "binding": "callsign", "text": "CUSTOM",
      "x": 40, "y": 96, "w": 217, "h": 18,
      "font": "NotoSansSC", "size": 14, "weight": 700, "color": "#111827",
      "align": "center", "valign": "middle", "letterSpacing": 0, "rotation": 0, "opacity": 1, "z": 1 },
    { "id": "e2", "type": "image", "src": "http://.../seal.png",
      "x": 20, "y": 160, "w": 30, "h": 30, "opacity": 0.9, "z": 2 },
    { "id": "e3", "type": "qrcode", "binding": "verifyUrl",
      "x": 250, "y": 175, "w": 25, "h": 25, "z": 3 },
    { "id": "e4", "type": "shape", "shape": "rect",
      "x": 10, "y": 10, "w": 277, "h": 190, "stroke": "#c8a45c", "strokeWidth": 0.8, "fill": "none" }
  ]
}
```

**可绑定字段**（`binding`）：`callsign`、`awardName`、`level`、`serial`、`issueDate`、`score`、`issuer`、`verifyUrl`、`description`，以及 `custom`（固定文字）。

#### 编辑器实现

- 结构：左侧元素面板（添加文字/图片/二维码/形状）→ 中间画布 → 右侧属性面板。
- 画布：外层按容器宽度对 297mm 做等比缩放（`transform: scale`），元素绝对定位用 `mm × pxPerMm`；拖拽只改元素数据，不改渲染逻辑。
- **拖拽用 Pointer Events**（`onPointerDown/Move/Up` + `setPointerCapture`），鼠标与触屏一套代码；不用 HTML5 Drag and Drop（移动端不可用）。
- 缩放手柄：8 个（四角 + 四边）；`Alt` 拖拽按中心缩放；`Shift` 锁定比例。
- 方向键微调（`Shift` 加速）；网格吸附（可开关）+ 对齐参考线；图层上移/下移/置顶；复制/删除；撤销/重做（history 栈，`Ctrl+Z/Ctrl+Shift+Z`）。
- 底图：上传后直接用同一套拖拽/缩放手柄定位（**替换现在的三个 slider**，体验差且精度低）。
- 预览即"所见即所得"：编辑器画布与「我的奖状」展示、PDF 渲染**共用同一个 schema 与同一个 React 渲染组件**，杜绝三处实现漂移。

#### 权限与模板复用

- 仅 `award_admin` / `admin` 可用设计器。
- 建议新增 `is_template BOOLEAN` + `template_from INTEGER`：允许把一个奖状的布局另存为模板给其他奖状复用（避免每个奖状都从头拖）。
- 底图与素材（印章、边框 PNG）统一传 MinIO，建议独立前缀 `templates/`，并记录 `uploaded_by` 便于清理。

---

### 1.3 需求③：奖状导出 PDF

两条路线，**建议先做 A，再做 B**：

#### A. 客户端栅格化（快、零字体成本，先落地）

- `html-to-image`（或 `html2canvas`）把奖状 DOM 按 **300 DPI**（3508×2480 px）渲染成 PNG → `jsPDF` 按 A4 横版铺满 → 下载。
- 优点：所见即所得，**中文零成本**（浏览器自己渲染），无需服务端字体。
- **前置运维动作（必须做，否则必失败）**：canvas 会被跨域图片 taint，需要给 MinIO 桶加 CORS 规则（`AllowedOrigin` = 本站域名或 `*`、`GET`、`AllowedHeader: *`）。当前桶策略只有公开读，**没有 CORS 配置**。
- 缺陷：文字是位图（放大会糊）、文件偏大（约 2–5 MB）、不适合服务端批量。

#### B. 服务端矢量（正式方案 + 批量导出）

- `pdf-lib` + `@pdf-lib/fontkit`，按同一份 schema 直接绘制：底图 `drawImage`、文字 `drawText`、二维码用现有 `qrcode` 依赖生成 PNG buffer。
- 需要 **CJK 字体文件**：`NotoSansSC`（OFL 许可，与 GPL-3.0 项目兼容）。全量约 10 MB，建议用 `fonttools`（`pyftsubset`）子集化到常用 3500 字 + 拉丁，压到 1–2 MB，放 `assets/fonts/`。
- 收益：矢量文字、可搜索、体积小（< 300 KB）、**可在 PDF 内叠加防伪层**（水印、序列号微缩文字）、支持管理员批量 `zip` 导出。
- 接口：`GET /api/user/my-awards/:id/pdf`（校验归属）、`POST /api/admin/awards/:id/pdf-batch`（返回 zip）。

#### 配套：公开校验页（强烈建议同步做）

- 新表 `awards_issued` 已有 `serial_number`；新增公开接口 `GET /api/verify/:serial` 返回：奖状名、等级、持有人呼号（可脱敏 `BH2***Q`）、签发日期、状态。
- PDF 与网页上生成二维码指向 `{BASE_URL}/verify/{serial}`。
- **这一步会倒逼补上路由能力**（当前刷新即回概览页），见 §4.1。

---

### 1.4 需求④：实物卡片上传 + 管理员审核 + 审核后删图

#### 关键设计点：**必须用私有桶**，不能复用现在的公开读桶

当前 `ham-awards` 桶策略是 `s3:GetObject` 对 `*` 开放，QSL 卡片照片属于用户个人信息（含地址、印章），**放进去等于全网公开**。

方案：

1. 新建私有桶 `ham-awards-evidence`（不设 public policy）。
2. 管理员查看用 **presigned GET URL**（有效期 15 分钟），URL 不落库、不返回给申请人。
3. 上传用 `multer` 的 **memoryStorage**（不落本地磁盘），限制 `5 MB` + `image/*`，并校验 magic bytes。
4. **自动清理（双保险）**：
   - 业务层：审核 `approve`/`reject` 后**立即** `removeObject`，DB 里把 `object_key` 置空并记 `purged_at`；DB **只保留审核结论**，不保留图片。
   - 兜底层：给桶配 MinIO ILM 生命周期规则 `expiry` = 7 天，防止"审核中途放弃"的孤儿图片长期占空间。
5. 用户侧提供"我上传过的材料"列表，只显示状态，不显示图片 URL。

#### 数据表

```sql
CREATE TABLE IF NOT EXISTS award_evidence (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  award_id INTEGER REFERENCES awards(id) ON DELETE CASCADE,
  user_award_id INTEGER REFERENCES user_awards(id) ON DELETE CASCADE,
  type VARCHAR(20) DEFAULT 'qsl_card',      -- qsl_card | lotw_record | other
  note TEXT,
  object_key TEXT,                          -- 置空 = 已删除
  mime VARCHAR(64),
  bytes INTEGER,
  sha256 CHAR(64),
  status VARCHAR(20) DEFAULT 'pending',     -- pending | approved | rejected
  reviewer_id INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  reject_reason TEXT,
  purged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 与判定引擎打通

- `awards.rules.basic` 增加 `acceptPhysicalQsl BOOLEAN`：勾选后，`QSL Required` 的判定条件从「LoTW 确认」扩展为「LoTW 确认 **或** 存在一条 `status='approved'` 的实物材料」。
- 新增管理员页面「材料审核」（`subView='evidence_audit'`）。
- 用户端：在奖状详情弹窗内新增「上传实物卡片」区块。

---

### 1.5 需求⑤：新建奖状图片上传按钮无响应

**先复现，再改**。本地尚无 `node_modules`，需先 `npm install` + 起 db/minio。

代码层面已定位到的可疑点（`src/app.jsx`）：

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| a | `app.jsx:1486` | 上传控件**只在 `step === 3` 渲染**。用户停在第 1/2 步时"没有上传按钮"，现象等同于"按了没反应" | 底图上移到 step 1；或每步都显示 |
| b | `app.jsx:1493-1497` | `<input className="hidden">` 靠**外层 label 隐式关联**触发。做法本身合法，但对 SVG 图标点击、`display:none`、被上层元素遮挡等情况不稳健 | 改 `id` + `htmlFor`，并在 label 上加 `onClick={() => inputRef.current?.click()}` 双保险；`hidden` 换成 `sr-only` |
| c | `app.jsx:1224` + `server.js:943` | `/awards/upload-bg` 在 **MinIO 未配置**时直接 400，或返回的 URL 用了容器内服务名导致浏览器打不开。此时表现是"点了没用/点了报错" | 明确错误文案；`upload-bg` 前先探测 `minioConfigured`（`/api/system-status` 已有该字段） |
| d | `app.jsx:1245` | 所有错误只走 `alert(err.message)`，`err` 是 `{status, error, message}` 对象时可能弹不出内容 | 统一 toast + 兜底取 `err.message \|\| err.error \|\| '未知错误'` |
| e | `server.js:926` | **新建奖状时 `res.json({ success: true })` 不返回新 `id`**，前端无法定位新建对象 | 改为 `RETURNING id` 并回传 |

> 需求②会重写 `AwardDesigner`，届时 a–d 自然解决；e 属于独立的后端缺陷，建议单独先修。

---

### 1.6 需求⑥：HamCQ OAuth2 授权登录

#### 官方规则（来源 <https://forum.hamcq.cn/d/2502>《社区开放 OAUTH2.0 授权登录》，楼主 BG5UWQ）

**能力边界**：**仅网站接入**、**仅 `authorization_code`**、**仅显示授权**（不支持客户端模式 / 密码模式 / 隐式授权）。

**申请方式**：邮件 **`emin@hamcq.cn`**（注意不是站点通用的 `Contact@` 邮箱），社区审核「开发者信息 + 站点情况」后，`client_id` / `client_secret` **随邮件下发**。

**硬性材料清单（8 项，缺一不可）**

| # | 材料 | 要求 |
|---|---|---|
| 1 | 站点名称 | |
| 2 | 站点首页链接 | |
| 3 | 申请业务场景 | **不少于 50 字** |
| 4 | 站点 Logo | **不少于 64×64 px** |
| 5 | 站点介绍 | **10 字以内** |
| 6 | 域名回调地址 | **严格匹配**（授权请求里的 `redirect_uri` 必须与登记值完全一致） |
| 7 | 域名 **ICP 备案**信息 + **公安备案**信息 | ★ **硬门槛**：站点必须已完成这两项备案 |
| 8 | 网站负责人信息 | **姓名、手机号、身份证号码** |

> **决策（2026-09-21）**：用户明确要求**忽略备案与负责人信息类要求，回调地址按本地配置**。
> 因此本需求按**自建 / 自用**场景实现：`redirectUri` 默认指向本机，**官方审核不作为前置条件**。
> 上面 8 项清单保留作为事实记录——若将来要正式过审，需补齐第 7、8 项并换成已备案域名，届时只需改配置。

**接口约定**（帖中示例域名为 `https://example.com` 占位，**真实 API 域名以审核邮件为准**）

| 用途 | 端点 | 关键参数 |
|---|---|---|
| 授权 | `GET /oauth/authorize` | `client_id`、`response_type=code`、`redirect_uri`、`scope`、`state` |
| 换令牌 | `POST /oauth/token` | **表单编码** `application/x-www-form-urlencoded`：`client_id`、`client_secret`、`grant_type=authorization_code`、`code`、`redirect_uri`；亦支持 `grant_type=refresh_token` + `refresh_token` |
| 用户信息 | `GET /api/user?access_token=xxx` | ★ token 走 **query 参数**，不是 `Authorization` 头 |

**用户信息返回字段**

```json
{ "id": 1, "username": "BG5UWQ", "avar_url": "", "email": "", "is_email_confirmed": 1 }
```

- ★ **没有独立的 `callsign` 字段**，`username` 即呼号（社区用户名就是呼号）→ `callsignField` 默认应为 `username`。
- `email` 可能为空（受 scope 影响）→ **不要依赖邮箱做账号合并**。
- `avar_url` 是官方拼写（疑似 `avatar_url`），照抄，不要"顺手纠正"。
- 帖中字段以 `...` 省略，完整字段需以邮件下发的文档为准。

**scope**：帖中仅出现 **`user.read`**，未见完整清单。

#### 本平台实现方案：可配置的 OAuth2 客户端，不硬编码 HamCQ

```
GET  /api/auth/oauth/start
     → 生成一次性 state（+ 可选 PKCE，默认关闭），存内存 Map（TTL 10 min）
     → 302 到 {authorizeUrl}?client_id&response_type=code&redirect_uri&scope=user.read&state
GET  /api/auth/oauth/callback?code&state
     → 一次性消费 state 校验
     → 服务端以 form-urlencoded POST 换 token（带 client_secret，永不下发前端）
     → GET {userInfoUrl}?access_token=xxx → 取 username 作为呼号
     → upsert users → 签发本站 JWT → 302 回 /#/oauth/callback?token=xxx
前端：登录页展示「使用 HamCQ 登录」按钮；未配置 oauth 时自动隐藏
```

**PKCE 默认关闭**：官方 `/oauth/authorize` 参数表**没有 `code_challenge`**，`/oauth/token` 也**没有 `code_verifier`**，说明大概率不支持 PKCE。为避免参数被拒，做成配置项 `usePkce`，默认 `false`，仅靠一次性 `state` 防 CSRF。

**★ 回调地址一律走配置，默认本地**

官方要求 `redirect_uri` 与登记值**严格匹配**。按用户决定，本次实现**默认就配本地回调**：

```json
"redirectUri": "http://localhost:9993/api/auth/oauth/callback"
```

- `redirectUri` 是**配置项**，可用 `OAUTH_REDIRECT_URI` 环境变量覆盖，**绝不硬编码**；
- 将来若要正式过审，只需把该值换成已备案域名下的同一路径，**代码零改动**；
- 在拿到正式凭据前若想先跑通流程，可临时接任意标准 OIDC 提供方（自建 Keycloak 等）。

**★ 账号合并存在冒名接管风险（必须处理）**
`username` 就是呼号，而本站 `users.callsign` 是唯一键 → **任何 HamCQ 用户都能用其呼号命中同名的本站账号**。
因此：OAuth 首次登录时若发现同名账号已存在，**不得直接合并**，必须要求用户输入该账号的本站密码完成绑定；拒绝或密码错误则终止登录，并提示"该呼号已被注册，请先用密码登录后在用户中心绑定 HamCQ"。

**DB 变更**

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_sub VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_raw JSONB;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;   -- 纯 OAuth 用户无密码
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_uniq ON users(oauth_provider, oauth_sub) WHERE oauth_provider IS NOT NULL;
```

> `oauth_sub` 用 HamCQ 返回的 **`id`**（稳定，不随呼号变更），不要用 `username`。

**config.json 新增 `oauth` 段**

```json
"oauth": {
  "enabled": false,
  "provider": "hamcq",
  "label": "使用 HamCQ 登录",
  "clientId": "",
  "clientSecret": "",
  "authorizeUrl": "https://【审核邮件下发】/oauth/authorize",
  "tokenUrl": "https://【审核邮件下发】/oauth/token",
  "userInfoUrl": "https://【审核邮件下发】/api/user",
  "scope": "user.read",
  "callsignField": "username",
  "userSubField": "id",
  "redirectUri": "http://localhost:9993/api/auth/oauth/callback",
  "usePkce": false,
  "tokenRequestFormat": "form"
}
```

**安全要点**：一次性 `state`、`redirect_uri` 严格白名单校验、token 端点只在服务端调用、同名账号必须密码确认后才合并、纯 OAuth 账号禁用密码登录路径、`client_secret` 不进前端 / 不进仓库。

**申请材料（备查）**：`docs/hamcq-oauth-application.md`（按官方 8 项清单逐条对应；当前按「忽略备案」的决策**暂不推进正式申请**）。

**降级**：代码按上述结构写好并以 `enabled:false` 关闭；未开启时登录页不显示按钮。

---

## 2. 数据库变更汇总

| 表 | 变更 |
|---|---|
| `awards` | `layout` 正式启用（v2 schema）；新增 `is_template BOOLEAN`、`template_from INTEGER`、`bg_object_key TEXT`（便于删旧图） |
| `user_awards` | 新增 `pdf_generated_at TIMESTAMP`、`revoked_at TIMESTAMP`、`verify_token VARCHAR(32)`（可选，替代直接用自增 id） |
| `users` | `password_hash` 可空；新增 `oauth_provider` / `oauth_sub` / `oauth_raw` |
| 新表 | `award_evidence`（见 §1.4）、`audit_events`（可选，收敛现有散落各表的 `audit_log`） |
| 索引 | `qsos(user_id, qso_date)`、`qsos(user_id, dxcc)`、`award_evidence(status, created_at)` |
| 迁移 | 现有 `upgradeSchema()` 用 `information_schema` 判列 + `CREATE TABLE IF NOT EXISTS`，**保持这套风格继续追加**即可，暂不引入迁移框架 |

---

## 3. 新增 API 汇总

| API | 方法 | 权限 | 用途 |
|---|---|---|---|
| `/api/lotw/connect` | POST | 登录 | 拉取 LoTW 报表到内存会话 |
| `/api/lotw/evaluate` | POST | 登录 | 用临时会话判定奖状进度 |
| `/api/lotw/apply` | POST | 登录 | 用临时会话申请奖状 |
| `/api/lotw/session` | DELETE | 登录 | 主动清除临时会话 |
| `/api/lotw/session` | GET | 登录 | 查询当前临时会话状态（条数、剩余 TTL） |
| `/api/awards/:id/layout` | PUT | award_admin | 保存模板布局 |
| `/api/awards/templates` | GET/POST | award_admin | 模板列表 / 另存为模板 |
| `/api/user/my-awards/:id/pdf` | GET | 登录 | 下载奖状 PDF |
| `/api/admin/awards/:id/pdf-batch` | POST | admin | 批量导出 zip |
| `/api/verify/:serial` | GET | **公开** | 奖状真伪校验（供二维码） |
| `/api/evidence` | POST | 登录 | 上传实物卡片照片 |
| `/api/evidence/mine` | GET | 登录 | 我的材料列表（不含图片 URL） |
| `/api/admin/evidence` | GET | admin | 待审材料（返回 presigned URL） |
| `/api/admin/evidence/:id/review` | POST | admin | 通过/驳回 → 立即删除对象 |
| `/api/auth/oauth/providers` | GET | **公开** | 已启用的第三方登录方式（前端渲染按钮） |
| `/api/auth/oauth/start` | GET | **公开** | 跳转授权 |
| `/api/auth/oauth/callback` | GET | **公开** | 回调换 token |

---

## 4. 工程改造建议

### 4.1 前端

1. **`src/app.jsx` 2260 行单体已到极限**：新功能一律**放新文件**，不动老代码；`App` 只做最小接入（新增 `subView` 分支）。
2. 目录约定：

```
src/
├── app.jsx                    # 保留，仅最小改动
├── lib/apiFetch.js            # 从 app.jsx 抽出统一请求封装（含 toast 化错误）
├── lib/awardLayout.js         # layout schema 校验 / 默认值 / 单位换算
├── components/AwardRenderer.jsx   # ★ schema → DOM（预览、我的奖状、校验页共用）
├── components/award-designer/     # 编辑面板、画布、属性面板、拖拽 hook
├── components/pdf/                # 客户端导出（html-to-image + jsPDF）
└── pages/                         # 新页面：材料审核、模板库、校验页、数据与隐私
```

3. **Tailwind 从 CDN 换成本地构建**（`devDependencies` 里依赖已装，只差 `tailwind.config.js` + `postcss.config.js` + `index.css` 的指令）。理由：拖拽设计器需要大量动态类、离线部署不能依赖外网 CDN、生产可靠性。**这会改变 `Dockerfile` 构建阶段与 `index.html`**，需同步更新 `AGENTS.md`/`DOCKER.md`。
4. **补 Hash 路由**（`hashchange` 监听即可，不必引 react-router）：让 `subView` 与 `location.hash` 双向同步，使校验页/分享链接/刷新保持可用。这是 §1.3 校验页的前置。

### 4.2 后端

`server.js` 已 1168 行，建议**新增文件而不重写**：

```
server/
├── services/lotwClient.js    # LoTW 拉取 + 流式 ADIF 解析 + 内存会话
├── services/awardEngine.js   # 把 evaluateAward 抽出，数据源可插拔（DB / 内存）
├── services/pdfRenderer.js   # pdf-lib 渲染
├── services/storage.js       # MinIO 公共桶 / 私有桶 + presigned + ILM
└── routes/{lotw,evidence,oauth,awardsPdf,verify}.js
```

`server.js` 顶部 `app.use('/api/lotw', lotwRouter)` 之类挂载即可，`evaluateAward` 保持向后兼容。

### 4.3 依赖新增

| 包 | 用途 | 许可 |
|---|---|---|
| `pdf-lib` + `@pdf-lib/fontkit` | 服务端矢量 PDF | MIT |
| `html-to-image` | 客户端栅格化导出 | MIT |
| `jspdf` | 客户端组 PDF | MIT |
| `archiver` | 批量导出 zip | MIT |
| （字体）Noto Sans SC 子集 | PDF 中文 | OFL |

> `sharp` 暂不引入：图片裁剪目前在浏览器端用 canvas 完成，够用。

### 4.4 顺手修正

- `package.json` 补 `"license": "GPL-3.0"`（上游已确认 GPL-3.0）。
- 删除死代码 `src/install.jsx`。
- `server.js:992` 奖状序列号从 `Math.random()` 改为 `crypto.randomInt()`（非密码学安全）。
- `jwt.verify` 显式指定 `{ algorithms: ['HS256'] }`。
- `cors()` 收敛到配置的 origin 白名单。
- `index.html` 的 `/vite.svg` 404：补 `public/` 或删引用。

---

## 5. 里程碑与交付顺序

| 里程碑 | 内容 | 依赖 | 预估 |
|---|---|---|---|
| **M0 基础设施** | `npm install` 跑通本地环境；Tailwind 本地构建；补 hash 路由；目录骨架；修 §1.5-e（新建奖状不返回 id）；统一 toast 错误 | 无 | 0.5–1 天 |
| **M1 LoTW 免上传** | `lotwClient` + 内存会话 + 分批拉取 + 出境提示 + `/api/lotw/*`；奖状判定引擎改为可插拔数据源；前端"连接 LoTW"流程 | M0 | 2–3 天 |
| **M2 模板设计器** | layout schema v2 + `AwardRenderer` + 拖拽画布 + 属性面板 + 撤销重做；一并解决 §1.5 a–d | M0 | 3–4 天 |
| **M3 PDF + 校验页** | 客户端导出（M3a）→ 服务端矢量 + 字体子集（M3b）；公开校验页 + 二维码 | M2 | 2–3 天 |
| **M4 实物材料** | 私有桶 + CORS/ILM、`award_evidence` 表、上传/审核/即删、与判定引擎打通 | M0 | 1–2 天 |
| **M5 HamCQ 登录** | 通用 OAuth2/OIDC 客户端（先 `enabled:false` 落地）→ 拿到凭据后开通 | M0 + HamCQ 凭据 | 1 天 + 等外部 |

**建议顺序：M0 → M1 → M2 → M3 → M4 → M5**。
理由：M1 是"从工具变成平台"的核心差异点且逻辑独立；M2/M3 强耦合（同一份 schema）；M4 独立可并行；M5 卡外部审批，代码可以先写好挂着。

### 5.1 实施进度

| 里程碑 | 状态 | 交付与验证 |
|---|---|---|
| M0 基础设施 | ✅ 完成（2026-09-21） | Tailwind 本地化、Hash 路由、`src/lib/` 骨架、`POST /api/awards` 返回 id、删死代码、补 favicon、补 license。Playwright 验证：刷新保持页面、越权路由回落、Tailwind 计算样式生效、CDN 警告消失 |
| M1 LoTW 免上传 | ✅ 完成（2026-09-21） | 新增 `server/services/{adif,awardEngine,lotwClient,lotwSessions}.js`、`server/routes/lotw.js`、`src/pages/LotwImportView.jsx`；`server.js` 去掉内联解析与判定逻辑改为复用引擎。验证：真实打 LoTW（错误凭据）→ 正确识别为 `LOTW_AUTH`；内存会话 TTL/容量生效；接口级与 UI 级均通过 |
| M2 模板设计器 | ✅ 完成（2026-09-21） | 新增 `awardLayout.js` / `AwardRenderer.jsx` / `VisualDesigner.jsx`；Step 3 换成可视化拖拽编辑器（文字/形状/图片/二维码、属性面板、图层、撤销重做、底图上传）；删除旧裁剪逻辑；顺带修复需求⑤（上传按钮无响应）。验证：设计器三栏渲染、添加文字元素、上传底图到 MinIO、保存后 `layout.v=2 + 1 元素 + bg` 正确落库 |
| M3 PDF + 校验页 | ✅ 完成（2026-09-21） | 新增 `exportAwardPdf.js`（离屏渲染 → 300 DPI 栅格化 → jsPDF，按需加载）、`VerifyView.jsx`（公开校验页，`App` 在登录前拦截 `#/verify/<serial>`）、服务端 `/api/verify/:serial` + `/qr` + `/api/media`（同源图片代理，绕开 canvas 跨域污染）。验证：校验接口返回脱敏信息、二维码为合法 PNG、非法 key 被拒 400、导出 PDF 为 109023 字节且 MediaBox=297×210mm（A4 横版、1 页） |
| M4 实物材料 | ✅ 完成（2026-09-22） | 私有桶 `ham-awards-evidence`（自动创建、不设公开读）+ `award_evidence` 表 + `server/routes/evidence.js`（上传 memoryStorage 5MB + magic bytes / mine / admin 待审+presigned 15min / 审核即删 removeObject）+ 前端上传区块与 `EvidenceAuditView` 审核页；审核权限按奖状归属（award_admin 只审自己创建的奖状）。**遗留 3 项见 §8** |
| M5 HamCQ 登录 | ✅ 完成（2026-09-22，真实联调通过） | 通用 OAuth2 客户端 + `#/oauth/complete` 补全呼号流程（HamCQ 用户名≠呼号）+ logo；commit `8b42fcc` 已推存档仓库 |

**M1 期间顺带修掉的一个上游遗留缺陷**：`apiFetch` 原本把**所有** 401 都当作「登录过期」并强制登出重载。而 `/api/user/password`（旧密码错误）、`requirePassword`（密码确认失败）、`/api/user/2fa/disable`（密码错误）都返回 401，导致这些**正常业务错误会把用户踢出登录**。现已改为只在 `TOKEN_MISSING` / `TOKEN_INVALID` 时登出。这也是 LoTW 凭据错误刻意返回 400 的原因。

### 5.2 实机体验反馈修复（M3.1，2026-09-21）

用户实际使用后提出三项，**决定立即修而不是攒到最后**（地基类问题越往后越贵；M4/M5 相互独立，晚做无额外成本）。

| # | 反馈 | 处理 |
|---|---|---|
| 1 | 登录页密码框看不到输入内容，希望加「眼睛」图标 | 新增 `PasswordInput` 组件（显隐切换 + 显式 `autoComplete`），登录 / 注册 / 用户中心（改密码、危险操作确认）全部换用。验证：`type` 在 password↔text 间正确切换，`autocomplete="current-password"` 已生效 |
| 2 | 管理员审核奖状时看不到实际生成效果，希望保留原预览图并新增「用户实际看到的样子」（在线预览 + 下载样式） | `AwardDetailModal` 左侧新增**「实际效果 / 设计底图」切换**（原底图预览保留），实际效果用 `ResponsiveAwardRenderer` + 示例数据渲染；管理员/奖状管理员额外提供**「下载效果 PDF」**。验证：切换器与按钮均在，预览里渲染出 4 个布局元素 + 二维码 |
| 3 | 多等级奖状的元素差异没有考虑，希望能在元素上设置 | 引入 **`levelOverrides`**：元素可按等级覆盖任意属性；`AwardRenderer` 统一按 `data.level` 合并（所有消费方自动生效）；编辑器新增「编辑范围」选择器（默认 / 各等级）+ 覆盖标记 + 清除覆盖。验证：切到 Gold 后颜色 `#a16207→#eab308`、高度 33.94→56.56px、位置上移，元素列表出现覆盖标记、属性面板出现「清除覆盖」 |

顺带修复了一处相关缺陷：`MyAwardsView` 的奖状卡片此前仍在用旧的「叠字卡片」，**设计器的效果只能在导出的 PDF 里看到**。现改为按真实布局渲染（无布局的老奖状自动退回旧卡片），并把卡片与 PDF 的字段组装统一到 `buildAwardRenderData()`。

---

## 6. 风险 / 合规 / 待确认

### 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| LoTW 无官方速率/大小限制说明，大账号拉取可能超时 | 用户等待久、失败 | 分批 + 进度条 + 缩小日期范围 + 错误可续 |
| LoTW 密码经 URL 传给 ARRL（官方 API 形态），可能进上游日志 | 凭据泄露 | 服务端转发、不落盘、页面显著提示；提供 `externalProxyUrl` 让部署方自建代理 |
| 内存会话被滥用导致 OOM | 服务不可用 | 容量上限 + TTL + 单用户并发 1 个会话 |
| `qso_qsl=no` 报表缺 DXCC/州/网格 | 部分奖状规则不可用 | 默认拉 `qsl` 报表；规则里依赖这些字段时明确提示 |
| MinIO 公开读桶 CORS 未配 | 客户端 PDF 导出 canvas taint 失败 | M3 前先加桶 CORS 规则 |
| 实物照片隐私 | 个人信息泄露 | 私有桶 + presigned + 审核后即删 + 7 天 ILM 兜底 |
| HamCQ 无公开文档、可能不批 | 需求⑥无法上线 | 代码做成通用 OAuth2；先联调验证；备选仅做"呼号绑定"人工审核 |
| GPL-3.0 传染性 | 对外分发须开源 | 若将来做 SaaS 分发，需评估；仅自用不受限 |

### 待你确认

1. **HamCQ OAuth**：是否已联系过 HamCQ？有无 `client_id`？没有的话我按 `enabled:false` 写好等凭据。
2. **PDF 方案**：接受"先客户端栅格化、后补服务端矢量"两阶段吗？还是直接上服务端（需要引入 Noto Sans SC 字体文件，仓库体积 +1–2 MB）。
3. **实物材料的业务闭环**：审核通过后是否需要**寄送实体奖状**（要收件地址、物流单号）？还是只做"资格认定"？
4. **LoTW 默认拉取范围**：默认拉全部历史（慢），还是默认最近 3 年 + 用户可调？
5. **是否需要保留"上传 ADIF 文件"这条老路径**（建议保留，作为离线/兜底）。

---

## 7. 追加功能建议（路线图池）

按"投入产出比"排序，供挑选：

1. **🎯 公开校验页 + 二维码防伪**（已并入 M3）：奖状体系的可信度基础，也是纸质卡片的配套。
2. **🎯 数据源适配器化**：把 LoTW 抽象成 `DataSourceProvider` 接口，后续可接 Club Log（OQRS）、QRZ Logbook、eQSL、HamCQ Echo（基于 Wavelog，Pro 版有 API Key）、本地 ADIF。这是本平台最长的护城河。
3. **🎯 奖状规则引擎升级**：
   - 现在 `evaluateAward` 把用户**全部 QSO 拉到应用内存**再过滤（`server.js:247`），QSO 上万就慢。改为 SQL 侧过滤 + 结果缓存。
   - 支持 `CQZ/ITUZ/IOTA/VUCC_GRIDS/CREDIT_GRANTED/APP_LoTW_MODEGROUP` 等 LoTW 专有字段。
   - 支持"波段/模式组合矩阵"类奖状（如 WAS 每波段、DXCC 每波段）。
4. **🎯 审核工作流完善**：站内通知/邮件、多级审核（初审+终审）、SLA 超时提醒、把 `audit_log` 以时间线展示给申请人（现在只存不显）。
5. **🎯 用户「我的数据」页**：集中展示"本站已存日志条数 / 当前临时会话状态 / 上传过的材料"，提供一键清除。隐私透明是最有力的信任手段。
6. **奖状模板市场**：layout 导出为 JSON 供社区分享（注意底图版权，只共享结构 + 元素坐标）。
7. **管理员批量导出**：某奖状全部获奖者的 PDF 打包 zip（含中英文两份）。
8. **多语言 i18n**：HAM 群体国际化，界面 + PDF + 邮件模板三处都要支持。
9. **奖项进度排行榜 / 公示栏**：社区氛围，但要注意隐私（默认匿名或需本人同意）。
10. **可访问性**：设计器全靠鼠标可视化操作，需补键盘操作与屏幕阅读器支持。
11. ✅ **设计器保存时提示外站图片**（已完成 2026-09-21）：新增 `src/lib/media.js`（`isExternalImageUrl` / `collectExternalImages`），`AwardDesigner.saveAward` 保存前检测底图 + 图片元素，发现外站 URL 就弹 `confirm` 提示（跨域污染 canvas 无法导出 + 随时失效），用户可选「仍要保存」或返回修改。来源：2026-09-21 用户报的「导出一直转圈」与「两份 PDF 底图一样」，根因都涉及图片地址。

---

## 8. 下一步

M0–M5 全部完成。剩余收尾与待办：

**M4 实物材料收尾（3 项）**

1. **✅ 判定打通（已完成 2026-09-22）**：`award_evidence` 加 `match_callsign/band/mode/date` 四列；上传时填对方呼号（必填）+ 波段/模式（选取框）/日期（自填）；审核 `approve` 时据此匹配该用户 QSO 并 `jsonb_set` 打 `qsl_rcvd='Y'`，使实物卡片确认真正参与 `qslRequired` 判定。
2. **✅ ILM 7 天兜底（已完成 2026-09-22）**：启动时对私有桶 `setBucketLifecycle` 设 `expiry=7 天`，自动清理「审核中途放弃」的孤儿图。
3. **✅ presigned URL 的 publicEndPoint（已完成 2026-09-22）**：新增 `minioPublicClient`（用 `publicEndPoint`/`MINIO_PUBLIC_ENDPOINT` 另建，凭据相同），presigned 一律走它；容器部署浏览器即可访问，未配置时退化为 `minioClient`。

**其他**

- M5 真实回调域名：本地联调已通；部署到公网后需在 HamCQ 后台把回调地址改成正式域名。
- **路线图池（§7）**按需挑选，其中「第 11 项 外站图片提示」因实机已踩坑，建议优先。
