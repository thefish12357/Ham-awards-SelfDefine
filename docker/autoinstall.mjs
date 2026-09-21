#!/usr/bin/env node
/**
 * 一次性初始化脚本（由 compose 的 installer 服务执行，跑完即退出）。
 *
 * 目的：绕过浏览器安装向导，让 `docker compose up -d` 之后开箱可用。
 * 原理：系统未安装时 /api/install 是公开接口（见 server.js verifyToken 首行），
 *       本脚本直接调用它，因此无需修改任何既有业务逻辑。
 *
 * 幂等：检测到已安装（config.json 已存在）就直接退出。
 * 关闭：设置 AUTO_INSTALL=false，则改为手动打开安装向导。
 */

const APP_URL = process.env.APP_URL || 'http://app:9993';
const AUTO_INSTALL = String(process.env.AUTO_INSTALL ?? 'true').toLowerCase() !== 'false';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[installer]', ...a);

async function systemStatus() {
  const res = await fetch(`${APP_URL}/api/system-status`);
  if (!res.ok) throw new Error(`system-status HTTP ${res.status}`);
  return res.json();
}

/** 等待应用进程起来 */
async function waitForApp(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      return await systemStatus();
    } catch (e) {
      lastErr = e;
      await sleep(2000);
    }
  }
  throw new Error(`应用 ${APP_URL} 在 ${timeoutMs / 1000}s 内未就绪：${lastErr?.message}`);
}

/** 等待 MinIO 的存活探针，避免 bucket 创建失败被静默吞掉 */
async function waitForMinio(timeoutMs = 120_000) {
  const url = `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/minio/health/live`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        log(`MinIO 就绪：${url}`);
        return true;
      }
    } catch {
      /* 未就绪，继续重试 */
    }
    await sleep(2000);
  }
  log(`警告：MinIO 在 ${timeoutMs / 1000}s 内未就绪（${url}），继续安装，bucket 可稍后重启应用重建`);
  return false;
}

async function install(payload, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${APP_URL}/api/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      // “系统已安装”属于并发/重复执行，视为成功
      if (res.status === 400 && String(data.error || '').includes('已安装')) return data;
      lastErr = new Error(`install HTTP ${res.status}: ${data.error || JSON.stringify(data)}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(3000);
  }
  throw lastErr ?? new Error('安装超时');
}

async function main() {
  const status = await waitForApp();

  if (status.installed) {
    log('系统已安装，跳过初始化。');
    return;
  }
  if (!AUTO_INSTALL) {
    log('AUTO_INSTALL=false，请打开浏览器完成安装向导。');
    return;
  }

  const required = ['DB_USER', 'DB_PASS', 'DB_NAME', 'ADMIN_PASSWORD'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`缺少必需环境变量：${missing.join(', ')}`);

  await waitForMinio();

  const payload = {
    dbHost: process.env.DB_HOST || 'db',
    dbPort: process.env.DB_PORT || '5432',
    dbUser: process.env.DB_USER,
    dbPass: process.env.DB_PASS,
    dbName: process.env.DB_NAME,
    adminCall: process.env.ADMIN_CALLSIGN || 'ADMIN',
    adminPass: process.env.ADMIN_PASSWORD,
    adminPath: process.env.ADMIN_PATH || 'admin',
    minioBucket: process.env.MINIO_BUCKET || 'ham-awards',
    useHttps: false,
    // 容器内访问用服务名；浏览器读图用的对外地址由 app 的 MINIO_PUBLIC_* 环境变量决定
    minio: {
      endPoint: process.env.MINIO_ENDPOINT || 'minio',
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
    },
  };

  await install(payload);
  log(`安装完成。管理员呼号：${payload.adminCall}，后台路径：/#/${payload.adminPath}`);
  log(`访问地址：本机 http://localhost:${process.env.APP_HOST_PORT || 9993}`);
}

main().catch((err) => {
  log('初始化失败：', err?.message || err);
  process.exit(1);
});
