# Docker 部署与开发说明

本文件记录在**不动上游业务逻辑**的前提下，为本项目补充的容器化方案。
所有数据都放在 Docker 命名卷里，删除时不会在本机留下残留。

---

## 1. 目录与新增文件

```
Dockerfile              # 多阶段：Vite 构建前端 -> 生产依赖运行时
docker-compose.yml      # db(PostgreSQL) + minio + app + installer（一次性）
docker/autoinstall.mjs  # 首次启动自动调用 /api/install，免手点安装向导
.env.example            # 参数模板，复制成 .env 使用
.dockerignore           # 构建上下文裁剪（排除 node_modules/.env/config.json）
.gitignore              # ★ 上游缺失，config.json 内含 jwtSecret 与数据库口令，必须忽略
```

对上游源码的改动只有 4 处，均为向后兼容的增量修改：

| 文件 | 改动 | 原因 |
|---|---|---|
| `server.js` | `CONFIG_FILE` 支持 `process.env.CONFIG_FILE` | 让 config.json 落到容器卷 `/data`，容器重建不丢安装状态 |
| `server.js` | `const PORT = Number(process.env.PORT) \|\| 9993` | 端口可配置，默认仍是 9993 |
| `server.js` | 生成背景图 URL 时支持 `MINIO_PUBLIC_ENDPOINT/PORT` | 容器内存对象走服务名 `minio:9000`，但浏览器解析不了服务名 |
| `src/main.jsx` | `import App from './App'` → `'./app.jsx'` | **不加会构建失败**：Docker 内是 Linux，大小写敏感 |

---

## 2. 快速开始

```powershell
cd D:\text\Awards
Copy-Item .env.example .env      # 按需修改端口/口令
docker compose up -d --build
```

启动后：

| 服务 | 地址 | 说明 |
|---|---|---|
| 应用 | http://localhost:9993 | 前端与 API 同源 |
| 后台入口 | http://localhost:9993/#/admin | 由 `ADMIN_PATH` 决定 |
| MinIO 控制台 | http://localhost:9001 | 账号见 `.env` |
| PostgreSQL | localhost:55432 | 仅本机连库调试用 |

首次启动由 `installer` 容器自动完成安装（默认管理员 `ADMIN` / `ChangeMe_123`，**请立刻改密**）。
查看初始化过程：

```powershell
docker compose logs installer
```

若想让手工安装向导生效，把 `.env` 里 `AUTO_INSTALL` 改成 `false`，然后打开浏览器填写：
数据库 Host = `db`、Port = `5432`、MinIO Endpoint = `minio` / 9000。

---

## 3. 常用命令

```powershell
docker compose ps                 # 状态（app 是否 healthy）
docker compose logs -f app        # 后端日志
docker compose restart app        # 改了 server.js 后重启
docker compose up -d --build      # 改了前端源码后重建镜像
docker compose down               # 停止并删除容器（数据保留在卷里）
```

### 彻底删除（连数据一起）

```powershell
docker compose down -v --rmi local
```

`-v` 删除 `pgdata` / `miniodata` / `appdata` 三个命名卷，`--rmi local` 删除本地构建的应用镜像。
执行完本机不再有任何本项目的容器、卷、镜像残留。

### 数据备份

```powershell
docker compose exec -T db pg_dump -U ham ham_awards > backup.sql
docker compose exec db cat /data/@config.json    # 不对，config.json 在 app 容器
docker compose exec app cat /data/config.json > config.backup.json
```

---

## 4. 本地开发（改代码即时生效）

全栈容器模式下前端是**构建产物**，改一行代码都要重建镜像，不适合日常开发。
开发时推荐**只用容器跑基础设施**，应用在本机跑：

```powershell
# 1. 只起数据库和对象存储
docker compose up -d db minio

# 2. 本机装依赖并启动（Node 已装，v24）
npm install
node server.js          # 终端 1 -> http://localhost:9993
npm run dev             # 终端 2 -> http://localhost:5173 ，/api 自动代理到 9993
```

访问 http://localhost:5173，安装向导按下面填（注意是**宿主机映射端口**，不是容器内端口）：

| 字段 | 值 |
|---|---|
| DB Host | `localhost` |
| DB Port | `55432`（对应 `.env` 的 `DB_HOST_PORT`） |
| DB User / Pass / Name | 同 `.env` |
| MinIO Endpoint | `localhost`，端口 `9000` |
| Access / Secret Key | 同 `.env` |

本机模式的配置写在项目根目录 `config.json`（已被 `.gitignore` 排除），与容器里的那份互不影响。

---

## 5. 注意事项

- ~~**Tailwind 走外网 CDN**~~ → **已于 2026-09-21 改为本地构建**（`tailwind.config.cjs` / `postcss.config.cjs` + `src/index.css` 的 `@tailwind` 指令），浏览器不再需要外网即可正常显示样式，离线部署可用。对应地 `Dockerfile` 构建阶段已追加 `COPY tailwind.config.cjs postcss.config.cjs` 与 `COPY public ./public`。
- **MinIO 桶是公开读**（`s3:GetObject` 允许 `*`），只放奖状背景图，不要传敏感文件。
- **`config.json` 含 `jwtSecret` 与数据库口令**，已在 `.gitignore` 中排除，切勿提交。
- **端口冲突**：若本机 9993 / 5173 / 9000 / 9001 / 55432 被占用，改 `.env` 里的 `*_HOST_PORT` 即可。
- **`uploads/` 是 multer 的临时目录**，容器内为 `/app/uploads`，不持久化也无妨（文件解析后即删）。
