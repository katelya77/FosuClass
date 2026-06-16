$ErrorActionPreference = "Stop"

$Rotate = $false
$CopyToClipboard = $false
foreach ($Item in $args) {
  if ($Item -eq "--rotate" -or $Item -eq "-rotate" -or $Item -eq "-Rotate") { $Rotate = $true }
  if ($Item -eq "--copy" -or $Item -eq "-copy" -or $Item -eq "-Copy") { $CopyToClipboard = $true }
}

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location -LiteralPath $ProjectRoot

function Write-SetupLine {
  param([string]$Message)
  Write-Host $Message
}

function New-AdminApiToken {
  $Bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($Bytes)
  return ([System.BitConverter]::ToString($Bytes)).Replace("-", "").ToLowerInvariant()
}

function Get-UserAdminApiToken {
  return [Environment]::GetEnvironmentVariable("ADMIN_API_TOKEN", "User")
}

function Get-ProcessAdminApiToken {
  return $env:ADMIN_API_TOKEN
}

function Get-GhPath {
  $Command = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $Command) { return "" }
  return $Command.Source
}

function Test-GhAuthenticated {
  param([string]$GhPath)
  if (-not $GhPath) { return $false }
  & $GhPath auth status *> $null
  return $LASTEXITCODE -eq 0
}

function Get-GhRepo {
  param([string]$GhPath)
  if (-not $GhPath) { return "katelya77/FosuClass" }
  $Repo = (& $GhPath repo view --json nameWithOwner -q ".nameWithOwner" 2>$null)
  if ($LASTEXITCODE -eq 0 -and "$Repo".Trim()) { return "$Repo".Trim() }
  return "katelya77/FosuClass"
}

$ProcessToken = "$(Get-ProcessAdminApiToken)".Trim()
$UserToken = "$(Get-UserAdminApiToken)".Trim()
$Token = ""
$TokenSource = ""

if ($Rotate) {
  $Token = New-AdminApiToken
  $TokenSource = "rotated"
  [Environment]::SetEnvironmentVariable("ADMIN_API_TOKEN", $Token, "User")
  Write-SetupLine "Windows User ADMIN_API_TOKEN 已更新。"
  Write-SetupLine "请关闭并重新打开 PowerShell，或设置当前进程环境变量。"
} elseif ($ProcessToken) {
  $Token = $ProcessToken
  $TokenSource = "process"
  if (-not $UserToken) {
    [Environment]::SetEnvironmentVariable("ADMIN_API_TOKEN", $Token, "User")
    Write-SetupLine "已把当前进程 ADMIN_API_TOKEN 写入 Windows User 环境变量。"
  } elseif ($UserToken -ne $ProcessToken) {
    Write-SetupLine "当前进程 ADMIN_API_TOKEN 与 Windows User 值不一致；未自动覆盖。需要换新值时运行：npm run publisher:token:setup -- --rotate"
  }
} elseif ($UserToken) {
  $Token = $UserToken
  $TokenSource = "windows-user"
  Write-SetupLine "检测到 Windows User ADMIN_API_TOKEN。"
  Write-SetupLine "请关闭并重新打开 PowerShell，或设置当前进程环境变量。"
} else {
  Write-SetupLine "尚未配置 ADMIN_API_TOKEN。"
  Write-SetupLine "如需生成新令牌并写入本机与 GitHub Secret，请运行：npm run publisher:token:setup -- --rotate"
  exit 1
}

$GhPath = Get-GhPath
$Repo = Get-GhRepo -GhPath $GhPath
if ($GhPath -and (Test-GhAuthenticated -GhPath $GhPath)) {
  $Token | & $GhPath secret set ADMIN_API_TOKEN --repo $Repo --app actions
  if ($LASTEXITCODE -ne 0) {
    Write-SetupLine "GitHub Secret ADMIN_API_TOKEN 设置失败；未打印令牌。"
    exit 1
  }
  Write-SetupLine "GitHub Actions Secret ADMIN_API_TOKEN 已设置。"
} else {
  Write-SetupLine "gh CLI 未安装或未登录，GitHub Secret 未自动设置。"
  if ($CopyToClipboard) {
    Set-Clipboard -Value $Token
    Write-SetupLine "令牌已复制到剪贴板。"
  } else {
    Write-SetupLine "如需复制到剪贴板，请重新运行：npm run publisher:token:setup -- --copy"
  }
  Write-SetupLine "请在 GitHub 页面设置 Secret："
  Write-SetupLine "https://github.com/katelya77/FosuClass/settings/secrets/actions"
  Write-SetupLine "Secret 名称：ADMIN_API_TOKEN"
}

Write-SetupLine "localConfigured=true"
Write-SetupLine "tokenSource=$TokenSource"
Write-SetupLine "未打印令牌值。"
