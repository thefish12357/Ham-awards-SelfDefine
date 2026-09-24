# AGENTS.md — Ham Radio Awards System

> 本文件为 AI 助手在本目录工作时的项目说明。新开对话时优先阅读本文件。
> 上游仓库：https://github.com/BH2VSQ/Ham-awards-SelfDefine （main 分支，package version `2.2.0`）
> 本仓库公开存档：https://github.com/thefish12357/Ham-awards-SelfDefine （public，`main` 分支）
> 本文件最后核对时间：2026-09-22
> 二次开发规划见 **`ROADMAP.md`**（6 项需求的技术方案、DB/API 变更、里程碑）
> ✅ 许可证：上游已于 2026-09-21 补充 **GPL-3.0**（`LICENSE`，commit `b4773ab Add LICENSE.md`），作者已授权二次开发。
> GPL-3.0 是**传染性**许可：对外分发本仓库或其衍生作品时，必须同样以 GPL-3.0 授权并提供源码；仅自用/内部使用不受限制。
> `package.json` 已补 `"license": "GPL-3.0"`。
> 本仓库已接管上游 git 历史，并在此基础上做了 Docker 化 + 基础设施改造，详见 §5 与 §7。
> git remote 现状：`origin` = 上游（拉更新用）；`archive` = 公开存档仓库（更新：`git push archive release:main`）。
> 本地分支：`main` = 上游历史；`release` = **干净归档分支**（无上游历史，已跟踪 `archive/main`）。
> ⚠️ **敏感历史**：上游 commit `989f008` 的 `config.json` 曾含真实密钥（jwtSecret / DB 密码 / 内网 IP）。公开归档特意用孤儿分支，**不要把上游历史推到公开仓库**。
> ★ **2026-09-21 完成 M0（基础设施）**：Tailwind 改本地构建、补 Hash 路由、抽出 `src/lib/`、修 `POST /api/awards` 不返回新 id、删除死代码 `src/install.jsx`。详见 `ROADMAP.md` §5。

---

## 1. 项目定位

业余无线电（HAM）**奖项管理系统**。核心业务：导入 LoTW 导出的 ADIF 通联日志 → 解析入库 → 按奖状规则匹配 QSO → 用户在线申请奖状 → 管理员审核签发。

## 2. 技术栈

| 层       | 技术                                 | 备注                                                                                                                                                           |
| -------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前端     | React 18 + Vite 4                    | JSX（**非 TypeScript**）                                                                                                                                       |
| 样式     | **Tailwind CSS 3 本地构建**          | 入口 `src/index.css`（`@tailwind` 三条指令），配置 `tailwind.config.cjs` / `postcss.config.cjs`。**必须用 `.cjs` 后缀**，因为 `package.json` 是 `type: module` |
| 图标     | lucide-react                         |                                                                                                                                                                |
| 路由     | **轻量 Hash 路由**                   | 无 react-router。`App` 的 `subView` 与 `location.hash` 双向同步（`src/lib/routes.js`），刷新可停留当前页、链接可分享；`adminPath` 仍未被前端使用               |
| 后端     | Express 4 单体（`server.js`）        |                                                                                                                                                                |
| 数据库   | PostgreSQL（`pg`）                   | ADIF 记录存 JSONB                                                                                                                                              |
| 对象存储 | MinIO + multer                       | 存奖状背景图                                                                                                                                                   |
| 认证     | JWT + bcryptjs + TOTP(otplib/qrcode) | 支持 Google Authenticator 2FA                                                                                                                                  |
| 运行环境 | Node.js v16+                         | 实测环境 Node v24                                                                                                                                              |

## 3. 目录结构

```
/
├── index.html          # Vite HTML 模板（已不再引 CDN；favicon 指向 /favicon.svg）
├── vite.config.js      # root='.', outDir='dist', /api 代理 -> 9993
├── tailwind.config.cjs # ★ 新增：Tailwind 本地构建配置（扫描 index.html + src）
├── postcss.config.cjs  # ★ 新增：PostCSS 配置（tailwindcss + autoprefixer）
├── package.json        # type: module
├── server.js           # ★ 后端单体，约 50KB，全部 API 在此
├── src/
│   ├── main.jsx        # 入口，挂载到 #root（import './index.css'）
│   ├── app.jsx         # ★ 约 139KB，前端几乎全部组件都在这一个文件里
│   ├── index.css       # ★ Tailwind 入口（@tailwind base/components/utilities）
│   ├── lib/            # ★ 新增：新功能的公共模块，不要再往 app.jsx 里塞
│   │   ├── apiFetch.js #   统一请求封装（原 app.jsx 第 16–49 行抽出）
│   │   ├── routes.js   #   Hash 路由工具（readRoute / writeRoute / isRouteAllowed）
│   │   ├── awardLayout.js  #   奖状布局 schema（v2，mm）+ 形状几何（SHAPES/shapePath）+ 预设模板
│   │   ├── uploadLimits.js #   ★ 上传体积上限/尺寸上限常量（前后端必须一致）
│   │   ├── imageUpload.js  #   ★ 上传前置处理：类型/尺寸/体积校验 + 超尺寸自动等比缩小
│   │   ├── dateInput.js    #   ★ 日期约束/校验唯一真源（DATE_MIN / DATE_FAR_MAX / validateDateInput）
│   │   ├── awardTargets.js #   ★ 规则「目标对象」类型规格（placeholder/提示/清单格式校验）
│   │   ├── lazyImport.js   #   ★ 按需加载失败自愈（部署后旧页面自动刷新一次）
│   │   └── exportAwardPdf.js   #   客户端 PDF 导出（html-to-image + jsPDF，按需加载）
│   ├── components/     # ★ 新增：可复用组件
│   │   ├── AwardRenderer.jsx   #   布局 → DOM 渲染（编辑器/我的奖状/审核预览/PDF 共用）
│   │   ├── VisualDesigner.jsx  #   可视化布局编辑器（拖拽/缩放/属性/撤销重做/底图上传/多等级）
│   │   ├── DateInput.jsx       #   ★ 统一日期输入（强制 min/max + 行内中文校验）
│   │   └── PasswordInput.jsx   #   带「显示密码」眼睛图标的密码框（登录/注册/用户中心）
│   └── pages/          # ★ 新增：独立页面（app.jsx 只做最小接入）
│       ├── LotwImportView.jsx  #   LoTW 直连页（需求①）
│       └── VerifyView.jsx      #   公开校验页（免登录，二维码指向 #/verify/<serial>）
├── server/             # ★ 新增：后端新增模块（server.js 仍是唯一入口）
│   ├── services/         # （以下为节选，另有 cty / notifications / audit / invites / oauth 等）
│   │   ├── adif.js           # ADIF 解析（整串 + 流式），替代 server.js 内联实现
│   │   ├── awardEngine.js    # ★ 奖状判定引擎（纯函数，数据源可插拔；含 warnings/stats 自检）
│   │   ├── awardTargets.js   # ★ 目标类型规格与清单校验（引擎 warnings 与 400 兜底共用）
│   │   ├── dates.js          # ★ 服务端日期边界校验（与前端 dateInput.js 同规则）
│   │   ├── lotwClient.js     # LoTW 报表拉取 + 自动二分重试
│   │   └── lotwSessions.js   # ★ LoTW 临时会话（纯内存，TTL 30 分钟）
│   └── routes/
│       └── lotw.js           # /api/lotw/* 路由（工厂函数注入依赖，避免循环 import）
├── public/
│   └── favicon.svg     # ★ 新增：修掉 index.html 的 favicon 404
├── docs/
│   └── hamcq-oauth-application.md  # ★ 新增：HamCQ OAuth2 接入材料（备查）
├── dist/               # 前端构建产物，由 server.js 静态托管（不入库）
│
├── Dockerfile          # ★ 新增：多阶段构建（Vite 构建 -> 生产依赖运行时）
├── ROADMAP.md          # ★ 新增：二次开发规划（6 项需求方案 / 里程碑 / 风险）
├── docker-compose.yml  # ★ 新增：db + minio + app + installer 四个服务
├── docker/
│   └── autoinstall.mjs # ★ 新增：调用 /api/install 完成首次安装（幂等）
├── .env.example        # ★ 新增：可调参数模板（复制为 .env）
├── .gitignore          # ★ 新增：排除 config.json（内含密钥）等
├── .dockerignore       # ★ 新增
└── DOCKER.md           # ★ 新增：Docker 部署 / 开发说明
```

## 4. ⚠️ 端口：README 是错的，以此处为准

| 服务                 | 端口             | 依据                                                  |
| -------------------- | ---------------- | ----------------------------------------------------- |
| 前端 Vite 开发服务器 | **5173**（默认） | `vite.config.js` 未配 `server.port`                   |
| 后端 API             | **9993**         | `server.js` 末尾 `Number(process.env.PORT) \|\| 9993` |

- README 里写的 `3003` **已过时，不要使用**。
- `vite.config.js` 的注释 `Corrected port to match server.js` 已确认以 9993 为准。
- 后端端口已支持 `process.env.PORT` 覆盖，**默认仍是 9993**（原为硬编码，为 Docker 化所加）。
- Docker 部署时宿主机映射端口见 `.env` 的 `*_HOST_PORT`：应用 `9993`、PostgreSQL `55432`、MinIO `9000/9001`。

## 5. 启动与调试

```powershell
npm install

# 方式一：开发模式（前端热更新，推荐日常开发 / 浏览器调试）
npm run dev          # 终端 1 -> http://localhost:5173 ，/api 自动代理到 9993
node server.js       # 终端 2 -> http://localhost:9993 （需先有 PostgreSQL）

# 方式二：生产模式（单进程，由 server.js 托管 dist）
npm run build        # 生成 dist/
node server.js       # 直接访问 http://localhost:9993
```

前置依赖：**PostgreSQL v12+** 与 **MinIO** 需可用；首次访问 `http://localhost:5173` 会自动进入安装向导（填数据库信息 + 设置管理员呼号/密码）。

```powershell
# 方式三：全栈 Docker（推荐，一条命令、易清理，详见 DOCKER.md）
Copy-Item .env.example .env
docker compose up -d --build        # 首次自动建库、建 bucket、建管理员 ADMIN/ChangeMe_123
docker compose down -v --rmi local  # 连数据卷一起删干净
```

**Docker 模式要点**

- 容器：`ham-awards-db`（PostgreSQL）、`ham-awards-minio`、`ham-awards-app`、`ham-awards-installer`（一次性，Exited(0) 属正常）。
- 三个命名卷 `ham-awards_pgdata` / `miniodata` / `appdata` 承载全部数据；`config.json` 在 app 容器内为 `/data/config.json`（由 `CONFIG_FILE` 指定）。
- MinIO 镜像用 `quay.io/minio/minio:latest`：本机 Docker Hub 加速节点拉不动 `minio/minio`，二者内容一致。
- 验证方式见 `<project_guidance>` 内的浏览器调试小节；容器态访问 `http://localhost:9993`。
- 改前端/`server.js` 后必须 `docker compose up -d --build` 才生效；只改 `docker/autoinstall.mjs` 则 `docker compose up -d` 即可。
- 日常改代码建议**只用容器跑 db + minio**，应用在本机 `npm run dev` 热更新（DOCKER.md §4 有对应向导填法）。

### ★ 本机开发（M0 起推荐的日常方式，已实测）

容器只跑基础设施，应用跑本机源码，改一行即时生效：

```powershell
# 1. 只起 db + minio（若 app 容器在跑会占用 9993，先停掉）
docker compose up -d db minio
docker compose stop app          # 需要时用 docker compose start app 恢复

# 2. 后端（本机源码）
node server.js                   # -> http://localhost:9993

# 3. 前端（热更新，可选）
npm run dev                      # -> http://localhost:5173 ，/api 代理到 9993
```

**免手点完成安装**：本机 `config.json` 不存在时 `/api/system-status` 会返回 `installed:false`。
不用打开安装向导，直接复用容器那套脚本，把端口指向宿主机映射即可：

```powershell
$env:APP_URL='http://localhost:9993'; $env:DB_HOST='localhost'; $env:DB_PORT='55432'
$env:DB_USER='ham'; $env:DB_PASS='ham_pass'; $env:DB_NAME='ham_awards'
$env:MINIO_ENDPOINT='localhost'; $env:MINIO_PORT='9000'
$env:MINIO_ACCESS_KEY='minioadmin'; $env:MINIO_SECRET_KEY='minioadmin123'
$env:MINIO_BUCKET='ham-awards'
$env:ADMIN_CALLSIGN='ADMIN'; $env:ADMIN_PASSWORD='ChangeMe_123'
node docker/autoinstall.mjs
```

本机模式与容器模式的 `config.json` 相互独立（前者在项目根，后者在 appdata 卷 `/data`），
**注意 `jwtSecret` 不同**：混用会导致 401 并触发前端自动登出重载。切换环境时重新登录即可。

停止后台进程（后端 9993 与 Vite 5173 都可能以隐藏窗口方式跑在后台）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*server.js*' -or $_.CommandLine -like '*vite*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId }
```

### 浏览器调试

本项目已配置 **Playwright MCP**（`--browser chrome`，headed 模式）。调试时：

- 开发态访问 `http://localhost:5173`；需要验证构建产物时访问 `http://localhost:9993`
- 优先用 `browser_snapshot`（无障碍树）而非截图定位元素
- 改完 UI 后自查 `browser_console_messages`，不要只看页面渲染

## 6. API 约定

- 所有接口前缀 **`/api`**
- ⚠️ **README 声称的“防重放（`x-timestamp` 5 分钟窗口）在 v2.2.0 代码里并不存在”**：全仓库检索无 `x-timestamp`，`server.js` 仅挂了 `cors()` / `express.json()` / `express.static()` 三个中间件。手工调接口**不需要**该头。（此前本文件误抄 README，已更正。若上游后续补上该机制再按 README 处理。）
- 未安装时 `/api/install` 公开可调（`verifyToken` 首行放行），这是 `docker/autoinstall.mjs` 能免手点完成安装的基础。

主要模块：

| 前缀                                    | 用途                                                                                                | 权限                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ---- |
| `/api/system-status`                    | 系统状态（是否已安装、adminPath）                                                                   | 公开                                        |
| `/api/install`                          | 首次安装向导                                                                                        | 未安装时公开                                |
| `/api/auth/login`、`/api/auth/register` | 登录 / 注册                                                                                         | 公开                                        |
| `/api/stats/dashboard`                  | 仪表盘统计                                                                                          | 登录                                        |
| `/api/user/*`                           | 个人中心：profile、`2fa/setup                                                                       | enable                                      | disable`、password、logs、account、my-awards、qsos | 登录 |
| `/api/logbook/upload`                   | ADIF 日志上传                                                                                       | 登录                                        |
| `/api/lotw/connect`                     | 读取 LoTW 报表到**内存会话**（不落库、不落盘）                                                      | 登录                                        |
| `/api/lotw/evaluate`                    | 用内存会话判定奖状进度                                                                              | 登录                                        |
| `/api/lotw/apply`                       | 用内存会话申请奖状（**只落申请记录，不落 QSO**）                                                    | 登录                                        |
| `/api/lotw/session`                     | GET 查状态；DELETE/POST 清除（支持 `?id=sessionId` 能力令牌，供 `sendBeacon` 无法带 Auth 头时使用） | 登录                                        |
| `/api/verify/:serial`                   | 奖状真伪校验，呼号脱敏（BH2VSQ → BH\*\*\*Q）                                                        | **公开**                                    |
| `/api/verify/:serial/qr`                | 校验二维码 PNG（内容 = 本站 `/#/verify/<serial>`）                                                  | **公开**                                    |
| `/api/media?key=awards/…`               | 同源图片代理。底图在 MinIO 属跨域，canvas 导出会被污染，走这里规避                                  | **公开**（仅限 `awards/` 一级前缀，禁穿越） |
| `/api/awards/*`                         | 奖状：my、all_approved、`:id/check`、`:id/apply`、增删改、upload-bg（底图 ≤10MB）、upload-asset（图片元素 ≤2MB） | 登录 / 奖状管理员                           |
| `/api/qsos/:id/awards`                  | 查某条 QSO 参与哪些奖状                                                                             | 登录                                        |
| `/api/admin/*`                          | users、awards/pending、awards/approved、awards/audit、issued-awards（含 `/orphans` 一键清理失效记录）、settings | **系统管理员**                              |
| `/api/award-templates/*`                | 奖状布局模板库：list / `:id` / 增 / PATCH 改名 / 删。**按创建者私有**，layout 存库时剥掉 `canvas.bgUrl` | 登录 / 奖状管理员                           |
| `/api/evidence/:id/photo`               | 实物材料照片**同源鉴权代理**（内部客户端读私有桶，admin 全部 / award_admin 仅自己奖状；已审核的返回 404） | 登录 / 奖状管理员                           |

**颁发记录（`user_awards`）生命周期（2026-09-24 修订）**

- **打回 / 撤回只改状态**（`awards.status='returned'`），记录原样保留。
- **删除奖状「不」删除颁发记录**：外键为 `ON DELETE SET NULL`（`upgradeSchema` 会把老的 CASCADE 自动改过来，
  并按 `conname='user_awards_award_id_fkey'` 判 `confdeltype`，幂等）。`DELETE /api/awards/:id` 在删奖状**之前**
  把奖状名/编号**快照**进记录并置 `detached_at`，返回 `issuedDetached`。
  理由：已发出的凭证（有序列号、可扫码）是审计台账，删奖状多半只是重做设计/规则，不该顺手清台账。
- 这些「无主」记录在「颁发管理」里归入 **已失效（原奖状已删除）** 分组（列表接口 `LEFT JOIN awards` + `COALESCE` 快照，
  返回 `detached` 标志）；可 `DELETE /api/admin/issued-awards/orphans` **一键清理**，也能逐条删。
  ⚠️ `/orphans` 必须注册在 `/:id` **之前**，否则会被当成 id 去查整数。
- 公开校验 `GET /api/verify/:serial` 对这类记录返回 **404 + `revoked:true`**（带快照名称与脱敏呼号），
  而不是笼统的「未找到该序列号对应的奖状」。
- 「我的奖状」(`/api/user/my-awards`) 也走 **LEFT JOIN + 快照**：无主记录**展示给持证人**（`detached` 标志），
  但只作为历史留存 —— 卡片显示「此奖状已被下架」占位（奖状设计已随奖状删除，渲染不出证书）、
  **禁用「下载 PDF」**、点卡片只弹 `infoDialog` 说明（不能进详情弹层：`award_id` 为空会去请求 `/awards/null/check`），
  排序把有效记录排在前面。
- `DELETE /api/awards/:id` 对越权/状态不符返回 **403**（不再静默 success）。

## 7. 编码约定与雷区

### 必须遵守

1. **`src/app.jsx` 是 139KB 的单体文件**，不要"顺手重构"或整体重写。改动一律用局部替换（精确匹配上下文），并避免大范围重新格式化。**新功能一律放新文件**（`src/lib/`、`src/components/`、`src/pages/`），`App` 只做最小接入。
2. **样式只用 Tailwind 类名**。`src/index.css` 现在只有三条 `@tailwind` 指令，它是 Tailwind 的**编译入口**，不是自定义样式层。
3. **Tailwind 已改本地构建**（2026-09-21，不再依赖外网 CDN）：
   - 配置为 `tailwind.config.cjs` / `postcss.config.cjs`，**必须保持 `.cjs` 后缀**（`package.json` 是 `type: module`，用 `.js` 会加载失败）
   - 扫描范围是 `./index.html` + `./src/**/*.{js,jsx}`。**字符串拼接出的类名不会被扫描到**（如 `` `bg-${c}-500` ``），这类写法要改为完整类名或加 `safelist`
   - `Dockerfile` 里已把这两个配置文件与 `public/` 加进构建阶段的 `COPY`，改动结构时别漏
   - ⚠️ **新增运行期依赖目录必须同步加进 `Dockerfile` 运行时阶段的 `COPY`**。`server/` 与 `data/` 都栽过同一个坑：漏拷 `server/` 让容器崩溃重启，漏拷 `data/` 让 `cty.dat` 缺失 → `lookupDxcc` 抛 ENOENT，日志上传 / 全部日志 / 实物审核全部 500。服务端现已对 cty.dat 缺失做**降级**（返回空索引 + 一条 warn），但目录仍必须拷全。
4. **前端是轻量 Hash 路由**（`src/lib/routes.js`）。新增页面：先在 `app.jsx` 的菜单与渲染分发里加分支，**再把新 id 加进 `ALL_ROUTES` 与对应的 `ROUTES_BY_ROLE`**，否则 URL 同步和角色守卫都不认它。服务端 `express.static('dist')` 仍无 SPA fallback，但 hash 不会发给服务端，所以刷新安全。
5. **改动后端端口/静态目录时同步检查** `vite.config.js` 的 proxy 目标。
6. `adminPath` 是**名存实亡的配置**：只写进 `config.json` 并被 `/api/system-status` 回显，前端从未读取，改它不影响入口路径。
7. **外部请求统一走 `src/lib/apiFetch.js`**，不要写裸 `fetch('/api/...')`，否则会漏掉 `Authorization` / `x-2fa-code` 注入与 401 自动登出。
   - ⚠️ **新接口不要用 401 表达"业务性失败"**（如密码错误、上游凭据错误）。前端只在 `401 且 error ∈ {TOKEN_MISSING, TOKEN_INVALID}` 时才自动登出；即便如此，业务失败也应改用 400 / 403 / 409，避免误导。（上游遗留的 `/api/user/password`、`requirePassword`、`/api/user/2fa/disable` 都误用了 401，已在 `apiFetch` 侧兼容；LoTW 凭据错误刻意返回 **400**。）
8. **奖状判定逻辑只有一份**：`server/services/awardEngine.js`（纯函数，不碰 DB）。`server.js` 里的 `evaluateAward` 只是「取数据 + 调用引擎」的薄封装。**新增判定路径必须复用该引擎**（LoTW 会话就是这么做的），不要再复制一份规则逻辑。
9. **奖状布局（layout）只有一份 schema**：`src/lib/awardLayout.js`，v2、单位 **mm**、A4 横版 297×210。编辑器、`AwardRenderer`、审核预览、PDF 导出读同一份；旧 `layout: []` 会被 `normalizeLayout` 归一化。改 schema 前先想清楚向后兼容。
   - **形状只有一份几何**：`SHAPES`（Word 风格 22 种）+ `shapePath(shape, W, H, radiusPx)`，渲染端统一出一个 `<path>`。加新形状只改这两处。⚠️ 描边有 **1px 下限**（`Math.max(px(strokeWidth), 1)`）——编辑器画布只有 ~560px 宽，0.5mm 不足 1 个物理像素会让形状"加了却看不见"；PDF 按 1200px 宽渲染，下限不影响打印。
   - **`presetAwardLayout()` 只用于新建/布局为空时的初始化**，**绝不能塞进 `normalizeLayout`**：否则所有历史空布局奖状都会凭空多出一套元素（数据事故）。
   - **模板库**（`award_templates`）：设计器左栏「存为模板 / 我的模板」走 `/api/award-templates`，**按创建者私有**、每人上限 50 个、**不存底图**（后端 `sanitizeTemplateLayout` 剥掉 `canvas.bgUrl`）；套用时**保留当前底图**、画布样式从模板带入、元素 id 用 `uid()` 重新生成（避免与当前布局撞 id）。
   - **底图是可选的**（2026-09-24 起）：不再强制上传才能存草稿/提交审核。没有底图时就是「白色背景 + 元素排版」，默认模板自带双线边框与全部字段，完全可用；
     提交审核时只做一次**软提示**。另有内置底图 `public/default-award-bg.svg`（`DEFAULT_BG_URL`，同源 → 导出不会跨域），设计器里一键套用。
     ⚠️ 该 SVG 是手写 XML：**XML 注释里不能出现连续两个短横线**，否则解析失败、`naturalWidth` 恒为 0（已踩过一次，注释分隔线只用等号）。
     `MyAwardsView` 的旧卡片在无底图时会退回深色兜底，避免白字落白底看不见。
10. **多等级差异写在元素的 `levelOverrides` 里**，不要在渲染层各写一套判断：
    ```js
    // 元素级：Gold 等级下换色、加大、上移
    { id:'e2', type:'text', binding:'level', color:'#a16207', h:18, y:80,
      levelOverrides: { Gold: { color:'#eab308', h:30, y:70 } } }
    ```
    只有 `AwardRenderer` 通过 `resolveElementForLevel(el, data.level)` 合并差异，因此**所有消费方自动生效**。
    编辑器用 `ignoreLevelOverrides` 在「默认（所有等级共用）」模式下关掉合并，避免"改基础设计却看到覆盖效果"。
    新增渲染路径时**不要绕过 `AwardRenderer`**，否则多等级会失效。
   - **列表缩略图统一用 `AwardThumbnail`**（`src/components/AwardRenderer.jsx`）：按布局渲染 + **contain 等比贴合**容器（不能用 `ResponsiveAwardRenderer`，它按宽度铺满会裁掉证书下半截），没有元素时退回底图、都没有则给中性占位。
     ⚠️ 该组件**不能自己写 `relative`**：调用方传 `absolute inset-0` 铺满固定高度的框，而 Tailwind 输出里 `.relative` 在 `.absolute` 之后会覆盖它 → 元素退回文档流、高度量到 0 → 「量不到高度就不渲染」的死锁（2026-09-24 踩过）。
     ⚠️ 各列表卡片**不要只渲染 `bg_url`**：底图可空，只画背景图会得到一片空白，看起来像奖状丢了。
11. **密码输入一律用 `src/components/PasswordInput.jsx`**（自带显隐切换 + `autoComplete`）。裸 `<input type="password">` 会缺眼睛图标，也会触发浏览器控制台警告、并可能让 Chrome 的自动填充下拉挡住按钮。
12. **★ 字体有版权红线**（2026-09-21 定）：奖状字体列表 `src/lib/awardLayout.js` 的 `FONTS` **只允许**开源可商用授权（**SIL OFL** / **Apache-2.0** / 官方明确免费商用）与**操作系统自带**字体。**严禁**加入方正、汉仪、造字工房、华文、长城等商业字体 —— 用于生成对外发布的奖状会收到律师函。新增字体时必须在 `label` 里标出授权来源。

- **系统字体（微软雅黑/宋体/楷体等）可以放进 `font-family`**：CSS 里只是**引用本机已安装的字体**，属于常规引用，不涉及复制/再分发；且 PDF 走**栅格化**（渲染成位图）而非嵌入字体文件，不受字体 EULA 的「嵌入分发」条款约束。仍建议优先选开源字体。
- **★ 已自托管思源黑体 + 思源宋体**（2026-09-21）：`public/fonts/` 放 **404 个 woff2 分片**（400 / 700 字重，共 **10.78 MB**），`src/styles/fonts.css` 有 **404 条 `@font-face`**（由 `scripts/build-fonts.mjs` 生成，**勿手改**）。这两款在 `FONTS` 里标 `★已内置`，**任何设备渲染都一致**。
  - 中文按 `unicode-range` 切成 101 片，浏览器**只下载实际用到的那几片** —— 实测渲染「业余无线电奖状AWARD」仅下载 4 片 / 125 KB，所以仓库虽大、首屏不受影响。
  - **更新字体**：`npm install --no-save @fontsource/noto-sans-sc @fontsource/noto-serif-sc && node scripts/build-fonts.mjs`。这两个包**刻意不写进 `package.json`** —— 字体文件已入库，写进去会让 Docker 构建白白下载 160 MB+。
  - OFL 要求随字体分发许可证，已放在 `public/fonts/LICENSE-*.txt`，**不要删**。
- ⚠️ **其余字体仍有前提**：除思源黑体 / 宋体外，能否生效仍取决于渲染机器装没装，未装会静默回退。因此 `FONTS[*].value` 一律写成**完整兜底栈**：`开源字体 → 同风格系统字体 → 通用族`（如 `"Noto Serif SC","Source Han Serif SC","Noto Serif CJK SC","SimSun",serif`）。
- ⚠️ **导出 PDF 前必须 `await document.fonts.ready`**：`@font-face` 用 `font-display: swap`，字体没加载完就栅格化会拿到回退字体，导致「PDF ≠ 设计」。
- 已知代价：字体声明让 CSS 从 ~27 KB 涨到 **400 KB（gzip 131 KB）**。若后续嫌大，可把 `fonts.css` 从主入口拆出、在奖状渲染页按需动态 `import`。

13. **★ 导出 PDF 的三条硬约束**（`src/lib/exportAwardPdf.js`，2026-09-21 修过一轮「一直转圈」，**别踩回去**）：

- **判断图片是否加载完，只看 `img.complete`**，不要写 `complete && naturalWidth > 0`。图片**加载失败**时正是 `complete=true` 且 `naturalWidth=0`，此时若还去监听 `load`/`error`，就是在等一个**永远不会再触发**的事件 → Promise 永久挂起（表现就是按钮卡在「生成中…」）。
- **加载失败的 `<img>` 必须在栅格化前从 DOM 移除**（用同尺寸占位 div 顶替）。`html-to-image` 会逐张 fetch 并内联图片，拉不动就抛一个**没有 message 的 `Event`**，上层只能看到「[object Event]」，**整个导出直接失败**。移除后 PDF 仍能生成，只是缺这几张图，再由 `failedImages` 提示用户。
- **`URL.pathname` 保留 percent-encoding**。拿它直接 `encodeURIComponent` 会**二次编码**（`%C3%A6` → `%25C3%25A6`），`/api/media?key=` 必然 404。必须先 `decodeURIComponent` 还原成真实 key 再编码一次。
- 另外：`waitForImages` 与 `toPng` 都要有**超时兜底**（否则任何一次网络挂起都会永久卡住 UI）；栅格化前要 `await document.fonts.ready`。
- 报错信息要用 `describeError()` 提取 —— `e.message || e` 遇到 Event 会输出「[object Event]」。
- **★ `toPng` 必须开 `includeQueryParams: true`**：html-to-image 的资源缓存 key 默认会 `url.replace(/\?.*/, '')` **剥掉 query string**。而底图统一走 `/api/media?key=<对象名>`，不同奖状只有 key 不同 —— 剥掉 query 后缓存 key 全部退化成同一个 `/api/media`，**连续导出多份奖状时第二份会命中第一份的缓存，底图被替换成上一份奖状的图**（2026-09-21 实测：先导「测试」再导「M3 测试奖状」，后者 PDF 从 118 KB 涨到 4.2 MB，里面装着前者的底图）。开启后以完整 URL 作 key，互不污染；单份 PDF 内同 URL 仍正常复用。

14. **上传文件不要用 `req.file.originalname` 当对象名**：multipart 的 filename 被 multer/busboy 按 **latin1** 解码，中文会变成乱码（`QQ截图` → `QQæªå¾`，还夹着不可见的控制字符），对象名与 URL 从此永久失配。`/api/awards/upload-bg` 与 `/api/awards/upload-asset` 共用 `server.js` 的 `storeAwardImage(file, prefix)`，只取**扩展名**，主体用 `时间戳 + 随机串`（`bg_<ts>_<hex>.png` / `img_<ts>_<hex>.png`）。
    - 两个接口的区别只有体积上限（底图 10MB / 图片元素 2MB），上限值统一写在 `src/lib/uploadLimits.js`，**改一处要改两处**（`server.js` 的 multer limits 与前端常量）。
    - multer 的错误统一经 `handleUpload(mw, limitMB)` 包装成 **400 + 中文原因**；不包的话超限只会得到 500 + 一段 HTML，用户看不出是超大小还是格式不对。
    - 前端**先校验再上传**（`src/lib/imageUpload.js` 的 `prepareImageForUpload`）：类型 / 最长边（底图 4000px、图片元素 2000px）/ 体积，超尺寸会用 canvas **等比缩小**后再校验体积。服务端没有图像库，尺寸只能在前端把控。
    - 两个接口都注册在 `/api/awards/…` 下，所以经 `/api/media?key=` 代理，**不会**在 https 页面被混合内容拦掉。
15. **实物材料（M4）的隐私红线**（2026-09-22 落地）：QSL 卡片照片**只能进私有桶 `ham-awards-evidence`**，**绝不放公开桶 `ham-awards`**（照片含地址/印章，公开桶是 `s3:GetObject` 对 `*`）。实现见 `server/routes/evidence.js`：

- **权限归属（按奖状）**：`admin` 看/审**全部**材料；`award_admin` 只能看/审**自己创建的奖状**（`awards.creator_id = 自己`）收到的材料——待审列表按 `creator_id` 过滤，审核接口在删除前会二次校验归属（越权返回 403）。
- 管理员查看走**同源鉴权代理** `GET /api/evidence/:id/photo`（用内部 `minioClient` 读私有桶流式返回；前端 `apiFetchBlob` 转 blob URL 给 `<img>`）。
  ⚠️ **不要再改回 presigned 直链**：直链 host 是 `MINIO_PUBLIC_ENDPOINT`（本部署为 `localhost:9000`），https 页面下会被**混合内容**拦掉、远程管理员的 `localhost` 又指向他自己
  → 审核页只显示「图片不可用（可能已删除）」（2026-09-24 用户实测）。待审列表只返回 `has_photo`，**不再**吐出 object_key 或直链；
- 审核 `approve`/`reject` 后**立即 `removeObject`**，DB 把 `object_key` 置空 + 记 `purged_at`，只留审核结论；
- 上传用 multer `memoryStorage`（5 MB 上限）+ PNG/JPEG **magic bytes** 校验，不落本地磁盘；
- 孤儿图**不自动删除**（用户拍板 2026-09-22，撤销了此前的 ILM 自动删除）：照片保留，靠**站内通知**催审核员处理；审核通过/驳回后仍立即 `removeObject`。
- **`minioPublicClient` 已不再用于实物照片**（2026-09-24 改为同源代理后，`evidence.js` 不再 presign）。该客户端仍在 `server.js` 启动时初始化并注入（`getMinioPublic`），保留是因为 `MINIO_PUBLIC_ENDPOINT/PORT` 仍被 `storeAwardImage()` 用来拼「绝对地址」字段；**新增涉及私有桶的展示位时应走同源代理，而不是 presigned 直链**。
- **★ 判定打通（2026-09-22 落地）**：上传卡片时填**对方呼号（必填）/ 波段 / 模式 / 日期**（存 `match_callsign/band/mode/date`）；审核 `approve` 时据此匹配该用户的 QSO 并 `jsonb_set(adif_raw, '{qsl_rcvd}', '"Y"')`，使「实物卡片确认」真正参与 `qslRequired` 判定（`awardEngine` 只读 `adif_raw.qsl_rcvd` / `lotw_qsl_rcvd`）。匹配规则：呼号 `UPPER(callsign)` 等值；波段/模式 `LOWER()` 等值（可选）；日期 `REPLACE(qso_date,'-','')` 去横线比较（可选，兼容 `YYYYMMDD` 与 `YYYY-MM-DD`）。审核接口返回 `matched_qso` 供前端提示打了几条。

16. **站内通知（M4.1，2026-09-22 落地）**：`server/services/notifications.js` 提供 `notifyUsers(pool, userIds, {type,title,body})`（去重）+ `createNotificationsRouter`（`GET /api/notifications` 返回 `{list,unread}`、`POST /api/notifications/read` 支持 `{all:true}` 或 `{id}`）。`notifications` 表：`id/user_id/type/title/body/read/created_at`。已接入的事件：

- 用户上传实物材料 → 通知所有 `admin` + 该奖状 `creator_id`（`evidence_pending`）
- 实物材料审核通过/驳回 → 通知上传者（`evidence_approved` / `evidence_rejected`）
- 奖状审核通过/退回 → 通知创建者（`award_approved` / `award_returned`）
- 前端侧边栏顶部铃铛 + 未读红点 + 通知面板（10 秒轮询 `/notifications`）。
- **只做站内，不接邮件**（邮件提醒已确认不做，2026-09-22）。将来加新事件：在业务路由里 `notifyUsers` 一行即可。

17. **角色升级申请（2026-09-22 落地）**：普通用户可在用户中心「角色权限」区块申请成为奖状管理员，需 `admin` 在「用户管理」审核。

- `role_requests` 表（`requested_role/status/reviewer_id/reject_reason`）；`reviewer_id` 外键 **必须 `ON DELETE SET NULL`**（否则删除审核过的管理员会报外键错误）。
- 接口：`GET/POST /api/user/role-request`（查/提交，防重复 pending）、`GET /api/admin/role-requests`（待审）、`POST /api/admin/role-requests/:id/review`（approve 时 `UPDATE users SET role='award_admin'`）。事件接站内通知。
- **角色是单一字段、互斥的**；「申请奖状」能力不再限 role——菜单 `my_awards/logbook/lotw_import/all_logs` 对所有角色开放，`AwardDetailModal` 用 `canApply` prop 控制是否显示「申领」按钮（奖状大厅传 `canApply`，审核预览不传）。
- 升级通过后用户需**重新登录**才生效（token 里 role 是旧的）。

18. **全站操作审计（2026-09-23 落地）**：`server/services/audit.js` 提供 `logAudit(pool, req, {action,targetType,targetId,detail,actor})` 与 `createAuditRouter`（`GET /api/admin/audit-logs`，**仅 `admin`**）。表 `audit_logs` 由 `upgradeSchema()` 启动时自动创建，无需手工迁移。

- **只记敏感操作**，命名空间：`auth.*`（登录成功/失败/注册）、`user.*`（改密、2FA 开关、清日志、注销）、`role.*`（升级申请与审核）、`admin.*`（建/改/删账号、系统设置）、`award.*`（保存、审核、删除、申领、撤销颁发）、`evidence.*`（材料上传与审核）。新增敏感接口时**顺手加一行 `await logAudit(dbPool, req, {...})`**。
- **绝不记录凭据**：密码 / TOTP secret / LoTW 账号密码只记"是否发生过"（如 `password_reset: true`），不进 `detail`。
- 写入是 **best-effort**：审计失败只打 `console.error`，绝不阻断业务；`actor_id` 用 `ON DELETE SET NULL` + 冗余 `actor_callsign`，删号后仍能追溯。
- **与「单奖状审核流水」分清**：`awards.audit_log`（JSONB）是**单张奖状**的业务时间线，可见范围 = 该奖状的管理员 + `admin`；`audit_logs` 表是**全站**记录，只有 `admin` 能查（页面 `#/admin_logs`）。

19. **★ 日期输入一律走 `src/components/DateInput.jsx`，校验逻辑只有一份 `src/lib/dateInput.js`**（2026-09-24 落地）。
    - 为什么：原生 `<input type="date">` 的**年份段允许超过 4 位**（Chrome 上限 275760），直接用它会让下游**静默出错**：
      - 实物材料 `match_date` → `toUtcDateTime()` 对非 4 位年份返回 `ok:false`，调用点 `if (evUtc.ok)` 会**把日期悄悄丢掉**（提示"上传成功"，审核端却显示"没填通联日期"）；
      - 奖状规则 `rules.basic.startDate/endDate` → `awardEngine` 拿 QSO 日期与它们做**字符串比较**，年份错位会让所有日志判不过（或反过来全部放行），零报错；
      - LoTW 日期范围 → 服务端 `fetchLotwReports()` 对非法日期**静默回退**成全部历史，只表现为变慢/超时。
    - 约定：前端用 `DateInput`（自动 `min`/`max` + 行内中文校验）；上界默认**今天**，「允许计划到未来」的场景（奖状规则有效期）显式传 `max={DATE_FAR_MAX}`（2100-12-31）。
    - 服务端同规则兜底 `server/services/dates.js`（`validateDate` / `validateRulesDateRange`）：`/api/awards` 的 rules 日期、`/api/evidence` 的 `match_date` 不合法一律 **400**，不信任前端。
    - ⚠️ 实物材料日期的服务端上界是**今天 +1 天**（`utcDateOffset(1)`）：用户在 UTC-11 等时区提交时，本地日期换算出的 UTC 日期可能"跨到明天"。
    - ⚠️ 历史数据里已有一条 `match_date='1111-11-11'`（用户 42 的 SWL 材料，被 4 位截断后仍越界）。SWL/Eyeball 不建日志所以没污染 QSO；新校验的下限 1900 已能拦住这一类。

20. **★ 规则里的「目标对象」必须与清单格式一致，且 UI 提示要随类型变化**（2026-09-24 落地）。
    - 症状：进度**恒为 0 / N、明细全红、零报错**，用户只能说"进度与明细未知"。实测根因是设计器的目标清单输入框**不管选哪种类型都提示「例如: BA1AA, BA4AA…」**，于是有人在「特定 DXCC 实体」下填了呼号；而引擎比较的是 `qso.dxcc`（实体**编号**，如 318），与呼号永远不可能相等。
    - 规格只有一份：`server/services/awardTargets.js` 的 `TARGET_SPECS`（label / re / hint / fixHint）+ `validateTargetList`；前端镜像在 `src/lib/awardTargets.js`（**两份必须同步**，否则"前端能存、后端拒绝"）。
    - 三处必须一起改：① 设计器 placeholder + 行内红字提示；② `saveAward` 保存前拦截；③ `POST /api/awards` 返回 **400 `INVALID_RULES_TARGETS`**。新增目标类型时同时补 `TARGET_FIELD_HINTS`（日志里对应字段名）。
    - ⚠️ **新增目标类型还要改另外 3 处白名单**（漏一处就会"能存但判定/明细不生效"）：`awardEngine.getTargetValue()` 的取值分支、`app.jsx` 里 `LogMatchMatrix` 的 `hasSpecificTargets` 数组、设计器目标清单输入框的显示条件数组。
    - **现有类型（2026-09-25 起）**：`any` / `callsign` / `dxcc` / `grid` / `iota` / `state` / **`district`（呼号分区）**。`district` 取**中国 B 字头呼号**里紧跟前缀的那一位数字（`BY1AA→1`、`BG5UWQ→5`、`BH7CSA→7`；便携写法 `BY1AA/5` 只看主体），**国外呼号的数字不计入**（`JA1ABC`/`K1ABC` → 空），否则"收集 0~9 区"会被国外台灌水。典型用法：清单 `0,1,2,3,4,5,6,7,8,9` + 收集型 + 全收集。
    - **筛选条件与目标对象是「与」的关系**：`evaluateAward` 先跑 Step 1 `rules.filters`（基础筛选），再跑 Step 2 目标匹配。所以"DXCC ID=318（只算中国台）+ 目标=呼号分区 0~9"直接可用（实测：1538 条日志 → 515 条中国台 → 10/10 达标）。
    - `filters[].field` 支持 `band/mode/call/dxcc/state/gridsquare/iota/freq/station_callsign` + **`district`**（2026-09-25 新增，引擎里现算呼号区号，不是 ADIF 字段）。操作符 `eq/neq/contains` 一直有，**`gt`/`lt` 以前只在下拉里、引擎完全没实现（选了等于没选）**，2026-09-25 才补上（两端可转数字按数值比，否则字符串比）。新增筛选字段时若它不是 ADIF 字段，必须在引擎里显式解析，否则会"选了但静默不生效"。
    - ⚠️ **收集型 + 勾「必须全收集」时，分数门槛应等于清单条数**（`scoreTargetOf`）：`target_score` 取 `breakdown.total_required` 而不是 `thresholds[].value`。否则用户新建"收集 0~9 区"奖状时阈值默认是 1，进度会显示 `0 / 1`（像通联 1 个就够）而实际必须集齐。计分型 + 全收集时 `value` 仍是分数门槛，另外还要求集齐。
    - 判定引擎另外产出 **`warnings` + `stats`**（`total_qsos` / `basic_filtered` / `target_matched`），进度区与明细页都会展示——凡是"进度是 0"必须在界面上说清是**目标没命中 / 基础筛选滤掉了 / 日志缺字段 / 没有日志**中的哪一种，不能只给一个 0。

21. **★ 前端按需加载（动态 import）页面要做"旧版本自愈"**（2026-09-24 落地）。
    - 症状：用户报 `Failed to fetch dynamically imported module: …/assets/exportAwardPdf-<旧 hash>.js`。根因不是缓存，而是**还开着的旧页面**引用的 chunk 在重新构建后被删掉了（Vite 按内容 hash 命名）。
    - 处理：`src/lib/lazyImport.js` 的 `importWithRetry(loader, {label})`（导出/预览等按需功能必须走它）+ `main.jsx` 监听 `vite:preloadError`；识别到此类错误就**自动刷新一次**，用 `sessionStorage.ham_chunk_reload_at` 防 15 秒内重复刷新（服务器真故障时不死循环），第二次才抛人话错误。
    - 服务端配套 `express.static` 缓存策略：**`index.html` 必须 `no-cache`**、`/assets/*`（名字含 hash）`immutable, max-age=1y`、`/fonts/*` 等不含 hash 的保持默认校验。改静态托管时别丢掉这三条。
    - ⚠️ **首次导出 PDF 在公网要 30~45 秒**：中文是 404 个子集 woff2，html-to-image 会把用到的字体族下**每个子集**都内联（实测 246 个 `/fonts/` 请求）。已在 `exportAwardPdf.js` 用 `getFontEmbedCSS()` 算一次并**缓存复用**（第二次导出 ~2 秒），并把超时从 30s 放宽到 90s；按钮上也有"首次较慢"的提示。别把超时改回 30s，否则隧道环境下会误报"生成图片超时"。
- ⚠️ **`/api/awards/all_approved` 必须用显式列名**（已剔除 `audit_log` / `reject_reason`）：它是任何登录用户都能调的公开大厅接口，**不要改回 `SELECT *`**，否则每个奖状的审核流水都会泄露。
- 前端：侧边栏按菜单项的 `group` 字段输出分组标题，`admin` 的「后台管理」分组集中了用户管理 / 奖状审核 / 实物材料审核 / 审计日志 / 颁发管理 / 奖状总览。

### 本仓库相对上游的改动

**A. 容器化改动（向后兼容，仅为 Docker 部署）**

1. `server.js`：`CONFIG_FILE` 支持 `process.env.CONFIG_FILE`，让 config.json 落到容器卷。
2. `server.js`：`const PORT = Number(process.env.PORT) || 9993;`（默认不变）。
3. `server.js` 的 `/api/awards/upload-bg`：生成背景图 URL 时支持 `minio.publicEndPoint/publicPort` 或 `MINIO_PUBLIC_ENDPOINT/PORT`。**容器内存对象走服务名 `minio:9000`，浏览器解析不了服务名**，所以对外地址必须另配。
4. `src/main.jsx`：`'./App'` → `'./app.jsx'`（否则 Linux/Docker 构建必然失败）。
5. 新增 Docker 相关文件（见 §3），未改动任何既有业务流程。

> 拉取上游更新遇到冲突时，优先保留上游逻辑，再把上面 4 处源码改动重新套用。

**B. 基础设施改动（M0，2026-09-21）**

6. `index.html`：移除 Tailwind CDN `<script>`；favicon 由 `/vite.svg` 改为 `/favicon.svg`。
7. 新增 `tailwind.config.cjs` + `postcss.config.cjs`；`src/index.css` 从空文件改为 `@tailwind` 入口。
8. 新增 `src/lib/apiFetch.js`（原 `app.jsx` 16–49 行整体抽出）与 `src/lib/routes.js`。
9. `src/app.jsx`：改为 import 上述两个模块（`apiFetch` 行为不变，仅错误信息更健壮）；`App` 内新增 3 个 effect 实现 hash 路由同步与角色守卫。
10. `server.js` 的 `POST /api/awards`：新建分支改为 `RETURNING id` 并回传 `{ success, id }`（**上游不返回 id 是个真实缺陷**，前端因此拿不到新建对象）。
11. 新增 `public/favicon.svg`；删除死代码 `src/install.jsx`（app.jsx 内自带同名组件）。
12. `package.json` 补 `"license": "GPL-3.0"`。

**C. LoTW 直连（M1，2026-09-21）**

13. 新增 `server/services/{adif,awardEngine,lotwClient,lotwSessions}.js` 与 `server/routes/lotw.js`。
14. `server.js`：删除内联的 `parseAdif` 与约 190 行判定逻辑，改为 import 上述模块；`evaluateAward` 变成「取数据 + 调引擎」的薄封装（**对外行为不变**，既有调用方无需改动）。
15. `server.js`：新增 `DEFAULT_LOTW_CONFIG` 与 `applyLotwConfig()`，`config.json` 从此含 `lotw` 段（`enabled` / `timeoutMs` / `batchMaxBytes` / `maxSplitDepth` / `cacheTtlMinutes` / `maxMemoryMb`）。
16. `src/app.jsx`：菜单新增「LoTW 直连」（仅 `user` 角色）+ 渲染分支；`src/lib/routes.js` 登记 `lotw_import`。
17. `src/lib/apiFetch.js`：**修正 401 处理**。原实现把所有 401 都当登录过期并强制登出，导致「旧密码错误」「密码确认失败」这类正常业务错误把用户踢出去；现改为只认 `TOKEN_MISSING` / `TOKEN_INVALID`。**新接口请勿用 401 表示业务失败**。
18. `server.js`：奖状序列号由 `Math.random()` 改为 `crypto.randomInt()` 逐位生成 16 位。
19. 新增 `src/pages/LotwImportView.jsx`（含数据出境提示、连接表单、临时会话状态、奖状判定与申请）。

**D. 奖状模板设计器（M2，2026-09-21）**

20. 新增 `src/lib/awardLayout.js`（布局 schema + 工具）、`src/components/AwardRenderer.jsx`（布局 → DOM）、`src/components/VisualDesigner.jsx`（可视化编辑器）。
21. `src/app.jsx`：`AwardDesigner` 的 Step 3 由「裁剪底图」改为可视化布局；**删除**旧裁剪相关代码（`uploadedImage`/`cropState`/`handleFileSelect`/`generateCroppedImage`/`canvasRef` 及约 90 行死 JSX）。
22. `saveAward` 改为把 `layout`（v2）写进 `awards.layout`（旧版恒写 `[]`）；`bg_url` 与 `layout.canvas.bgUrl` 保持一致（兼容 `MyAwardsView`）。
23. **修复需求⑤**：底图上传改为「显式 ref 触发 + 上传中状态 + 错误提示」，弃用 label 包裹 hidden input 的脆弱写法。

**E. PDF 导出 + 公开校验页（M3，2026-09-21）**

24. 新增 `src/lib/exportAwardPdf.js`：离屏渲染 `AwardRenderer` → `html-to-image` 按 **300 DPI** 栅格化 → `jsPDF` 铺满 `layout.canvas` 尺寸（默认 A4 横版 297×210）。依赖较大，**在 `handleExportPdf` 里动态 `import()`**，不进首屏包（首屏 272 KB，PDF 分包 421 KB）。
25. 新增 `src/pages/VerifyView.jsx`（公开校验页）+ `src/lib/routes.js` 的 `parseVerifyHash` / `isPublicHashRoute`；`App` 在**登录判断之前**拦截 `#/verify/<serial>`，并让 hash 同步 effect 跳过公开路由，避免把校验页 URL 覆盖掉。
26. `server.js`：新增 `/api/verify/:serial`、`/api/verify/:serial/qr`、`/api/media`（同源图片代理）；三者在 `verifyToken` 里放行。
27. `AwardRenderer` 的 `qrcode` 元素：有 `data.serial` 时渲染真二维码（`/api/verify/<serial>/qr`，同源 → 导出不污染画布），否则显示占位框。
28. `server.js` 的 `/api/user/my-awards` 增加返回 `a.layout`（导出 PDF 需要布局）。

**F. 实机体验反馈修复（M3.1，2026-09-21）**

29. 新增 `src/components/PasswordInput.jsx`；登录 / 注册 / 用户中心（改密码、危险操作确认）的密码框全部换用它，支持**显示/隐藏密码**并显式声明 `autoComplete`。
30. `AwardDetailModal` 左侧新增**「实际效果 / 设计底图」切换**（保留原底图预览），实际效果用 `ResponsiveAwardRenderer` + 示例数据渲染；管理员/奖状管理员多一个**「下载效果 PDF」**按钮，可在审核前就看到用户最终拿到的样子。
31. `MyAwardsView` 的卡片改为按真实布局渲染（有布局时），无布局的老奖状自动退回旧卡片；抽出 `buildAwardRenderData()` 让**卡片与 PDF 共用同一份字段组装**。
32. **多等级差异（`levelOverrides`）**：`awardLayout.js` 新增 `resolveElementForLevel` / `hasLevelOverride`；`AwardRenderer` 新增 `ignoreLevelOverrides`；`VisualDesigner` 新增「编辑范围」选择器（默认 / 各等级）+ 覆盖标记 + 清除覆盖。`AwardDesigner` 把 `rules.thresholds` 的名称作为 `levels` 传给编辑器。

### 已知问题（改动相关代码时留意，勿盲改）

- ~~`src/main.jsx` 导入 `./App` 而实际文件名是 `app.jsx`~~ → **已修复**（见上表第 4 条）；此坑在 Docker 构建里是致命错误，不要再改回去。
- ~~`index.html` 引用 `/vite.svg` 但无 `public/` 目录会 404~~ → **已修复**（第 6/11 条）。
- ~~`adminPath` 未校验、前端也不使用~~ → 仍是**名存实亡**的配置，只是不再误导（见 §7 第 6 条）。
- ~~`POST /api/awards` 不返回新 id~~ → **已修复**（第 10 条）。
- `/api/admin/settings` 对 `adminPath` 未做合法性校验，可写入任意字符串。
- 奖状序列号使用 `Math.random()` 生成 16 位数字，非密码学安全（计划改 `crypto.randomInt()`）。
- MinIO 存储桶策略为公开读（`s3:GetObject` 允许 `*`），且**没有 CORS 配置**（做客户端 PDF 导出前必须补），**不要上传敏感内容**。
- `cors()` 未限制 origin，完全放开。
- `jwt.verify` 未显式指定 `algorithms: ['HS256']`。
- **判定引擎的类型陷阱**：`rules.targets.list` 被解析成**字符串**集合，而 `getTargetValue('dxcc')` 直接返回 `qso.dxcc || raw.dxcc`（不做 `String()` 转换）。数据库里 `dxcc` 是 `VARCHAR`、ADIF 也是字符串，所以现在能匹配；**一旦某处传进来数值（如 `291`），会静默匹配失败、得分变 0 且不报错**。改动相关代码时务必保持字符串。
- **`lucide-react` 是 0.263.1，图标集有限**：例如 **没有 `ShieldX`**（用了会构建失败：`"ShieldX" is not exported by ...`），而 `BadgeCheck` / `XCircle` / `ShieldAlert` 有。新增图标前先验证：`node -e "import('lucide-react').then(m=>console.log('Xxx' in m))"`。
- **客户端 PDF 导出的跨域坑**：底图存放在 MinIO（另一个端口）时，画进 canvas 会让画布被污染，`toDataURL` 直接抛 SecurityError。因此导出前会把「本站对象存储」的地址换成同源代理 `/api/media?key=...`；**非本站的图片 URL 无法保证**，会以「导出失败：底图或图片存在跨域限制」报错。
- **React 18 `createRoot` 是异步挂载**：离屏渲染后**不能只等两帧**（实测 rAF 会先于 scheduler 的宏任务执行，`firstElementChild` 仍为 null）。必须轮询等待节点出现（见 `exportAwardPdf.js` 的 `waitForNode`）。

## 8. 安全红线

- **不要滥用 `autoApprove`**：本项目含登录、2FA、管理员审核流。未经确认就自动放行浏览器点击/输入或写操作类工具，可能造成后台数据被误改。
- 该 MCP 配置为**本地开发用途**。不要用持久化浏览器 profile（会带上本机所有登录态），不要指向生产环境域名。
- 提交前确认 `.env` / `config.json` / 数据库口令 / `GITHUB_PERSONAL_ACCESS_TOKEN` 等**未被纳入版本控制**。

## 9. 可用工具（MCP）

| 服务         | 用途                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| `playwright` | 打开本地页面、点击、填表、读 console / network、截图。用于 UI 改动后的**自我验证** |
| `GitHub`     | 读取上游仓库文件、查提交、搜代码、开 issue / PR。用于**对照上游实现**              |

> 改完 UI 后**自行用 Playwright 验证再交付**，不要只描述"应该没问题"。
