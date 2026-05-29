param(
  [string]$ChunkSize = "10"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SyncDir = Resolve-Path (Join-Path $ScriptDir "..")
$LogDir = Join-Path $SyncDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $LogDir "sync-release-$timestamp.log"

Set-Location $SyncDir

$proxyNames = @(
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy"
)

foreach ($name in $proxyNames) {
  if (Test-Path "Env:\$name") {
    Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
  }
}

$env:NO_PROXY = "*"
$env:no_proxy = "*"
$env:SYNC_DISABLE_PROXY = "true"
$env:SYNC_UPLOAD_CHUNK_SIZE = $ChunkSize

"[$(Get-Date -Format s)] FosuClass sync:release started in $SyncDir" | Tee-Object -FilePath $logPath
"[$(Get-Date -Format s)] SYNC_UPLOAD_CHUNK_SIZE=$env:SYNC_UPLOAD_CHUNK_SIZE" | Tee-Object -FilePath $logPath -Append

npm run sync:release 2>&1 | Tee-Object -FilePath $logPath -Append
$exitCode = $LASTEXITCODE

"[$(Get-Date -Format s)] sync:release exit code: $exitCode" | Tee-Object -FilePath $logPath -Append
exit $exitCode
