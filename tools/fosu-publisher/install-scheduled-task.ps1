param(
  [string]$TaskName = "FosuClassPublisherRoutine",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
if (-not $npm) {
  $npm = (Get-Command npm -ErrorAction SilentlyContinue)
}
if (-not $npm) {
  throw "npm was not found in PATH."
}

$action = New-ScheduledTaskAction `
  -Execute $npm.Source `
  -Argument "run sync:publish:routine" `
  -WorkingDirectory $ProjectRoot

$triggerMorning = New-ScheduledTaskTrigger -Daily -At 06:30
$triggerEvening = New-ScheduledTaskTrigger -Daily -At 18:30

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger @($triggerMorning, $triggerEvening) `
  -Settings $settings `
  -Principal $principal `
  -Description "FosuClass routine publisher. Does not store campus password or tokens." `
  -Force | Out-Null

Write-Host "已安装计划任务: $TaskName"
Write-Host "时间: 每天 06:30 和 18:30"
Write-Host "命令: npm run sync:publish:routine"
Write-Host "项目: $ProjectRoot"
