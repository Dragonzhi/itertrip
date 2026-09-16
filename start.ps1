# IterTrip 一键启动（本机）
#   .\start.ps1              生产模式：缺 dist 时构建前端 → 单进程起整站（FastAPI 托管 dist，默认 8100）
#   .\start.ps1 -Dev         开发模式：后端 8100(--reload) + 前端 vite 5173(HMR)，各起一个新窗口
#   .\start.ps1 -Rebuild     强制重新构建前端（仅生产模式）
#   .\start.ps1 -Open        启动后自动打开浏览器
#   .\start.ps1 -Port 8200   换端口（仅生产模式；开发模式固定 8100，vite 的 /api 代理写死 8100）
# 想双击启动就用同目录的 start.cmd（等价于 .\start.ps1 -Open）
param(
    [switch]$Rebuild,
    [switch]$Dev,
    [switch]$Open,
    [int]$Port = 8100
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$web = Join-Path $root "frontend"
$dist = Join-Path $web "dist"
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$requirements = Join-Path $root "backend\requirements.txt"

function Test-Busy([int]$p) {
    [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)
}

# 端口上跑的到底是不是本项目的服务（拿 /api/health 认领）
function Test-Itertrip([int]$p) {
    try {
        (Invoke-WebRequest "http://127.0.0.1:$p/api/health" -UseBasicParsing -TimeoutSec 5).Content -match "itertrip-api"
    } catch { $false }
}

Write-Host "== IterTrip 一键启动 ==" -ForegroundColor Green

# 1. Python 环境（venv + 依赖）
if (-not (Test-Path $venvPython)) {
    Write-Host "[1/4] 创建 Python 虚拟环境..." -ForegroundColor Yellow
    python -m venv (Join-Path $root ".venv") | Out-Null
}
& $venvPython -c "import uvicorn, fastapi" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[1/4] 安装后端依赖 (pip install)..." -ForegroundColor Yellow
    & $venvPython -m pip install -r $requirements --quiet --disable-pip-version-check
} else {
    Write-Host "[1/4] Python 环境就绪" -ForegroundColor Gray
}

# 2. 前端依赖（只在 node_modules 缺失时装；npm/pnpm 混装会出现两份 react，见 AGENTS.md）
if (-not (Test-Path (Join-Path $web "node_modules"))) {
    Write-Host "[2/4] 安装前端依赖 (npm install)..." -ForegroundColor Yellow
    Push-Location $web
    try {
        npm install --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
    } finally { Pop-Location }
} else {
    Write-Host "[2/4] 前端依赖就绪" -ForegroundColor Gray
}

# 局域网地址（排除 VPN / 虚拟网卡，手机同 Wi-Fi 用这个）
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and
        $_.InterfaceAlias -notmatch "VPN|Tailscale|Loopback|Bluetooth|蓝牙"
    } | Select-Object -First 1).IPAddress

# ---- 开发模式：后端 + vite 双进程 ----
if ($Dev) {
    if ($Port -ne 8100) {
        Write-Host "  开发模式后端固定 8100（vite 的 /api 代理写死 8100），已忽略 -Port $Port" -ForegroundColor Yellow
        $Port = 8100
    }
    if ((Test-Busy $Port) -and (Test-Busy 5173)) {
        Write-Host "  开发模式已在运行（后端 $Port + 前端 5173），不再重复启动" -ForegroundColor Green
        Write-Host ""
        Write-Host "  http://127.0.0.1:5173/itertrip/" -ForegroundColor Green
        Write-Host ""
        if ($Open) { Start-Process "http://127.0.0.1:5173/itertrip/" }
        return
    }
    if (Test-Busy $Port) { throw "端口 $Port 已被占用（可能已在生产模式运行：http://127.0.0.1:$Port/itertrip/），请先停止它" }
    if (Test-Busy 5173) { throw "端口 5173 已被占用（vite 可能已在运行）" }

    Write-Host "[3/4] 启动后端 $Port + 前端 5173（两个新窗口，关掉窗口即停止）..." -ForegroundColor Yellow
    $null = Start-Process powershell -WorkingDirectory $root -ArgumentList @("-NoExit", "-Command", "& '$venvPython' -m uvicorn backend.main:app --host 0.0.0.0 --port $Port --reload")
    $null = Start-Process powershell -WorkingDirectory $web -ArgumentList @("-NoExit", "-Command", "npm run dev -- --host")

    Start-Sleep -Seconds 4
    if (-not (Test-Busy $Port) -or -not (Test-Busy 5173)) {
        Write-Host "  警告：端口还没起来，去那两个新窗口看报错信息" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "  前端（改代码即时热更）: http://127.0.0.1:5173/itertrip/" -ForegroundColor Green
    if ($ip) { Write-Host "  手机同 Wi-Fi:           http://$($ip):5173/itertrip/" -ForegroundColor Green }
    Write-Host "  后端 API:               http://127.0.0.1:$Port/api/health" -ForegroundColor Gray
    Write-Host "  停止: 关掉那两个新窗口" -ForegroundColor Gray
    Write-Host ""
    if ($Open) { Start-Process "http://127.0.0.1:5173/itertrip/" }
    return
}

# ---- 生产模式：构建前端 + 单进程起整站 ----
if (Test-Busy $Port) {
    if (Test-Itertrip $Port) {
        Write-Host "  服务已在运行（端口 $Port），不再重复启动" -ForegroundColor Green
        Write-Host ""
        Write-Host "  http://127.0.0.1:$Port/itertrip/" -ForegroundColor Green
        Write-Host ""
        if ($Open) { Start-Process "http://127.0.0.1:$Port/itertrip/" }
        return
    }
    throw "端口 $Port 已被占用（不是 IterTrip 服务），请先停止占用它的进程"
}

if ($Rebuild -or -not (Test-Path (Join-Path $dist "index.html"))) {
    Write-Host "[3/4] 构建前端 (npm run build)..." -ForegroundColor Yellow
    Push-Location $web
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }
    } finally { Pop-Location }
} else {
    Write-Host "[3/4] 前端构建产物已存在（-Rebuild 可强制重建）" -ForegroundColor Gray
}

Write-Host "[4/4] 启动服务 (端口 $Port)..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  本机访问:     http://127.0.0.1:$Port/itertrip/" -ForegroundColor Green
if ($ip) { Write-Host "  手机同 Wi-Fi: http://$($ip):$Port/itertrip/" -ForegroundColor Green }
Write-Host "  API 健康:     http://127.0.0.1:$Port/api/health" -ForegroundColor Gray
Write-Host ""
Write-Host "  Ctrl+C 停止" -ForegroundColor Gray
Write-Host ""

if ($Open) { Start-Process "http://127.0.0.1:$Port/itertrip/" }

& $venvPython -m uvicorn backend.main:app --host 0.0.0.0 --port $Port
