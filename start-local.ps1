# 一键启动本地全栈：公网隧道(计划任务) + 基础设施(docker db+minio) + 演示实例(docker profile demo) + 构建 dist + 后端 9993(托管 dist) + 前端 5173(仅供本机开发)
# 说明：
#   · 线上主站 https://hamglory.top = cloudflared `web` 隧道 → http://127.0.0.1:9993，由 **server.js 直接托管 dist 产物**（2026-09-30 起）。
#     ⚠️ `web` / `demo` 两个隧道都是「**云端托管配置**」（Cloudflare 仪表盘/API 下发 ingress），
#        计划任务里的 `--url` 会被**忽略** —— 要改指向必须改云端配置（见 AGENTS.md §2）。
#   · 因此 **改完前端必须 `npm run build`**：公网服务的是 dist（server.js 每次请求读磁盘，build 完立即生效，无需重启）。
#     本文件已把 build 纳入启动流程；日常开发仍建议用 `npm run dev`（5174/5173 热更新）预览，改完再 build。
#   · 环境变量（DEMO_URL / OAUTH_* / TRUST_PROXY …）由 server.js 启动时自动读取项目根 .env，不在此手动注入。
#   · ★ Vite 开发预览（5173）**默认不启动**：线上主站服务的是 dist 产物，5173 与线上无关，
#     常驻只是白占内存/端口。本机改前端想要热更新时再加 -WithDev（见下方用法）。
# 用法：powershell -ExecutionPolicy Bypass -File d:\text\Awards\start-local.ps1
#       powershell -ExecutionPolicy Bypass -File d:\text\Awards\start-local.ps1 -WithDev   # 额外启动 5173 热更新
param([switch]$WithDev)
$ErrorActionPreference = 'Continue'
$root = 'd:\text\Awards'
Set-Location $root

# —— 1. 公网隧道（计划任务兜底）——
"== [1/6] 公网隧道计划任务 =="
foreach ($t in 'CloudflaredWebTunnel', 'CloudflaredDemoTunnel') {
  $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
  if (-not $task) { "未找到计划任务 $t（跳过）"; continue }
  if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $t; "已启动 $t" } else { "$t 已在运行" }
}

# —— 2. 基础设施容器：db + minio ——
# 先停 app 容器：它以 127.0.0.1 绑 9993，会与本机 node server.js 抢端口（双栈“同时监听”陷阱）。
"== [2/6] 基础设施容器 db + minio =="
docker compose stop app 2>$null | Out-Null
docker compose up -d db minio

# —— 3. 演示实例容器（独立 demodb/demoredis/demominio/demo + 一次性 installer/seed）——
# 只点名 demo 相关服务，避免顺带把生产 app/redis 一起拉起来（app 会占 9993）。
"== [3/6] 演示实例容器（profile demo）=="
docker compose --profile demo up -d demodb demoredis demominio demo demo-installer demo-seed

# —— 4. 构建前端产物（线上主站直接服务 dist，必须是最新的）——
"== [4/6] 构建前端产物 dist =="
& npm run build
if ($LASTEXITCODE -ne 0) {
  "!! 构建失败（exit=$LASTEXITCODE）：公网会继续服务上一次的旧 dist（或 404），请先修好再启动。"
}

# —— 5. 停掉旧的后端 / 前端进程，再重启 ——
"== [5/6] 重启本机后端 / 前端 =="
$p = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%server.js%'" -ErrorAction SilentlyContinue
if ($p) { $p.ProcessId | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; "killed backend PID=$_" } }
# 只在要重启 dev 时才动 vite —— 否则会把手动开的开发预览也一起杀掉
if ($WithDev) {
  $v = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%vite%'" -ErrorAction SilentlyContinue
  if ($v) { $v.ProcessId | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; "killed vite PID=$_" } }
}
Start-Sleep -Seconds 2

# 后端（9993）：同时就是**公网主站的源站**（托管 dist + 全部 /api）
Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $root `
  -RedirectStandardOutput 'D:\Downloads\server.out.log' -RedirectStandardError 'D:\Downloads\server.err.log' -WindowStyle Minimized

# 前端（Vite dev server，5173）：**默认不启动**（线上不经过它，常驻只是白占资源）
if ($WithDev) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d $root && npm run dev > D:\Downloads\dev.out.log 2>&1" -WindowStyle Minimized
  "已启动 Vite 开发预览（http://localhost:5173，仅供本机）"
} else {
  "跳过 Vite 开发预览（5173）—— 需要热更新时用 -WithDev，或手动 npm run dev"
}

# —— 6. 自检 ——
Start-Sleep -Seconds 14
"== [6/6] 自检 =="
"== 主站后端 9993 system-status（demoUrl 应非空）=="
curl.exe -s http://127.0.0.1:9993/api/system-status
""
"== 演示实例 9994 system-status（demoMode 应为 true）=="
curl.exe -s http://127.0.0.1:9994/api/system-status
""
"== 前端 5173（本机开发用，默认未启动）=="
if ($WithDev) {
  curl.exe -s -o NUL -w 'http://localhost:5173 -> HTTP %{http_code}' --max-time 10 http://localhost:5173/
} else {
  "（已跳过：未启动 Vite 开发预览，不影响线上主站）"
}
""
"== 公网主站是否已在服务 dist 产物（出现 /@vite/client 就说明隧道 ingress 还指着 5173）=="
$html = (curl.exe -s --noproxy '*' --max-time 20 https://hamglory.top/) -join "`n"
if ($html -match '/@vite/client') { "!! 公网仍在服务 Vite dev —— 检查 web 隧道云端配置是否指向 http://127.0.0.1:9993" }
elseif ($html -match '/assets/index-') { "OK：公网主站为 dist 产物" }
else { "?? 公网主站返回内容异常（既非 dev 也非 dist），请手工确认" }
""
"== 公网入口（直连，应均 200）=="
curl.exe -s --noproxy '*' -o NUL -w 'demo.hamglory.top -> HTTP %{http_code}' --max-time 20 https://demo.hamglory.top/api/system-status
""
curl.exe -s --noproxy '*' -o NUL -w 'hamglory.top      -> HTTP %{http_code}' --max-time 20 https://hamglory.top/api/system-status
""
"== 演示容器状态 =="
docker ps --format '{{.Names}}  {{.Status}}' | Select-String 'demo'
