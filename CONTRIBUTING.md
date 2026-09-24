# 参与贡献

感谢你对本项目的兴趣！以下是本地开发与提交的精简约定；完整架构、目录与「雷区」见 [`AGENTS.md`](./AGENTS.md)。

## 开发环境

- Node.js 16+（实测 v24）、PostgreSQL 12+、MinIO
- 推荐用 Docker 只起基础设施，应用本机热改：

  ```bash
  docker compose up -d db minio      # 只跑 PostgreSQL + MinIO
  node server.js                     # 后端 http://localhost:9993
  npm run dev                        # 可选，前端热更新 http://localhost:5173
  ```

- 首次启动进入安装向导，或用 `node docker/autoinstall.mjs` 免手点完成安装（详见 `DOCKER.md`）。

## 分支约定

- 主分支 `release`（对应公开仓库的 `main`）保持可构建、可运行，是部署状态。
- 新功能请基于 `release` 开特性分支，PR 合并回 `release`。
- **切勿将上游含敏感历史的提交推送到公开仓库**（上游某次提交曾含 `config.json` 密钥，公开归档已用孤儿分支隔离，详见 `AGENTS.md` 开头提示）。

## 代码规范（要点）

1. `src/app.jsx` 是单体文件，**只做局部替换**，新功能放 `src/lib`、`src/components`、`src/pages`、`server/services`、`server/routes`。
2. 样式只用 Tailwind 类名；Tailwind 配置须保持 `.cjs` 后缀（`package.json` 是 `type: module`）。
3. 新增接口统一走 `src/lib/apiFetch.js`，**勿用 401 表达业务失败**（用 400/403/409）。
4. 奖状判定逻辑只有一份：`server/services/awardEngine.js`；布局 schema 只有一份：`src/lib/awardLayout.js`。
5. 字体仅允许开源（SIL OFL / Apache-2.0）或系统自带字体，禁止商业字体（详见 `AGENTS.md` §7 第 12 条）。

## 许可证

本项目以 **GPL-3.0** 发布，须保留 [`LICENSE`](./LICENSE) 与字体许可文件（`public/fonts/LICENSE-*.txt`）。
派生作品对外分发时同样须以 GPL-3.0 提供源码。
