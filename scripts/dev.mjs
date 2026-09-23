#!/usr/bin/env node
/**
 * 一条命令同时启动「后端 9993」+「前端 Vite 5173」。
 *
 * 用法：npm run dev:all
 *   - 两个服务共用这个终端，日志交错输出
 *   - Ctrl+C 会同时结束两个服务（含 Windows 下的子进程树）
 *   - 只想改前端、后端用别的终端跑时，仍可用 npm run dev
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const children = [];
let shuttingDown = false;

function killTree(child, label) {
  if (!child || child.exitCode !== null) return;
  try {
    if (isWin) {
      // shell:true 启动的进程下面还挂着 cmd，必须杀整棵树
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // 进程已退出时忽略
  }
  console.log(`[${label}] 已停止`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child, label } of children) killTree(child, label);
  process.exit(code);
}

function start(label, command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...opts,
  });

  child.on('error', (err) => {
    console.error(`[${label}] 启动失败：${err.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${label}] 已退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`);
    shutdown(code ?? 0);
  });

  children.push({ child, label });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('启动后端 http://localhost:9993 ...');
start('后端', process.execPath, ['server.js']);

console.log('启动前端 http://localhost:5173 ...');
// Windows 上 npm 是 .cmd，必须走 shell；用整串命令避免参数被 shell 拆错
start('前端', 'npm run dev', [], { shell: true });

console.log('\n两个服务已启动，浏览器打开 http://localhost:5173 即可。按 Ctrl+C 全部停止。\n');
