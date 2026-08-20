@echo off
rem =====================================================================
rem  BoBo 智能采集平台 - 启动脚本（Windows）
rem  自动设置 BOBO_ROOT 指向项目根目录，然后启动 dsh web 服务。
rem  用法：双击本文件，或在命令行运行 启动.cmd
rem =====================================================================
setlocal

rem 本脚本所在目录即 BoBo 项目根目录（去掉结尾反斜杠）
set "BOBO_ROOT=%~dp0"
if "%BOBO_ROOT:~-1%"=="\" set "BOBO_ROOT=%BOBO_ROOT:~0,-1%"

rem 进入 dsh 目录并启动（BOBO_ROOT 已导出给子进程定位 .venv 与 scripts）
cd /d "%BOBO_ROOT%\dsh"
pnpm bobo

endlocal
