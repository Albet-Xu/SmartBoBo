# Provisions the CloakBrowser Python runtime with uv (same pattern as the
# BoBo-Handyman reference project): syncs the project-root uv environment
# (.venv + uv.lock from E:\SmartBoBo\pyproject.toml), then pre-installs the
# stealth Chromium binary. Idempotent - safe to re-run.
$ErrorActionPreference = "Stop"
$cloakRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $cloakRoot
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Error "uv not found on PATH; install it first: https://docs.astral.sh/uv/ (e.g. pip install uv)"
  exit 1
}

# Create/sync the project-root .venv from pyproject.toml + uv.lock
Push-Location $projectRoot
uv sync
Pop-Location

if (-not (Test-Path $venvPython)) {
  Write-Error "uv sync did not create $venvPython"
  exit 1
}

# Pre-install the stealth Chromium binary (~200MB, shared cache, idempotent)
& $venvPython -m cloakbrowser install
& $venvPython -m cloakbrowser info --quick
Write-Host "cloak runtime ready: $projectRoot (.venv)"
