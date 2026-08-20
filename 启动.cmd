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

rem --- Start the web server (long-running). Keep window on error ---
call pnpm bobo
set "rc=%errorlevel%"
if not "%rc%"=="0" (
  echo.
  echo [ERROR] "pnpm bobo" exited with code %rc%.
  echo         See the messages above. Fix and run again.
  pause
)
endlocal
