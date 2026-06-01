@echo off
chcp 65001 > nul
title 佛课小表接力采集代理端

echo 检测本地 Node.js 运行环境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误：未检测到本地 Node.js 环境！
    echo ------------------------------------------------------------------
    echo 接力采集工具需要 Node.js 运行环境才可启动。
    echo 请前往官网下载并安装 Node.js (推荐 LTSC 长期支持版)：
    echo 🔗 https://nodejs.org/zh-cn/download/
    echo ------------------------------------------------------------------
    pause
    exit /b 1
)

if not exist node_modules (
    echo ℹ️ 首次运行，正在为您初始化依赖组件（约需 30 秒，请保持网络畅通）...
    call npm install --no-audit --no-fund --quiet
    if %errorlevel% neq 0 (
        echo ❌ 初始化失败，请检查网络连接并重试。
        pause
        exit /b 1
    )
    echo ✓ 初始化依赖组件完成。
)

echo ⚙️ 正在启动接力采集器...
node relay-agent.js %*
pause
