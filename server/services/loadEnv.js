/**
 * 统一的 `.env` 读取模块（不引入 dotenv 依赖）。
 *
 * 为什么需要它：
 *   容器里 `DEMO_URL` / `OAUTH_*` / `TRUST_PROXY` 等是由 docker compose 从 `.env`
 *   插值注入的（见 docker-compose.yml 的 `${DEMO_URL:-}`、`${OAUTH_CLIENT_ID:-}`），
 *   而 `node server.js` **自己不读 `.env`** —— 于是「本地裸跑后端」时这些值全部丢失，
 *   最典型的症状就是落地页「体验演示系统」按钮不显示（`demoUrl` 为空）。
 *   此前只能靠 `npm run dev:all` / `start-local.ps1` 各自补偿，换个启动方式就复发。
 *
 * 现在：`server.js` 把本模块放在**所有 import 之前**导入，导入即加载，从而
 *   「裸跑 node server.js」「npm run dev:all」「start-local.ps1」「pm2」「容器」……
 *   看到的都是同一份环境变量，不再需要任何启动脚本重复「手动 set」。
 *
 * 规则与 dotenv / docker compose 一致：**同名环境变量已存在时不覆盖**（外部注入优先）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 解析并加载一个 .env 文件（KEY=VALUE，支持 `#` 注释行与成对引号）。
 * @param {string} file 文件绝对路径
 * @returns {boolean} 文件是否存在并已读取
 */
export function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    // 去掉成对引号（与 dotenv 行为一致）
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

/** 默认读取项目根的 .env；可用环境变量 ENV_FILE 指定其它文件。 */
export const envFilePath = process.env.ENV_FILE || path.join(rootDir, '.env');

// 导入即加载 —— server.js / scripts/dev.mjs 依赖这个副作用。
export const envLoaded = loadEnvFile(envFilePath);
