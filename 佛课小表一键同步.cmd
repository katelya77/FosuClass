@echo off
setlocal EnableExtensions
chcp 65001 >nul
title 佛课小表一键同步

cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\fosu-publisher\run-publisher.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

exit /b %EXIT_CODE%
