# IterTrip 单进程整站一键启动（C-1 方案）
# 用法:  powershell -ExecutionPolicy Bypass -File start.ps1 [-Rebuild] [-Port 8787]
param(
    [switch]$Rebuild,     # 强制重新构建前端
    [int]$Port = 8787
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dist = Join-Path $root "frontend\dist"
$venvPython = Join-Path $root ".venv\Scripts\python.exe"

Write-Host "== IterTrip 单进程整站 ==" -ForegroundColor Green

# 1. Python 环境
if (-not (Test-Path $venvPython)) {
    Write-Host "[1/4] 创建 Python 虚拟环境..." -ForegroundColor Yellow
    python -m venv (Join-Path $root ".venv") | Out-Null
    & $venvPython -m pip install -r (Join-Path $root "backend\requirements.txt") --quiet --disable-pip-version-check
} else {
    Write-Host "[1/4] Python 环境就绪" -ForegroundColor Gray
}

# 2. 前端构建（dist 缺失或 -Rebuild 时执行）
$needBuild = $Rebuild -or -not (Test-Path (Join-Path $dist "index.html"))
if ($needBuild) {
    Write-Host "[2/4] 构建前端 (npm run build)..." -ForegroundColor Yellow
    Push-Location (Join-Path $root "frontend")
    try {
        if (-not (Test-Path "node_modules")) {
            npm install --no-fund --no-audit
            if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }
    } finally { Pop-Location }
} else {
    Write-Host "[2/4] 前端构建产物已存在（-Rebuild 可强制重建）" -ForegroundColor Gray
}

# 3. 局域网地址
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1).IPAddress

# 4. 启动
Write-Host "[3/4] 启动服务 (端口 $Port)..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  本机访问:   http://127.0.0.1:$Port" -ForegroundColor Green
if ($ip) { Write-Host "  手机同 Wi-Fi: http://$($ip):$Port" -ForegroundColor Green }
Write-Host "  API 健康:   http://127.0.0.1:$Port/api/health"
Write-Host ""
Write-Host "[4/4] Ctrl+C 停止" -ForegroundColor Gray
Write-Host ""

& $venvPython -m uvicorn backend.main:app --host 0.0.0.0 --port $Port