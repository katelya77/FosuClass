param(
  [Parameter(Mandatory = $true)][ValidateSet('pptx', 'docx')][string]$Kind,
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$PdfPath,
  [Parameter(Mandatory = $true)][string]$PreviewDir
)

$ErrorActionPreference = 'Stop'
$inputResolved = [System.IO.Path]::GetFullPath($InputPath)
$pdfResolved = [System.IO.Path]::GetFullPath($PdfPath)
$previewResolved = [System.IO.Path]::GetFullPath($PreviewDir)
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

foreach ($target in @($inputResolved, $pdfResolved, $previewResolved)) {
  if (-not $target.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Target outside final-delivery: $target"
  }
}

if (-not (Test-Path -LiteralPath $inputResolved -PathType Leaf)) {
  throw "Input missing: $inputResolved"
}
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($pdfResolved)) | Out-Null
[System.IO.Directory]::CreateDirectory($previewResolved) | Out-Null
Get-ChildItem -LiteralPath $previewResolved -File | ForEach-Object { [System.IO.File]::Delete($_.FullName) }

if ($Kind -eq 'pptx') {
  $app = New-Object -ComObject PowerPoint.Application
  $app.Visible = -1
  $presentation = $null
  try {
    $presentation = $app.Presentations.Open($inputResolved, $true, $false, $false)
    $presentation.SaveAs($pdfResolved, 32)
    $presentation.Export($previewResolved, 'PNG', 1920, 1080)
    Write-Output "PPTX_OK slides=$($presentation.Slides.Count)"
  }
  finally {
    if ($null -ne $presentation) { $presentation.Close() }
    $app.Quit()
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) | Out-Null
  }
}
else {
  $app = New-Object -ComObject Word.Application
  $app.Visible = $false
  $document = $null
  try {
    $document = $app.Documents.Open($inputResolved, $false, $true)
    $document.ExportAsFixedFormat($pdfResolved, 17)
    Write-Output "DOCX_OK pages=$($document.ComputeStatistics(2))"
  }
  finally {
    if ($null -ne $document) { $document.Close($false) }
    $app.Quit()
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) | Out-Null
  }
  & pdftoppm -png -r 144 $pdfResolved (Join-Path $previewResolved 'page')
}
