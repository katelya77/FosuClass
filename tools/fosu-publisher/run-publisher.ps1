$ErrorActionPreference = "Stop"

$LauncherArgs = @($args)
$SelfTest = $LauncherArgs -contains "--self-test"
$NonInteractive = ($LauncherArgs -contains "--noninteractive") -or ($env:FOSU_PUBLISHER_NONINTERACTIVE -eq "1")
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$LogRoot = Join-Path $ProjectRoot ".local\publisher-launcher"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogPath = Join-Path $LogRoot "$Stamp.log"
$PublisherRunsRoot = Join-Path $ProjectRoot ".local\publisher-runs"
$LatestPath = Join-Path $PublisherRunsRoot "latest.json"
$Stage = "launcher-start"

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "佛课小表一键同步"
Set-Location -LiteralPath $ProjectRoot

function Write-LauncherLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Invoke-LoggedCommand {
  param(
    [string]$Name,
    [string]$File,
    [string[]]$Arguments,
    [switch]$AllowFailure
  )
  $script:Stage = $Name
  Write-LauncherLog "阶段: $Name"
  Write-LauncherLog ("命令: {0} {1}" -f $File, (($Arguments | ForEach-Object { if ($_ -match "\s") { '"' + $_ + '"' } else { $_ } }) -join " "))
  $output = @()
  try {
    $output = & $File @Arguments 2>&1
    $code = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
  } catch {
    $output += $_.Exception.Message
    $code = 1
  }
  foreach ($line in $output) {
    if ($null -ne $line -and "$line".Length -gt 0) {
      Write-LauncherLog "$line"
    }
  }
  if ($code -ne 0 -and -not $AllowFailure) {
    throw "阶段 $Name 失败，error code: $code"
  }
  return @{
    code = $code
    output = ($output -join "`n")
  }
}

function Invoke-NpmVersion {
  $npmExecPath = "$env:npm_execpath".Trim()
  if ($npmExecPath -and (Test-Path -LiteralPath $npmExecPath) -and ($npmExecPath -match "\.(js|cjs|mjs)$")) {
    return Invoke-LoggedCommand -Name "npm-version" -File $NodeExe -Arguments @($npmExecPath, "--version")
  }
  return Invoke-LoggedCommand -Name "npm-version" -File "cmd.exe" -Arguments @("/d", "/s", "/c", "call npm.cmd --version")
}

function Read-JsonSafe {
  param([string]$Path)
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-LatestRunInfo {
  $latest = Read-JsonSafe -Path $LatestPath
  $runId = ""
  if ($latest) {
    $runId = "$($latest.runId)"
    if (-not $runId -and $latest.receipt) { $runId = "$($latest.receipt.runId)" }
  }
  if (-not $runId) { return $null }
  $runDir = Join-Path $PublisherRunsRoot $runId
  return @{
    runId = $runId
    runDir = $runDir
    statePath = Join-Path $runDir "state.json"
    errorPath = Join-Path $runDir "error.json"
    receiptPath = Join-Path $runDir "receipt.json"
  }
}

function Get-PublisherFailureDetails {
  param([object]$RunInfo)
  $state = $null
  $errorInfo = $null
  $receipt = $null
  if ($RunInfo) {
    $state = Read-JsonSafe -Path $RunInfo.statePath
    $errorInfo = Read-JsonSafe -Path $RunInfo.errorPath
    $receipt = Read-JsonSafe -Path $RunInfo.receiptPath
  }
  $stageText = "$Stage"
  if ($errorInfo -and "$($errorInfo.currentStage)") { $stageText = "$($errorInfo.currentStage)" }
  elseif ($state -and "$($state.currentStage)") { $stageText = "$($state.currentStage)" }

  $codeText = ""
  if ($errorInfo -and "$($errorInfo.code)") { $codeText = "$($errorInfo.code)" }
  elseif ($receipt -and "$($receipt.code)") { $codeText = "$($receipt.code)" }

  $messageText = ""
  if ($errorInfo -and "$($errorInfo.message)") { $messageText = "$($errorInfo.message)" }
  elseif ($receipt -and "$($receipt.message)") { $messageText = "$($receipt.message)" }

  $canResume = $false
  if ($RunInfo -and $state) {
    $statusText = "$($state.status)"
    $currentStageText = "$($state.currentStage)"
    $completedStages = @()
    if ($state.completedStages) { $completedStages = @($state.completedStages) }
    $completedCount = $completedStages.Count
    $canResume = $completedCount -gt 0 -and
      $statusText -ne "completed" -and
      $statusText -ne "no-change" -and
      $currentStageText -ne "local-preflight" -and
      $currentStageText -ne "acquiring-lock"
  }

  return @{
    state = $state
    error = $errorInfo
    receipt = $receipt
    stage = $stageText
    code = $codeText
    message = $messageText
    canResume = $canResume
  }
}

function Show-FailureSummary {
  param([string]$Summary, [int]$Code)
  $runInfo = Get-LatestRunInfo
  $details = Get-PublisherFailureDetails -RunInfo $runInfo
  $stageText = if ($details.stage) { $details.stage } else { $Stage }
  $codeText = if ($details.code) { $details.code } else { "EXIT_$Code" }
  $messageText = if ($details.message) { $details.message } else { $Summary }

  Write-LauncherLog "同步失败"
  Write-LauncherLog "当前阶段: $stageText"
  Write-LauncherLog "error.code: $codeText"
  Write-LauncherLog "error.message: $messageText"
  if ($codeText -eq "ADMIN_API_TOKEN_REQUIRED") {
    Write-LauncherLog "尚未配置管理员同步令牌。请先运行："
    Write-LauncherLog "npm run publisher:token:setup"
  } elseif ($codeText -match "401|ADMIN_API_TOKEN_MISMATCH|UNAUTHORIZED" -or $messageText -match "401") {
    Write-LauncherLog "本机令牌与服务器不一致，请运行："
    Write-LauncherLog "npm run publisher:token:verify"
    Write-LauncherLog "或重新执行 publisher:token:setup -- --rotate"
  }
  if ($runInfo) {
    Write-LauncherLog "state.json: $($runInfo.statePath)"
    Write-LauncherLog "error.json: $($runInfo.errorPath)"
    Write-LauncherLog "receipt.json: $($runInfo.receiptPath)"
    if ($details.canResume) {
      Write-LauncherLog "resume 命令: npm run sync:publish -- --mode=resume --run-id=$($runInfo.runId)"
    } else {
      Write-LauncherLog "resume 命令: 当前失败阶段不可恢复；请重新执行 npm run sync:publish"
    }
  } else {
    Write-LauncherLog "state.json: 未生成"
    Write-LauncherLog "error.json: 未生成"
    Write-LauncherLog "receipt.json: 未生成"
    Write-LauncherLog "resume 命令: 当前失败阶段不可恢复；请重新执行 npm run sync:publish"
  }
  Write-LauncherLog "启动器日志: $LogPath"
}

function Show-SuccessSummary {
  $runInfo = Get-LatestRunInfo
  if (-not $runInfo) {
    Write-LauncherLog "同步完成，但未找到 latest.json。"
    Write-LauncherLog "启动器日志: $LogPath"
    return
  }
  $receipt = Read-JsonSafe -Path $runInfo.receiptPath
  if (-not $receipt) {
    Write-LauncherLog "同步完成，runId: $($runInfo.runId)"
    Write-LauncherLog "receipt 路径: $($runInfo.receiptPath)"
    Write-LauncherLog "启动器日志: $LogPath"
    return
  }
  Write-LauncherLog "同步完成"
  Write-LauncherLog "runId: $($receipt.runId)"
  Write-LauncherLog "Oracle 状态: $($receipt.oracleStatus)"
  Write-LauncherLog "CloudBase 状态: $($receipt.cloudbaseStatus)"
  Write-LauncherLog "receipt 路径: $($runInfo.receiptPath)"
  Write-LauncherLog "是否 no-change: $($receipt.status -eq 'no-change')"
  Write-LauncherLog "启动器日志: $LogPath"
}

function Pause-IfInteractive {
  if ($NonInteractive) { return }
  if (-not [Environment]::UserInteractive) { return }
  try {
    Read-Host "按 Enter 关闭窗口" | Out-Null
  } catch {}
}

$ExitCode = 0
try {
  Write-LauncherLog "佛课小表一键同步"
  Write-LauncherLog "项目目录: $ProjectRoot"
  Write-LauncherLog "开始时间: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")"
  $NodeExe = (Get-Command node -ErrorAction Stop).Source
  Invoke-LoggedCommand -Name "node-version" -File $NodeExe -Arguments @("--version") | Out-Null
  Invoke-NpmVersion | Out-Null

  if ($SelfTest) {
    $script:Stage = "self-test"
    Write-LauncherLog "launcher self-test: ok"
    Write-LauncherLog "自检只检查环境，不抓取课表，不上传。"
  } else {
    $PublisherArgs = $LauncherArgs | Where-Object { $_ -ne "--noninteractive" -and $_ -ne "--self-test" }
    Invoke-LoggedCommand -Name "publisher" -File $NodeExe -Arguments (@("tools/fosu-publisher/publish.js") + $PublisherArgs) | Out-Null
    Show-SuccessSummary
  }
} catch {
  $ExitCode = if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { [int]$LASTEXITCODE } else { 1 }
  Show-FailureSummary -Summary $_.Exception.Message -Code $ExitCode
} finally {
  Pause-IfInteractive
}

exit $ExitCode
