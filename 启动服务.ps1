[CmdletBinding()]
param(
    [int]$Port = 4173,
    [string]$AccessCode = ""
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExecutable = $null

$systemNode = Get-Command node -ErrorAction SilentlyContinue
if ($systemNode) {
    $nodeExecutable = $systemNode.Source
}

if (-not $nodeExecutable) {
    $bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    if (Test-Path -LiteralPath $bundledNode) {
        $nodeExecutable = $bundledNode
    }
}

if (-not $nodeExecutable) {
    Write-Host "未找到 Node.js 运行环境。" -ForegroundColor Red
    Write-Host "请安装 Node.js 20 或更新版本：https://nodejs.org/zh-cn/download" -ForegroundColor Yellow
    exit 1
}

$env:PORT = [string]$Port
if ($AccessCode) {
    $env:LANFLOW_ACCESS_CODE = $AccessCode
}

Set-Location -LiteralPath $projectDirectory
Write-Host "可在电脑网页右上角点击“结束服务”，也可按 Ctrl+C 停止。" -ForegroundColor Cyan
& $nodeExecutable (Join-Path $projectDirectory "src\server.js")
exit $LASTEXITCODE
