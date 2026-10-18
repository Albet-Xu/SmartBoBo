@echo off
rem ============================================================
rem  SmartBoBo - launcher (Windows)
rem
rem  Starts the pristine DeepSeek Harness web UI on port 7075
rem  (same experience as the old BoBo launch.cmd: double-click,
rem  the browser opens the workspace automatically).
rem
rem  Kernel: the official packaged @deepseek-ai/dsh that the
rem  Deepseek Harness Desktop app downloaded on first run
rem  (version 0.2.0-rc.2 - same base as the old project).
rem  DSH_HOME: project-local (E:\SmartBoBo\.dsh).
rem  Brand: scripts\apply-brand-patch.mjs re-applies the SmartBoBo
rem  skin to the packaged kernel before launch (idempotent; the
rem  desktop app's Rust patch applies the same changes).
rem
rem  IMPORTANT: keep this file pure ASCII. cmd.exe parses .cmd
rem  files with the system code page (e.g. GBK on zh-CN), so
rem  UTF-8 non-ASCII comments get mangled and can break the
rem  script on double-click.
rem
rem  Usage: double-click this file, or run it in a terminal.
rem ============================================================
setlocal

rem --- Ensure node is in PATH for double-click launches (only as fallback) ---
where node >nul 2>nul
if errorlevel 1 if exist "D:\Application\node.js\node.exe" set "PATH=D:\Application\node.js;%PATH%"

rem --- Project root = this script's folder (strip trailing \) ---
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

rem --- Pristine packaged kernel (downloaded by Deepseek Harness Desktop) ---
set "KERNEL=%APPDATA%\dsh-tauri\dependencies\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js"
if not exist "%KERNEL%" (
  echo [ERROR] Packaged kernel not found:
  echo         "%KERNEL%"
  echo.
  echo         Fix: run "Deepseek Harness Desktop" once so it downloads
  echo         the kernel, or point KERNEL below at another dsh install.
  pause
  exit /b 1
)

rem --- node sanity ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH.
  pause
  exit /b 1
)

rem --- SmartBoBo brand patch (idempotent; safe if already applied) ---
node "%ROOT%\scripts\apply-brand-patch.mjs"
if errorlevel 1 (
  echo [WARN] brand patch failed; continuing with unbranded kernel.
)

rem --- Project-local DSH_HOME: state stays inside E:\SmartBoBo ---
set "DSH_HOME=%ROOT%\.dsh"
if not exist "%DSH_HOME%" mkdir "%DSH_HOME%"

rem --- Preset-relative root: market presets resolve their MCP rows as
rem     '../.venv/Scripts/python.exe' + '../scripts/*.py' against this cwd,
rem     so it must be the 'dsh' subfolder for '../' to land on the repo root.
rem     BOBO_ROOT is re-exported into each MCP child as a !!js expression; when
rem     it is unset the memory servers cannot locate skills/*/memory_store.py.
set "BOBO_ROOT=%ROOT%"
set "BOBO_DSH_ROOT=%ROOT%\dsh"

rem --- Refresh global env manifest (idempotent; no downloads, no process start) ---
rem Writes dbx-runtime/env-manifest.json used by the bobo-env skill. CloakBrowser
rem readiness is probe-only here; the service itself starts lazily on first use.
if exist "%ROOT%\.venv\Scripts\python.exe" (
  echo [INFO] Refreshing env manifest...
  "%ROOT%\.venv\Scripts\python.exe" "%ROOT%\scripts\gen_env_manifest.py" --root "%ROOT%"
) else (
  echo [WARN] .venv not found; skipping env manifest refresh.
)

rem --- Seed/sync the DBX built-in AI config row (bridge endpoint; idempotent) ---
rem dbx/scripts/dbx_ai_seed.py creates <DSH_HOME>/.bobo-llm-token if missing and
rem only inserts when ai_configs is empty (never overwrites manual configs). The
rem dsh-dbx plugin spawns dbx-web inside the session, so seeding here keeps the
rem sqlite write ahead of the service without owning the service lifecycle.
if exist "%ROOT%\.venv\Scripts\python.exe" (
  echo [INFO] Seeding DBX AI bridge config...
  "%ROOT%\.venv\Scripts\python.exe" "%ROOT%\dbx\scripts\dbx_ai_seed.py" --dbx-db "%ROOT%\dbx-runtime\data\dbx.db"
) else (
  echo [WARN] .venv not found; skipping DBX AI config seeding.
)

echo [INFO] DSH_HOME = %DSH_HOME%
echo [INFO] Kernel    = %KERNEL%
echo [INFO] Serving   = http://127.0.0.1:7075 (browser opens automatically)

rem --- Serve the web workspace (long-running). Keep window on error. ---
node "%KERNEL%" --profile web --port 7075
set "rc=%errorlevel%"
if not "%rc%"=="0" (
  echo.
  echo [ERROR] dsh web exited with code %rc%.
  echo         See the messages above. Fix and run again.
)
pause
endlocal
