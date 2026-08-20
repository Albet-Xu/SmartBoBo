#!/usr/bin/env sh
# =====================================================================
#  BoBo 智能采集平台 - 启动脚本（Linux / macOS）
#  自动设置 BOBO_ROOT 指向项目根目录，然后启动 dsh web 服务。
#  用法：./启动.sh
#  （首次使用若提示无执行权限，先执行：chmod +x 启动.sh）
# =====================================================================
set -e

# 本脚本所在目录即 BoBo 项目根目录
BOBO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export BOBO_ROOT

# 进入 dsh 目录并启动
cd "$BOBO_ROOT/dsh"
pnpm bobo
