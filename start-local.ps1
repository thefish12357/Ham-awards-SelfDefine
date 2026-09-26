# 一键启动本地全栈：后端 9993 + 前端 5173（Vite dev server）
# 作用：本地裸跑 `node server.js` 不读 .env，落地页「体验演示系统」按钮依赖
#       DEMO_URL 环境变量，这里统一注入，避免每次手动 set。
# 用法：powershell -ExecutionPolicy Bypass -File d:\text\Awards\start-local.ps1
$ErrorActionPreference = 'Continue'
$root = 'd:\text\Awards'

# —— 注入落地页演示按钮所需变量（仅这几个，不整体加载 .env，避免把 .env 里可疑的 OAUTH_CLIENT_ID 覆盖进 config.json）——
$env:DEMO_URL          = 'https://demo.hamglory.top'
$env:DEMO_USER         = 'DEMO'
$env:DEMO_USER_PASSWORD = 'demo123456'

# —— 停掉旧的后端 / 前端进程 ——
$p = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%server.js%'" -ErrorAction SilentlyContinue
if ($p) { $p.ProcessId | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; "killed backend PID=$_" } }
$v = Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%vite%'" -ErrorAction SilentlyContinue
if ($v) { $v.ProcessId | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; "killed vite PID=$_" } }
Start-Sleep -Seconds 2

# —— 启动后端 ——
Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $root `
  -RedirectStandardOutput 'D:\Downloads\server.out.log' -RedirectStandardError 'D:\Downloads\server.err.log' -WindowStyle Minimized

# —— 启动前端（Vite dev server，5173）——
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d $root && npm run dev > D:\Downloads\dev.out.log 2>&1" -WindowStyle Minimized

Start-Sleep -Seconds 14
"== 后端 system-status（看 demoUrl）=="
curl.exe -s http://127.0.0.1:9993/api/system-status
""
"== 前端 5173 =="
curl.exe -s -o NUL -w 'http://localhost:5173 -> HTTP %{http_code}\n' --max-time 10 http://localhost:5173/
