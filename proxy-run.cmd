@echo off
rem ============================================================
rem  BoBo - run a command with the local proxy (Windows / cmd)
rem
rem  Sets HTTPS_PROXY / HTTP_PROXY / ALL_PROXY so that the
rem  camourfox browser kernel download (from GitHub, currently
rem  unreachable without a proxy) and uv/PyPI traffic can go
rem  through the local proxy at 127.0.0.1:7890.
rem
rem  Usage (run from the project root):
rem      proxy-run.cmd uv sync
rem      proxy-run.cmd uv run camoufox fetch
rem
rem  This script only affects the child process it launches;
rem  it does NOT change your shell or system settings.
rem ============================================================
setlocal
set "HTTPS_PROXY=http://127.0.0.1:7890"
set "HTTP_PROXY=http://127.0.0.1:7890"
set "ALL_PROXY=http://127.0.0.1:7890"
set "NO_PROXY=127.0.0.1,localhost,172.16.17.13"
rem --- pass through whatever command you gave us ---
%*
set "rc=%errorlevel%"
endlocal & exit /b %rc%
