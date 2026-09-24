# Changelog

本项目基于上游 [BH2VSQ/Ham-awards-SelfDefine](https://github.com/BH2VSQ/Ham-awards-SelfDefine) v2.2.0（GPL-3.0）二次开发，已获作者授权。

## [2.2.0] 二次开发生命周期

### 基础设施 (M0, 2026-09-21)
- Tailwind 改本地构建（去外网 CDN）；补 Hash 路由、抽出 `src/lib/`。
- 修复 `POST /api/awards` 不返回新 id；删除死代码 `src/install.jsx`。
- `package.json` 补 `"license": "GPL-3.0"`。

### LoTW 直连 (M1, 2026-09-21)
- 服务端代理拉取 LoTW 报表，走**内存会话**（不落盘、不落库、关闭即清除）。
- ADIF 解析与奖状判定复用 `server/services/{adif,awardEngine}.js`，统一判定引擎。

### 可视化奖状设计器 (M2, 2026-09-21)
- 拖拽布局（文字/形状/图片/二维码）、多等级 `levelOverrides`、图层与撤销重做。
- 布局统一为 mm 单位 v2 schema（`src/lib/awardLayout.js`）。

### PDF 导出 + 公开校验页 (M3, 2026-09-21)
- 客户端 300 DPI 栅格化导出所见即所得 PDF；内置思源黑体/宋体（SIL OFL 1.1）。
- 公开校验页 + 脱敏二维码防伪（`#/verify/<serial>`）。

### 实物材料审核 (M4, 2026-09-22)
- QSL 卡片 / EYEBALL / SWL 三类材料；私有桶存储、presigned 查看、审核通过/驳回即焚。
- 卡片确认回写 QSO 的 `qsl_rcvd`，真实参与判定。

### 通知 + 角色升级 (M4.1, 2026-09-22)
- 站内通知铃铛 + 未读红点；普通用户申请成为奖状管理员，由 admin 审核。

### HamCQ OAuth / 全站审计 (M5 / M6, 2026-09-23)
- HamCQ OAuth2 接入材料（`docs/hamcq-oauth-application.md`）。
- 全站操作审计日志（`server/services/audit.js`，`#/admin_logs`）。

### DXCC 数据同步 (2026-09-24)
- `lookupDxcc()` 前缀解析；后台「更新 DXCC 库」按钮调 `/api/admin/cty/refresh`。
- `scripts/update-cty.mjs` 一键同步 Country Files，附 `data/NOTICE.md` 来源声明。
