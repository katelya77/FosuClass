# run-restructure.ps1 — 评审叙事重构全链路（一次执行，可安全重跑）
# 顺序：网站 build+test → preview+截图 → 换 4 张资产图(旧图备份) → PPT 构建
#       → 动画 → scrub → 导出 PDF/预览 → 设计书升级(从原始备份还原后重放) → scrub
#       → 导出 PDF/预览 → 组装 FINAL-SUBMISSION → QA 硬校验 → 清理临时脚本
param(
    [switch]$SkipSite
)

$ErrorActionPreference = "Stop"

$source = $PSScriptRoot
$delivery = [System.IO.Path]::GetFullPath((Join-Path $source ".."))
$repo = [System.IO.Path]::GetFullPath((Join-Path $delivery "..\.."))
$portal = Join-Path $repo "competition\demo-portal"
$assets = Join-Path $delivery "assets"
$refresh = Join-Path $delivery "assets-refresh"

$assetNames = @(
    "portal-home-1920x1080-final.png",
    "portal-capability-1920x1080-final.png",
    "portal-experience-1920x1080-final.png",
    "portal-verified-widget-1920x1080-final.png"
)

$pptx = Join-Path $delivery "校园智序-小序-答辩.pptx"
$pptPdf = Join-Path $delivery "校园智序-小序-答辩.pdf"
$docx = Join-Path $delivery "校园智序-小序-智能体设计说明书.docx"
$docPdf = Join-Path $delivery "校园智序-小序-智能体设计说明书.pdf"
$pptPreview = Join-Path $delivery "ppt-preview-final"
$docPreview = Join-Path $delivery "doc-preview-final"

function Assert-LastExit([string]$label) {
    if ($LASTEXITCODE -ne 0) { throw "$label failed with exit code $LASTEXITCODE" }
}

function Stop-PortListener([int]$port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
    if ($conns) { Start-Sleep -Seconds 1 }
}

# ---------------------------------------------------------------- Phase 1 网站
if (-not $SkipSite) {
    Write-Host "[1/9] demo-portal build + test"
    Push-Location $portal
    try {
        npm run build; Assert-LastExit "npm run build"
        npm test; Assert-LastExit "npm test"
    } finally { Pop-Location }
} else {
    Write-Host "[1/9] skipped (-SkipSite)"
}

# ------------------------------------------------------- Phase 2 preview+截图
Write-Host "[2/9] vite preview + capture 4 portal assets"
Stop-PortListener 4174
$server = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "preview" `
    -WorkingDirectory $portal -WindowStyle Hidden -PassThru
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -LocalPort 4174 -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
}
if (-not $ready) {
    try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {}
    throw "vite preview did not open port 4174"
}
try {
    $env:QA_BASE = "http://127.0.0.1:4174"
    node (Join-Path $source "capture-portal-assets.mjs"); Assert-LastExit "capture-portal-assets"
} finally {
    Stop-PortListener 4174
    try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {}
}

# --------------------------------------------------------- Phase 3 换资产图
Write-Host "[3/9] refresh final-delivery/assets (old files backed up)"
foreach ($name in $assetNames) {
    $newFile = Join-Path $refresh $name
    if (-not (Test-Path $newFile)) { throw "capture missing: $name" }
    if ((Get-Item $newFile).Length -lt 80000) { throw "capture too small (likely blank page): $name" }
}
$backup = Join-Path $delivery ("assets-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($name in $assetNames) {
    Copy-Item (Join-Path $assets $name) (Join-Path $backup $name)
    Copy-Item (Join-Path $refresh $name) (Join-Path $assets $name) -Force
}
Write-Host "      backup -> $backup"

# ------------------------------------------------------- Phase 4 PPT 构建
Write-Host "[4/9] locate node_modules with pptxgenjs"
$moduleRoot = $null
foreach ($candidate in @(
    (Join-Path $delivery "node_modules"),
    [System.IO.Path]::GetFullPath((Join-Path $delivery "..\node_modules")),
    (Join-Path $repo "node_modules"),
    (Join-Path $portal "node_modules")
)) {
    if (Test-Path (Join-Path $candidate "pptxgenjs")) { $moduleRoot = $candidate; break }
}
if (-not $moduleRoot) { throw "pptxgenjs not found in candidate node_modules" }
$env:WORKSPACE_NODE_MODULES = $moduleRoot
Write-Host "      WORKSPACE_NODE_MODULES=$moduleRoot"

Write-Host "[5/9] build pptx + native animations + scrub path strings"
node (Join-Path $source "build-final-submission-pptx.mjs"); Assert-LastExit "build-final-submission-pptx"
& (Join-Path $source "add-ppt-animations.ps1")

Push-Location $delivery
try {
    python (Join-Path $source "scrub-ooxml-paths.py") "校园智序-小序-答辩.pptx"; Assert-LastExit "scrub pptx"
} finally { Pop-Location }

Write-Host "[6/9] export pptx -> PDF + 12 previews (1920x1080)"
& (Join-Path $source "export-office-artifacts.ps1") -Kind pptx -InputPath $pptx -PdfPath $pptPdf -PreviewDir $pptPreview

# ------------------------------------------------------- Phase 7 设计书
Write-Host "[7/9] design book: restore pristine -> upgrade narrative -> scrub -> export"
$docPristine = Join-Path $delivery "设计说明书-pristine-backup.docx"
if (Test-Path $docPristine) { Copy-Item $docPristine $docx -Force }
else { Copy-Item $docx $docPristine }
python (Join-Path $source "update-final-submission-docx.py"); Assert-LastExit "update-final-submission-docx"

Push-Location $delivery
try {
    python (Join-Path $source "scrub-ooxml-paths.py") "校园智序-小序-智能体设计说明书.docx"; Assert-LastExit "scrub docx"
} finally { Pop-Location }

& (Join-Path $source "export-office-artifacts.ps1") -Kind docx -InputPath $docx -PdfPath $docPdf -PreviewDir $docPreview

# ------------------------------------------------- Phase 8 组装 + QA
Write-Host "[8/9] assemble FINAL-SUBMISSION + run hard QA"
python (Join-Path $source "assemble-final-submission.py"); Assert-LastExit "assemble-final-submission"
python (Join-Path $source "final-submission-qa.py"); Assert-LastExit "final-submission-qa"

# ------------------------------------------------------- Phase 9 清理
Write-Host "[9/9] cleanup temp recon script"
Remove-Item (Join-Path $source "recon2-temp.ps1") -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "ALL PHASES DONE — QA report: FINAL-SUBMISSION-QA.md"
