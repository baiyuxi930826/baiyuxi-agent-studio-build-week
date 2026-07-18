<#
.SYNOPSIS
  Start local Audio Capture server on Windows.
.PARAMETER Port
  Loopback port (default 9881).
#>

param([int]$Port = 0)
if ($Port -le 0) {
    if ($env:AUDIO_SERVICE_PORT) { $Port = [int]$env:AUDIO_SERVICE_PORT } else { $Port = 9881 }
}

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output "[start] wrapper entered: service=audio-capture script=$PSCommandPath"
$env:PYTHONUNBUFFERED = "1"

if (-not $env:AGENT_STUDIO_HOME) {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $env:AGENT_STUDIO_HOME = Join-Path $repoRoot '.agent-studio'
}

$VenvDir = Join-Path $env:AGENT_STUDIO_HOME "audio-capture-venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$AudioScript = Join-Path $repoRoot "scripts\meeting-copilot\audio-service.py"
Write-Output "[start] resolved runtime: AGENT_STUDIO_HOME=$($env:AGENT_STUDIO_HOME); venv=$VenvDir; python=$VenvPython; api=$AudioScript; port=$Port"

if (-not (Test-Path $VenvPython)) {
    throw "Venv not found: $VenvDir. Run audio-capture-install.ps1 first."
}
if (-not (Test-Path $AudioScript)) {
    throw "audio-service.py not found at $AudioScript. F195 audio-capture runtime is not bundled in this checkout."
}

Write-Output "Starting Audio Capture server: port=$Port"
$env:AUDIO_SERVICE_PORT = [string]$Port
Write-Output "[start] launching python: $VenvPython $AudioScript"
& $VenvPython $AudioScript
$ExitCode = $LASTEXITCODE
Write-Output "[start] python exited with code $ExitCode"
exit $ExitCode
