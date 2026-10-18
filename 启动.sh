#!/usr/bin/env bash
# SmartBoBo launcher (Linux / macOS) - pristine dsh web on 7075.
# Mirrors 启动.cmd: project-local DSH_HOME, official packaged kernel,
# browser opens automatically. Keep this file pure ASCII.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Packaged kernel location per platform (override with DSH_KERNEL).
# Windows (Git Bash): %APPDATA%\dsh-tauri\...
# Linux Tauri app-data default: ~/.local/share/dsh-tauri/...
KERNEL="${DSH_KERNEL:-$HOME/.local/share/dsh-tauri/dependencies/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js}"

if [ ! -f "$KERNEL" ]; then
  echo "[ERROR] Packaged kernel not found:"
  echo "        $KERNEL"
  echo "        Run 'Deepseek Harness Desktop' once, or set DSH_KERNEL."
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "[ERROR] node not found in PATH."; exit 1; }

# SmartBoBo brand patch (idempotent; safe if already applied)
node "$ROOT/scripts/apply-brand-patch.mjs" || echo "[WARN] brand patch failed; continuing with unbranded kernel."

export DSH_HOME="$ROOT/.dsh"
mkdir -p "$DSH_HOME"

# Preset-relative root: market presets resolve their MCP rows as
# '../.venv/Scripts/python.exe' + '../scripts/*.py' against this cwd, so it must
# be the 'dsh' subfolder for '../' to land on the repo root.
# BOBO_ROOT is re-exported into each MCP child as a !!js expression; when it is
# unset the memory servers cannot locate skills/*/memory_store.py.
export BOBO_ROOT="$ROOT"
export BOBO_DSH_ROOT="$ROOT/dsh"

# Refresh global env manifest (idempotent; no downloads, no process start).
# Writes dbx-runtime/env-manifest.json used by the bobo-env skill.
if [ -x "$ROOT/.venv/bin/python" ]; then
  echo "[INFO] Refreshing env manifest..."
  "$ROOT/.venv/bin/python" "$ROOT/scripts/gen_env_manifest.py" --root "$ROOT" \
    || echo "[WARN] env manifest refresh failed; continuing."
else
  echo "[WARN] .venv not found; skipping env manifest refresh."
fi

# Seed/sync the DBX built-in AI config row (bridge endpoint; idempotent).
if [ -x "$ROOT/.venv/bin/python" ]; then
  echo "[INFO] Seeding DBX AI bridge config..."
  "$ROOT/.venv/bin/python" "$ROOT/dbx/scripts/dbx_ai_seed.py" \
    --dbx-db "$ROOT/dbx-runtime/data/dbx.db" \
    || echo "[WARN] DBX AI seeding failed; continuing."
else
  echo "[WARN] .venv not found; skipping DBX AI config seeding."
fi

echo "[INFO] DSH_HOME = $DSH_HOME"
echo "[INFO] Kernel    = $KERNEL"
echo "[INFO] Serving   = http://127.0.0.1:7075 (browser opens automatically)"

node "$KERNEL" --profile web --port 7075
