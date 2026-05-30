# FosuClass 佛课小表 - 一键快速同步脚本 (Windows PowerShell)
# 作用：同一学期内，不拉取 catalog 和 majors，只重新抓取全校课表并发布上线。

# 切换到同步客户端目录
Set-Location -Path "$PSScriptRoot\.."

Write-Host "🧹 正在清理代理环境变量以避免上传 VPS 时发生连通性问题..." -ForegroundColor Cyan
$env:HTTP_PROXY=$null
$env:HTTPS_PROXY=$null
$env:ALL_PROXY=$null
$env:http_proxy=$null
$env:https_proxy=$null
$env:all_proxy=$null

Write-Host "⚙️ 正在配置快速同步的环境变量..." -ForegroundColor Cyan
$env:SYNC_DISABLE_PROXY="true"
$env:SYNC_CLASS_SCOPE="all"
$env:SYNC_CLASS_MAX_CONCURRENCY="1"
$env:SYNC_CLASS_REQUEST_DELAY_MS="900"
$env:SYNC_UPLOAD_CHUNK_SIZE="10"
$env:SYNC_RELEASE_OFFLINE="true"

Write-Host "🚀 开始执行快速同步命令 (npm run sync:quick)..." -ForegroundColor Green
npm run sync:quick
