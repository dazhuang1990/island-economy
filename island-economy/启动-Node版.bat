@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   荒岛物语 · 体素养成游戏
echo   正在启动本地服务器 (http://localhost:8080)
echo   Three.js 已本地化，离线可玩
echo   关闭窗口即停止游戏
echo ============================================
start "" http://localhost:8080
npx http-server -p 8080 -c-1
if errorlevel 1 (
  echo.
  echo [错误] 未找到 Node.js。请先安装 Node.js。
  echo 下载地址: https://nodejs.org
  pause
)
