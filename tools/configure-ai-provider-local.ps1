param(
  [string]$Provider = "deepseek"
)

$ErrorActionPreference = "Stop"

function Find-ProjectRoot {
  $current = Split-Path -Parent $MyInvocation.ScriptName
  while ($current -and !(Test-Path (Join-Path $current "package.json"))) {
    $parent = Split-Path -Parent $current
    if ($parent -eq $current) { break }
    $current = $parent
  }
  if (!(Test-Path (Join-Path $current "package.json"))) {
    throw "Cannot locate project root."
  }
  return (Resolve-Path $current).Path
}

function Set-EnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )
  $content = ""
  if (Test-Path $Path) {
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  }
  $line = "$Key=$Value"
  if ($content -match "(?m)^\s*$([regex]::Escape($Key))\s*=") {
    $content = [regex]::Replace($content, "(?m)^\s*$([regex]::Escape($Key))\s*=.*$", $line)
  } else {
    if ($content -and !$content.EndsWith("`n")) { $content += "`n" }
    $content += "$line`n"
  }
  Set-Content -LiteralPath $Path -Value $content -Encoding UTF8
}

function Ensure-GitIgnoreLine {
  param(
    [string]$Path,
    [string]$Line
  )
  $content = ""
  if (Test-Path $Path) {
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  }
  if ($content -notmatch "(?m)^\s*$([regex]::Escape($Line))\s*$") {
    if ($content -and !$content.EndsWith("`n")) { $content += "`n" }
    $content += "$Line`n"
    Set-Content -LiteralPath $Path -Value $content -Encoding UTF8
  }
}

$root = Find-ProjectRoot
$envPath = Join-Path $root "server\.env"
$examplePath = Join-Path $root "server\.env.example"
$gitignorePath = Join-Path $root ".gitignore"

if (!(Test-Path $envPath)) {
  if (Test-Path $examplePath) {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
  } else {
    New-Item -ItemType File -Path $envPath -Force | Out-Null
  }
}

Ensure-GitIgnoreLine -Path $gitignorePath -Line ".env"
Ensure-GitIgnoreLine -Path $gitignorePath -Line ".env.local"
Ensure-GitIgnoreLine -Path $gitignorePath -Line "*.secret"
Ensure-GitIgnoreLine -Path $gitignorePath -Line "server/.env"
Ensure-GitIgnoreLine -Path $gitignorePath -Line "local.secrets.json"

$provider = $Provider.ToLowerInvariant()
if ($provider -ne "deepseek" -and $provider -ne "mock") {
  throw "Provider must be deepseek or mock for local one-click setup."
}

Set-EnvValue -Path $envPath -Key "AI_AGENT_ENABLED" -Value $(if ($provider -eq "deepseek") { "true" } else { "false" })
Set-EnvValue -Path $envPath -Key "AI_PROVIDER" -Value $provider
Set-EnvValue -Path $envPath -Key "AI_MODEL" -Value "deepseek-v4-flash"
Set-EnvValue -Path $envPath -Key "AI_REASONING_MODEL" -Value "deepseek-v4-pro"
Set-EnvValue -Path $envPath -Key "AI_BASE_URL" -Value "https://api.deepseek.com"
Set-EnvValue -Path $envPath -Key "AI_TIMEOUT_MS" -Value "15000"
Set-EnvValue -Path $envPath -Key "AI_MAX_TOKENS" -Value "1200"
Set-EnvValue -Path $envPath -Key "AI_TEMPERATURE" -Value "0.1"
Set-EnvValue -Path $envPath -Key "AI_THINKING_ENABLED" -Value "false"
Set-EnvValue -Path $envPath -Key "AI_REASONING_EFFORT" -Value "medium"
Set-EnvValue -Path $envPath -Key "AI_PROVIDER_JSON_REPAIR" -Value "true"
Set-EnvValue -Path $envPath -Key "DEEPSEEK_STRICT_JSON_MODE" -Value "false"

if ($provider -eq "deepseek") {
  $key = $env:FOSUCLASS_DEEPSEEK_API_KEY
  if (!$key) { $key = $env:DEEPSEEK_API_KEY }
  if (!$key) { $key = $env:AI_API_KEY }
  if (!$key) {
    $secure = Read-Host "请输入 DeepSeek API Key（不会回显）" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
  }
  if ($key) {
    Set-EnvValue -Path $envPath -Key "AI_API_KEY" -Value $key
  }
}

Push-Location $root
try {
  npm run test:ai-agent-safety
  npm run test:ai-agent-mock-fallback
  Write-Host "AI provider local config complete. Key is stored only in server/.env."
} finally {
  Pop-Location
}
