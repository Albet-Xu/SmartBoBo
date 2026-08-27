@echo off
rem ============================================================
rem  BoBo acquisition platform - launcher (Windows)
rem
rem  Sets BOBO_ROOT to the project root, then starts the dsh web.
rem
rem  IMPORTANT: keep this file pure ASCII. cmd.exe parses .cmd
rem  files with the system code page (e.g. GBK on zh-CN), so
rem  UTF-8 Chinese comments get mangled, corrupt the script,
rem  and make it fail-and-close instantly on double-click.
rem
rem  Usage: double-click this file, or run it in a terminal.
rem ============================================================
setlocal

rem --- Ensure node and pnpm are in PATH for double-click launches ---
set "PATH=D:\Application\node.js;D:\Application\MCP\npm_global;%PATH%"

rem --- Project root = this script's folder (strip trailing \) ---
set "BOBO_ROOT=%~dp0"
if "%BOBO_ROOT:~-1%"=="\" set "BOBO_ROOT=%BOBO_ROOT:~0,-1%"

rem --- Enter dsh and start. BOBO_ROOT is exported to children ---
cd /d "%BOBO_ROOT%\dsh"
if errorlevel 1 (
  echo [ERROR] Cannot enter dsh dir: "%BOBO_ROOT%\dsh"
  echo         Check the project folder location.
  pause
  exit /b 1
)

rem --- Start the DBX database web service in its own window ---
set "DBX_BIN=%BOBO_ROOT%\dbx-runtime\dbx-web.exe"
if exist "%DBX_BIN%" (
  set "DBX_STATIC_DIR=%BOBO_ROOT%\dbx-runtime\dist"
  set "DBX_DATA_DIR=%BOBO_ROOT%\dbx-runtime\data"
  set "DBX_PORT=4224"
  set "DBX_DISABLE_PASSWORD=1"
  start "BoBo DBX (http://localhost:4224)" "%DBX_BIN%"
) else (
  echo [WARN] DBX runtime not found at "%DBX_BIN%".
  echo        Database panel unavailable.
)

rem --- Start the web server (long-running). Keep window on error ---
call pnpm bobo
set "rc=%errorlevel%"
if not "%rc%"=="0" (
  echo.
  echo [ERROR] "pnpm bobo" exited with code %rc%.
  echo         See the messages above. Fix and run again.
)
pause
endlocal
