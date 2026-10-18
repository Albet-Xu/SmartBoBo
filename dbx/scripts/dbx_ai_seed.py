#!/usr/bin/env python3
"""预置/同步 DBX 内置 AI 的桥配置行（配合 dsh-dbx 的 llm-bridge）。

幂等三步，失败只告警不阻塞：

1. 确保桥 token 文件存在——缺失/过短时写 64 位 hex（与 llm-bridge.mjs 生成
   语义一致，谁先到谁生成，启动顺序无关）。
2. 自有行（id 或 name = bobo-llm-bridge）存在 → 更新 endpoint/apiKey/model；
3. 表为空 → 插入并设为默认；表里只有用户行 → 不动。

dbx.db 不存在（DBX 未首启建库）时提示并 exit 0，服务 ready 后会再补种。

用法：
    python dbx_ai_seed.py --dbx-db <path/to/dbx.db>
环境开关：BOBO_DBX_AI_SEED=0 或 SMARTBOBO_DBX_AI_SEED=0 禁用。
依赖：仅标准库 sqlite3。
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sqlite3
import sys
from pathlib import Path

ROW_ID = "bobo-llm-bridge"
TOKEN_FILE_NAME = ".bobo-llm-token"
DEFAULT_ENDPOINT = "http://127.0.0.1:7075/bobo-llm"

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def log(message: str) -> None:
    print(f"[dbx-ai] {message}")


def warn(message: str) -> None:
    print(f"[dbx-ai][WARN] {message}", file=sys.stderr)


def ensure_token(token_file: Path) -> str:
    try:
        existing = token_file.read_text(encoding="utf-8").strip()
        if len(existing) >= 32:
            return existing
    except OSError:
        pass
    fresh = secrets.token_hex(32)
    try:
        token_file.parent.mkdir(parents=True, exist_ok=True)
        with open(token_file, "x", encoding="utf-8") as handle:
            handle.write(f"{fresh}\n")
        try:
            os.chmod(token_file, 0o600)
        except OSError:
            pass
        return fresh
    except FileExistsError:
        winner = token_file.read_text(encoding="utf-8").strip()
        if len(winner) >= 32:
            return winner
        raise RuntimeError(f"token 文件存在但内容异常: {token_file}")
    except OSError as error:
        raise RuntimeError(f"token 文件写入失败 {token_file}: {error}") from error


def sync_row(db_path: Path, endpoint: str, token: str, model: str) -> None:
    config = {
        "provider": "openai-compatible",
        "apiKey": token,
        "authMethod": "bearer",
        "endpoint": endpoint,
        "model": model,
        "models": [{"name": model}],
        "apiStyle": "completions",
        "proxyEnabled": False,
    }
    config_json = json.dumps(config, ensure_ascii=False)
    models_json = json.dumps(config["models"], ensure_ascii=False)

    try:
        conn = sqlite3.connect(db_path, timeout=10)
    except sqlite3.Error as error:
        warn(f"打开 dbx.db 失败 {db_path}: {error}（DBX 正在写库？下次启动会再试）")
        return
    try:
        conn.execute("PRAGMA busy_timeout=10000")
        table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_configs'"
        ).fetchone()
        if table is None:
            warn("dbx.db 还没有 ai_configs 表（DBX 尚未首启），本次跳过；服务 ready 后会自动补种")
            return
        ours = conn.execute(
            "SELECT is_default FROM ai_configs WHERE id = ? OR name = ?", (ROW_ID, ROW_ID)
        ).fetchone()
        if ours is not None:
            try:
                conn.execute(
                    "UPDATE ai_configs SET name = ?, model = ?, models = ?, config_json = ? WHERE id = ? OR name = ?",
                    (ROW_ID, model, models_json, config_json, ROW_ID, ROW_ID),
                )
            except sqlite3.IntegrityError:
                conn.execute(
                    "UPDATE ai_configs SET model = ?, models = ?, config_json = ? WHERE id = ? OR name = ?",
                    (model, models_json, config_json, ROW_ID, ROW_ID),
                )
                warn("更新触碰唯一约束，已仅同步 endpoint/apiKey/model")
            conn.commit()
            log(f"已同步自有配置行 name={ROW_ID}, model={model}")
            return
        total = conn.execute("SELECT COUNT(*) FROM ai_configs").fetchone()[0]
        if total > 0:
            log(f"ai_configs 已有 {total} 条用户配置，跳过预置（不覆盖手动配置）")
            return
        conn.execute(
            "INSERT INTO ai_configs (id, name, model, models, config_json, is_default)"
            " VALUES (?, ?, ?, ?, ?, 1)",
            (ROW_ID, ROW_ID, model, models_json, config_json),
        )
        conn.commit()
        log(f"已预置默认配置行 → {db_path}（endpoint={endpoint}, model={model}）")
    except sqlite3.Error as error:
        warn(f"ai_configs 同步失败: {error}（DBX 正在写库？下次启动会再试）")
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="预置/同步 DBX 内置 AI 的桥配置行")
    data_dir = os.environ.get("DBX_DATA_DIR")
    default_db = (
        Path(data_dir) / "dbx.db" if data_dir
        else PROJECT_ROOT / "dbx-runtime" / "data" / "dbx.db"
    )
    parser.add_argument("--dbx-db", default=str(default_db), help="dbx.db 路径")
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("DBX_BRIDGE_URL") or DEFAULT_ENDPOINT,
        help="写进 DBX 的桥地址",
    )
    parser.add_argument("--model", default="default", help="写进 DBX 的模型名（default=桥按会话默认模型解析）")
    parser.add_argument(
        "--token-file",
        default=None,
        help="桥 token 文件路径（默认 $DSH_HOME/.bobo-llm-token）",
    )
    args = parser.parse_args()

    if os.environ.get("BOBO_DBX_AI_SEED", "1") == "0" or os.environ.get("SMARTBOBO_DBX_AI_SEED", "1") == "0":
        log("环境开关禁用了 AI 配置预置，跳过")
        return 0

    db_path = Path(args.dbx_db)
    dsh_home = Path(os.environ["DSH_HOME"]) if os.environ.get("DSH_HOME") else PROJECT_ROOT / ".dsh"
    token_file = Path(args.token_file) if args.token_file else dsh_home / TOKEN_FILE_NAME

    if not db_path.is_file():
        log(f"dbx.db 不存在（{db_path}），跳过——DBX 首启建库后服务 ready 会自动补种")
        return 0

    try:
        token = ensure_token(token_file)
    except (RuntimeError, OSError) as error:
        warn(str(error))
        return 0
    log(f"token 就绪: {token_file}")

    sync_row(db_path, args.endpoint, token, args.model)
    return 0


if __name__ == "__main__":
    sys.exit(main())
