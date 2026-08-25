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

# --- 启动 DBX 数据库 Web 服务（后台，best-effort）---
# 缺失 runtime 时不阻塞 BoBo 启动，仅应用内“数据库”面板不可用。
DBX_BIN="$BOBO_ROOT/dbx-runtime/dbx-web"
[ -x "$DBX_BIN" ] || DBX_BIN="$BOBO_ROOT/dbx-runtime/dbx-web.exe"
if [ -x "$DBX_BIN" ]; then
  DBX_STATIC_DIR="$BOBO_ROOT/dbx-runtime/dist" \
  DBX_DATA_DIR="$BOBO_ROOT/dbx-runtime/data" \
  DBX_PORT=4224 \
  DBX_DISABLE_PASSWORD=1 \
  "$DBX_BIN" >"$BOBO_ROOT/dbx-runtime/dbx-web.log" 2>&1 &
  echo "[INFO] DBX 数据库服务已启动: http://localhost:4224 (pid $!)"
else
  echo "[WARN] 未找到 DBX runtime: $DBX_BIN"
  echo "       数据库面板不可用。请先按 docs/说明文档/20-DBX数据库集成操作指南.md 构建并复制 dbx-runtime。"
fi

# 进入 dsh 目录并启动
cd "$BOBO_ROOT/dsh"
pnpm bobo
