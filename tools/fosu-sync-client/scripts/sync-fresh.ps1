# FosuClass 佛大课表 - 一键完整同步脚本 (Windows PowerShell)
# 作用：清理可能残留的系统代理，保证与 VPS 上传的连通性，拉取教务系统最新数据并发布。

# 切换到同步客户端目录
Set-Location -Path "$PSScriptRoot\.."

Write-Host "🧹 正在清理代理环境变量以避免上传 VPS 时发生连通性问题..." -ForegroundColor Cyan
$env:HTTP_PROXY=$null
$env:HTTPS_PROXY=$null
$env:ALL_PROXY=$null
$env:http_proxy=$null
$env:https_proxy=$null
$env:all_proxy=$null

Write-Host "⚙️ 正在配置一键完整同步的环境变量..." -ForegroundColor Cyan
$env:SYNC_DISABLE_PROXY="true"
$env:SYNC_CLASS_SCOPE="all"
$env:SYNC_CLASS_MAX_CONCURRENCY="1"
$env:SYNC_CLASS_REQUEST_DELAY_MS="900"
$env:SYNC_UPLOAD_CHUNK_SIZE="10"
$env:SYNC_RELEASE_OFFLINE="true"

Write-Host "🚀 开始执行一键完整同步命令 (npm run sync:fresh)..." -ForegroundColor Green
npm run sync:fresh
