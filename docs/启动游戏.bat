@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   荒岛物语 - 正在启动游戏服务器
echo   地址: http://localhost:8080
echo   关闭此窗口即停止游戏
echo ============================================
start "" http://localhost:8080
py -m http.server 8080
