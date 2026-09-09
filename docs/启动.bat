@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   小岛经济学 · 体素经济游戏
echo   正在启动本地服务器 (http://localhost:8080)
echo   首次加载需联网下载 Three.js？已本地化，离线可玩
echo   关闭窗口即停止游戏
echo ============================================
start "" http://localhost:8080
py -m http.server 8080
if errorlevel 1 (
  echo.
  echo [错误] 未找到 Python。请先安装 Python 并勾选 "Add to PATH"。
  echo 或手动运行：python -m http.server 8080
  pause
)
