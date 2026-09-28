param(
    [Parameter(Mandatory = $true)][string]$BuildDir,
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [string]$QtBin = "",
    [string]$CompilerBin = "",
    [string]$QmlDir = ""
)

$ErrorActionPreference = 'Stop'
$sourceExe = Join-Path $BuildDir 'clair-desktop.exe'
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) { throw "Missing Release executable: $sourceExe" }
$outputFull = [System.IO.Path]::GetFullPath($OutputDir)
if (Test-Path -LiteralPath $outputFull) { throw "Output already exists; refusing to overwrite: $outputFull" }

if (-not $QtBin) {
    $tool = Get-Command windeployqt.exe -ErrorAction Stop
    $QtBin = Split-Path -Parent $tool.Source
}
$deploy = Join-Path $QtBin 'windeployqt.exe'
if (-not (Test-Path -LiteralPath $deploy -PathType Leaf)) { throw "Missing windeployqt.exe: $deploy" }
if (-not $QmlDir) { $QmlDir = Join-Path $PSScriptRoot 'qml' }
if (-not (Test-Path -LiteralPath $QmlDir -PathType Container)) { throw "Missing QML directory: $QmlDir" }

New-Item -ItemType Directory -Path $outputFull | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination $outputFull
$originalPath = $env:PATH
try {
    $env:PATH = (@($CompilerBin, $QtBin, $originalPath) | Where-Object { $_ }) -join ';'
    & $deploy --release --compiler-runtime --no-translations --qmldir $QmlDir --dir $outputFull (Join-Path $outputFull 'clair-desktop.exe')
    if ($LASTEXITCODE -ne 0) { throw "windeployqt failed with exit code $LASTEXITCODE" }
} finally {
    $env:PATH = $originalPath
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\LICENSE') -Destination (Join-Path $outputFull 'LICENSE-Clair-MIT.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PREVIEW_README.md') -Destination (Join-Path $outputFull 'README-试用.md')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'THEMES.md') -Destination (Join-Path $outputFull 'THEMES.md')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'TRANSCRIPTION.md') -Destination (Join-Path $outputFull 'TRANSCRIPTION.md')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'THIRD_PARTY_NOTICES.md') -Destination $outputFull
$skillSource = Join-Path $PSScriptRoot '..\.codex\skills\clair-theme-crop'
if (Test-Path -LiteralPath $skillSource -PathType Container) {
    $skillOut = Join-Path $outputFull 'theme-skill'
    New-Item -ItemType Directory -Path (Join-Path $skillOut 'scripts') | Out-Null
    Copy-Item -LiteralPath (Join-Path $skillSource 'SKILL.md') -Destination $skillOut
    Copy-Item -LiteralPath (Join-Path $skillSource 'scripts\crop_theme.py') -Destination (Join-Path $skillOut 'scripts')
}
$webOut = Join-Path $outputFull 'web'
New-Item -ItemType Directory -Path $webOut | Out-Null
foreach ($name in @('index.html', 'styles.css', 'app.js', 'flac-metadata.js', 'library-model.js', 'theme-model.js')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\$name") -Destination $webOut
}
$licenseOut = Join-Path $outputFull 'licenses'
New-Item -ItemType Directory -Path $licenseOut | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'licenses\*.txt') -Destination $licenseOut

$sbomDir = Join-Path (Split-Path -Parent $QtBin) 'sbom'
if (Test-Path -LiteralPath $sbomDir -PathType Container) {
    $sbomOut = Join-Path $licenseOut 'sbom'
    New-Item -ItemType Directory -Path $sbomOut | Out-Null
    foreach ($name in @('qtbase', 'qtdeclarative', 'qtmultimedia', 'qtsvg')) {
        Get-ChildItem -LiteralPath $sbomDir -Filter "$name-*.spdx" |
            Where-Object { $_.Name -notlike '*.source.spdx' } |
            Copy-Item -Destination $sbomOut
    }
}

$zip = "$outputFull.zip"
if (Test-Path -LiteralPath $zip) { throw "Archive already exists; refusing to overwrite: $zip" }
Compress-Archive -LiteralPath $outputFull -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$zip.sha256" -Encoding ascii -Value "$hash  $(Split-Path -Leaf $zip)"
Write-Output "Package: $zip"
Write-Output "SHA256:  $hash"
