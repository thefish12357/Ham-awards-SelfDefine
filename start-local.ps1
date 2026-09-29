# 一键启动本地全栈：公网隧道(计划任务) + 基础设施(docker db+minio) + 演示实例(docker profile demo) + 后端 9993 + 前端 5173
# 说明：
#   · 环境变量（DEMO_URL / OAUTH_* / TRUST_PROXY …）由 server.js 启动时自动读取项目根 .env，不在此手动注入。
#   · 公网隧道由计划任务 CloudflaredWebTunnel / CloudflaredDemoTunnel 承载（登录时应自动启动），这里兜底确保它们在跑。
# 用法：powershell -ExecutionPolicy Bypass -File d:\text\Awards\start-local.ps1
$ErrorActionPreference = 'Continue'
$root = 'd:\text\Awards'
Set-Location $root

# —— 1. 公网隧道（计划任务兜底）——
"== [1/5] 公网隧道计划任务 =="
foreach ($t in 'CloudflaredWebTunnel', 'CloudflaredDemoTunnel') {
  $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
  if (-not $task) { "未找到计划任务 $t（跳过）"; continue }
  if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $t; "已启动 $t" } else { "$t 已在运行" }
}

# —— 2. 基础设施容器：db + minio ——
# 先停 app 容器：它以 127.0.0.1 绑 9993，会与本机 node server.js 抢端口（双栈“同时监听”陷阱）。
"== [2/5] 基础设施容器 db + minio =="
docker compose stop app 2>$null | Out-Null
docker compose up -d db minio

# —— 3. 演示实例容器（独立 demodb/demoredis/demominio/demo + 一次性 installer/seed）——
# 只点名 demo 相关服务，避免顺带把生产 app/redis 一起拉起（app 会占 9993）。
"== [3/5] 演示实例容器（profile demo）=="
docker compose --profile demo up -d demodb demoredis demominio demo demo-installer demo-seed

# —— 4. 停掉旧的后端 / 前端进程，再重启 ——
"== [4/5] 重启本机后端 / 前端 =="
$p = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%server.js%'" -ErrorAction SilentlyContinue
if ($p) { $p.ProcessId | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; "killed backend PID=$_" } }
$v = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%vite%'" -ErrorAction SilentlyContinue
if ($v) { $v.ProcessId | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; "killed vite PID=$_" } }
Start-Sleep -Seconds 2

# 后端（9993）
Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $root `
  -RedirectStandardOutput 'D:\Downloads\server.out.log' -RedirectStandardError 'D:\Downloads\server.err.log' -WindowStyle Minimized

# 前端（Vite dev server，5173）
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d $root && npm run dev > D:\Downloads\dev.out.log 2>&1" -WindowStyle Minimized

# —— 5. 自检 ——
Start-Sleep -Seconds 14
"== [5/5] 自检 =="
"== 主站后端 9993 system-status（demoUrl 应非空）=="
curl.exe -s http://127.0.0.1:9993/api/system-status
""
"== 演示实例 9994 system-status（demoMode 应为 true）=="
curl.exe -s http://127.0.0.1:9994/api/system-status
""
"== 前端 5173 =="
curl.exe -s -o NUL -w 'http://localhost:5173 -> HTTP %{http_code}' --max-time 10 http://localhost:5173/
""
"== 公网入口（直连，应均 200）=="
curl.exe -s --noproxy '*' -o NUL -w 'demo.hamglory.top -> HTTP %{http_code}' --max-time 20 https://demo.hamglory.top/api/system-status
""
curl.exe -s --noproxy '*' -o NUL -w 'hamglory.top      -> HTTP %{http_code}' --max-time 20 https://hamglory.top/api/system-status
""
"== 演示容器状态 =="
docker ps --format '{{.Names}}  {{.Status}}' | Select-String 'demo'
