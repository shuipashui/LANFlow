[CmdletBinding()]
param(
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $projectDirectory "dist\LANFlow 0.6.3 Windows x64"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

$systemNode = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($systemNode) { $systemNode.Source } else { Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" }
if (-not (Test-Path -LiteralPath $nodeExecutable)) {
    throw "未找到 Node.js，无法生成便携版。"
}

$projectRoot = [System.IO.Path]::GetFullPath($projectDirectory)
if ($OutputDirectory -eq $projectRoot -or -not $OutputDirectory.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "输出目录必须位于项目目录内。"
}

if (Test-Path -LiteralPath $OutputDirectory) {
    Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
}

$runtimeDirectory = Join-Path $OutputDirectory "runtime"
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutputDirectory "data\shared") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutputDirectory "data\inbox") -Force | Out-Null

Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $runtimeDirectory "node.exe")
Copy-Item -LiteralPath (Join-Path $projectDirectory "src") -Destination $OutputDirectory -Recurse
Copy-Item -LiteralPath (Join-Path $projectDirectory "public") -Destination $OutputDirectory -Recurse
Copy-Item -LiteralPath (Join-Path $projectDirectory "LICENSE") -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory "THIRD-PARTY-NOTICES.txt") -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory "便携版说明.txt") -Destination $OutputDirectory
$launcherSource = Join-Path $projectDirectory "scripts\portable-launcher.cmd"
$launcherDestination = Join-Path $OutputDirectory "启动 LANFlow.cmd"
$launcherContent = [System.IO.File]::ReadAllText($launcherSource).Replace("`r`n", "`n").Replace("`n", "`r`n")
[System.IO.File]::WriteAllText($launcherDestination, $launcherContent, [System.Text.UTF8Encoding]::new($false))

$qrSource = Join-Path $projectDirectory "node_modules\qrcode-generator"
$qrDestination = Join-Path $OutputDirectory "node_modules\qrcode-generator"
New-Item -ItemType Directory -Path $qrDestination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $qrSource "dist") -Destination $qrDestination -Recurse
Copy-Item -LiteralPath (Join-Path $qrSource "package.json") -Destination $qrDestination
Copy-Item -LiteralPath (Join-Path $qrSource "README.md") -Destination $qrDestination

$nodeDirectory = Split-Path -Parent $nodeExecutable
$nodeLicense = Join-Path (Split-Path -Parent $nodeDirectory) "LICENSE"
if (Test-Path -LiteralPath $nodeLicense) {
    Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $runtimeDirectory "NODE-LICENSE.txt")
}

$archivePath = "$OutputDirectory.zip"
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -LiteralPath $OutputDirectory -DestinationPath $archivePath -CompressionLevel Optimal

Write-Host "便携版已生成：$OutputDirectory" -ForegroundColor Green
Write-Host "便携版压缩包：$archivePath" -ForegroundColor Green
