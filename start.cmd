@echo off
rem 双击启动 IterTrip（等价于：powershell -ExecutionPolicy Bypass -File start.ps1 -Open）
rem 开发模式：start.cmd -Dev    强制重建前端：start.cmd -Rebuild    换端口：start.cmd -Port 8200
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0start.ps1" -Open %*
echo.
pause
