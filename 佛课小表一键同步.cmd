@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 后再重试。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，请检查 Node.js 安装是否完整。
  pause
  exit /b 1
)

echo [佛课小表] 开始一键同步发布...
echo 项目目录: %CD%
echo.

npm run sync:publish
set EXIT_CODE=%ERRORLEVEL%

echo.
if "%EXIT_CODE%"=="0" (
  echo [佛课小表] 同步发布流程结束。
) else (
  echo [佛课小表] 同步发布失败，退出码: %EXIT_CODE%
)
echo 请查看上方最终回执。
pause
exit /b %EXIT_CODE%
