/**
 * 备份 PostgreSQL 数据库（含全部账号 / 奖状 / QSO / 颁发记录）
 * ------------------------------------------------------------------
 * 背景：2026-09-25 误执行 `docker compose down -v` 清空了生产卷且无备份，
 *       数据永久丢失。本脚本用于定时备份，避免重蹈覆辙。
 *
 * 用法：
 *   node scripts/backup-db.mjs                 # 备份到 ./backups
 *   node scripts/backup-db.mjs --dir D:\bak    # 指定输出目录
 *   node scripts/backup-db.mjs --keep 30       # 保留最近 30 份（默认 14）
 *   node scripts/backup-db.mjs --container ham-awards-db
 *
 * 备份策略（按顺序尝试，任一成功即止）：
 *   1. docker exec <container> pg_dump       # 容器部署（推荐，宿主无需装 pg_dump）
 *   2. docker compose exec -T db pg_dump     # 同上，按 compose 服务名
 *   3. 本地 pg_dump -h <host> -p <port>      # 本机部署 / 宿主已装 PostgreSQL 客户端
 *
 * 连接参数取自 config.json 的 db 段，可用环境变量覆盖：
 *   DB_HOST / DB_PORT / DB_USER / DB_PASS / DB_NAME
 * 输出为 gzip 压缩的 SQL（.sql.gz），恢复时先 gunzip 再 psql -f。
 *
 * Windows 计划任务（每天 03:00）：
 *   schtasks /create /tn "HamAwards-Backup" /sc daily /st 03:00 ^
 *     /tr "cmd /c node D:\text\Awards\scripts\backup-db.mjs --dir D:\text\Awards\backups"
 *
 * 注意：MinIO 里的奖状底图 / 素材 / 实物照片不在本脚本范围内（需 mc mirror），另行处理。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const argValue = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};

const outDir = path.resolve(argValue('--dir', process.env.BACKUP_DIR || path.join(ROOT, 'backups')));
const keep = Number(argValue('--keep', process.env.BACKUP_KEEP || 14)) || 14;
const container = argValue('--container', process.env.DB_CONTAINER || 'ham-awards-db');

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function loadDbConfig() {
  const configFile = process.env.CONFIG_FILE || path.join(ROOT, 'config.json');
  if (!fs.existsSync(configFile)) {
    throw new Error(`找不到配置文件：${configFile}（系统还没安装？可用 CONFIG_FILE 指定路径）`);
  }
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) {
    throw new Error(`配置文件解析失败：${configFile} — ${e.message}`);
  }
  const db = cfg.db || {};
  return {
    host: process.env.DB_HOST || db.host || 'localhost',
    port: String(process.env.DB_PORT || db.port || 5432),
    user: process.env.DB_USER || db.user || 'postgres',
    password: process.env.DB_PASS || db.password || '',
    database: process.env.DB_NAME || db.database || '',
  };
}

/** 把子进程 stdout 经 gzip 写入文件；失败时抛错并清理 .part 临时文件 */
function dumpToFile(cmd, cmdArgs, env, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.part';
    const out = fs.createWriteStream(tmp);
    const gzip = zlib.createGzip();
    let stderr = '';
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { out.close(); } catch {}
      fs.promises.unlink(tmp).catch(() => {});
      reject(err);
    };

    const child = spawn(cmd, cmdArgs, { env: { ...process.env, ...env }, windowsHide: true });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) fail(new Error(`${cmd} 退出码 ${code}${stderr.trim() ? ' — ' + stderr.trim() : ''}`));
    });
    gzip.on('error', fail);
    out.on('error', fail);
    child.stdout.pipe(gzip).pipe(out);
    out.on('finish', async () => {
      try {
        const { size } = await fs.promises.stat(tmp);
        if (size === 0) throw new Error('导出结果为空（0 字节），判定为失败');
        await fs.promises.rename(tmp, dest);
        settled = true;
        resolve(size);
      } catch (e) {
        fail(e);
      }
    });
  });
}

async function main() {
  const db = loadDbConfig();
  if (!db.database) throw new Error('config.json 的 db 段没有 database，无法确定要备份哪个库');

  await fs.promises.mkdir(outDir, { recursive: true });
  const dest = path.join(outDir, `ham_awards_${timestamp()}.sql.gz`);

  const strategies = [
    {
      name: `docker exec ${container}`,
      cmd: 'docker',
      cmdArgs: ['exec', '-e', `PGPASSWORD=${db.password}`, container, 'pg_dump', '-U', db.user, '-d', db.database],
      env: {},
    },
    {
      name: 'docker compose exec db',
      cmd: 'docker',
      cmdArgs: ['compose', 'exec', '-e', `PGPASSWORD=${db.password}`, '-T', 'db', 'pg_dump', '-U', db.user, '-d', db.database],
      env: {},
    },
    {
      name: '本地 pg_dump',
      cmd: 'pg_dump',
      cmdArgs: ['-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database],
      env: { PGPASSWORD: db.password },
    },
  ];

  let lastErr = null;
  for (const s of strategies) {
    try {
      const size = await dumpToFile(s.cmd, s.cmdArgs, s.env, dest);
      console.log(`✅ 备份完成：${dest}（${(size / 1024 / 1024).toFixed(2)} MB，方式：${s.name}）`);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`⚠️  ${s.name} 失败：${e.message}`);
    }
  }
  if (lastErr) throw new Error(`三种备份方式都失败了，最后一次错误：${lastErr.message}`);

  // 保留最近 keep 份，删除更旧的
  const files = (await fs.promises.readdir(outDir))
    .filter((f) => /^ham_awards_\d{8}-\d{6}\.sql\.gz$/.test(f))
    .sort();
  let removed = 0;
  while (files.length > keep) {
    const old = files.shift();
    await fs.promises.unlink(path.join(outDir, old));
    removed += 1;
  }
  if (removed) console.log(`🧹 已清理 ${removed} 份旧备份（保留最近 ${keep} 份）`);
  console.log(`📦 当前共 ${files.length} 份备份，目录：${outDir}`);
}

main().catch((e) => {
  console.error('❌ 备份失败:', e.message);
  process.exit(1);
});
