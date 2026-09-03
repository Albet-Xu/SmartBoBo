#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dbx_connector.py —— 复用内置 DBX 已保存的数据库连接，连接并操作数据库。

数据源：BoBo/dbx-runtime/data/dbx.db（SQLite，DBX 面板的 connections + connection_secrets 两张表）。
DBX 面板里"新建连接"保存过的连接与密码都会落在这张表里，因此"内置 DBX 已有连接直接复用"
就是从这里读取。

本文件既可作为库被提取入库脚本 import，也可作为命令行工具独立使用：

    # 查看 DBX 已保存的连接
    python dbx_connector.py list-connections
    python dbx_connector.py list-connections --json

    # 查看某连接下的所有表
    python dbx_connector.py list-tables <连接名>

    # 查看某表字段定义
    python dbx_connector.py describe-table <连接名> <表名>

    # 查看某表是否存在
    python dbx_connector.py table-exists <连接名> <表名>

依赖驱动（按 db_type 按需加载；缺失时给出安装命令提示）：
    MySQL  / MariaDB  →  pip install pymysql
    PostgreSQL        →  pip install psycopg[binary]
    SQLite            →  标准库 sqlite3（无需安装）
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterator

# ---------------------------------------------------------------------------
# 路径解析：定位 BoBo 根目录（含 dbx-runtime 的目录）与 dbx.db
# ---------------------------------------------------------------------------


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


_COMMON_BOBO_LOCATIONS = ("SmartBoBo/BoBo", "BoBo")


def _common_bobo_candidates() -> list[Path]:
    """常见 BoBo 安装位置候选（跨盘符、跨用户目录探测，命中含 dbx-runtime 的才算数）。"""
    out: list[Path] = []
    home = Path.home()
    for base in (home, home.parent):
        for sub in _COMMON_BOBO_LOCATIONS:
            out.append(base / sub)
    for drive in ("C:/", "D:/", "E:/", "F:/", "G:/"):
        for sub in _COMMON_BOBO_LOCATIONS:
            out.append(Path(drive) / sub)
    return out


def find_bobo_root(start: str | None = None) -> Path | None:
    """定位 BoBo 根目录（含 `dbx-runtime` 的目录）。

    查找顺序：环境变量 BOBO_ROOT > 从 start/当前目录向上找 > 常见安装位置候选。
    均未命中返回 None，由调用方给出带 `--bo-bo-root` 的指引。
    """
    # 环境变量优先（在 BoBo/dsh 内运行或脚本指定时最稳）
    if _env("BOBO_ROOT"):
        p = Path(_env("BOBO_ROOT")).resolve()
        # 打包布局为 dbx（映射自 dbx-runtime），两种标记都认
        if (p / "dbx-runtime").is_dir() or (p / "dbx").is_dir():
            return p
    # 从显式 start / 当前目录向上逐级找
    candidates: list[Path] = []
    if start:
        candidates.append(Path(start).resolve())
    candidates.append(Path.cwd())
    for base in candidates:
        cur = base
        for _ in range(15):
            if (cur / "dbx-runtime").is_dir():
                return cur
            if cur.parent == cur:
                break
            cur = cur.parent
    # 常见安装位置候选兜底
    for cand in _common_bobo_candidates():
        if (cand / "dbx-runtime").is_dir():
            return cand
    return None


def dbx_db_path(bobo_root: Path | None = None, override: str | None = None) -> Path:
    """返回 dbx.db 的路径。优先级：--dbx-data-dir/DBX_DATA_DIR > <bobo_root>/dbx-runtime/data/dbx.db。"""
    if override:
        p = Path(override).resolve()
        return p if p.name == "dbx.db" else p / "dbx.db"
    if _env("DBX_DATA_DIR"):
        return Path(_env("DBX_DATA_DIR")).resolve() / "dbx.db"
    if bobo_root:
        return bobo_root / "dbx-runtime" / "data" / "dbx.db"
    raise FileNotFoundError("无法定位 dbx.db，请用 --dbx-data-dir 显式指定，或设置 BOBO_ROOT/DBX_DATA_DIR 环境变量。")


def load_profiles(db_path: Path | None = None,
                  bobo_root: Path | None = None,
                  override: str | None = None) -> list[dict[str, Any]]:
    """读取 DBX 保存的全部连接配置（合并密码）。返回 profile 字典列表。"""
    path = db_path or dbx_db_path(bobo_root, override)
    if not path.is_file():
        raise FileNotFoundError(
            f"找不到 DBX 连接库 {path}。请确认已在左侧「数据库」面板新建过连接，且 BoBo 的 dbx-runtime/data 存在。")
    con = sqlite3.connect(str(path))
    try:
        rows = con.execute("SELECT id, config_json FROM connections").fetchall()
        secrets = dict(con.execute(
            "SELECT connection_id, secret FROM connection_secrets").fetchall())
    finally:
        con.close()
    profiles: list[dict[str, Any]] = []
    for cid, cjson in rows:
        try:
            cfg = json.loads(cjson)
        except Exception:
            cfg = {}
        cfg["_id"] = cid
        cfg.setdefault("connection_id", cid)
        # 密码合并：优先连接配置自带，其次 connection_secrets
        if not cfg.get("password") and cid in secrets:
            cfg["password"] = secrets[cid]
        profiles.append(cfg)
    return profiles


def find_profile(name: str, profiles: list[dict[str, Any]]) -> dict[str, Any]:
    """按连接名（name 字段）查找连接；找不到则给出可选清单报错。"""
    for p in profiles:
        if (p.get("name") or "") == name or (p.get("connection_id") or "") == name:
            return p
    names = [p.get("name", "?") for p in profiles]
    raise LookupError(
        f"DBX 中不存在连接「{name}」。已保存的连接：{names or '（无）'}。请先在「数据库」面板新建，或检查连接名。")


# ---------------------------------------------------------------------------
# 驱动连接
# ---------------------------------------------------------------------------


def _mysqlish(profile: dict[str, Any]):
    try:
        import pymysql  # type: ignore
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("缺少 pymysql 驱动，请执行: pip install pymysql") from e
    return pymysql.connect(
        host=profile.get("host") or "127.0.0.1",
        port=int(profile.get("port") or 3306),
        user=profile.get("username") or "root",
        password=profile.get("password") or "",
        database=profile.get("database") or None,
        charset="utf8mb4",
        connect_timeout=int(profile.get("connect_timeout_secs") or 10),
        autocommit=True,
    )


def _postgres(profile: dict[str, Any]):
    try:
        import psycopg  # type: ignore
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("缺少 psycopg 驱动，请执行: pip install 'psycopg[binary]'") from e
    kwargs = dict(
        host=profile.get("host") or "127.0.0.1",
        port=int(profile.get("port") or 5432),
        user=profile.get("username") or "postgres",
        password=profile.get("password") or "",
        dbname=profile.get("database") or None,
        connect_timeout=int(profile.get("connect_timeout_secs") or 10),
    )
    return psycopg.connect(**kwargs)


def _sqlite(profile: dict[str, Any]):
    dbfile = profile.get("database")
    if not dbfile:
        raise RuntimeError("SQLite 连接缺少 database（文件路径）字段。")
    return sqlite3.connect(dbfile)


_CONNECTORS = {
    "mysql": _mysqlish,
    "mariadb": _mysqlish,
    "postgres": _postgres,
    "postgresql": _postgres,
    "sqlite": _sqlite,
    "sqlite3": _sqlite,
}


def connect(profile: dict[str, Any]):
    """按 profile 的 db_type 选择驱动并建立连接；返回可执行 SQL 的连接对象。"""
    db_type = (profile.get("db_type") or "").lower()
    if db_type in ("mysql", "mariadb"):
        db_type = "mysql"
    if db_type in ("postgresql",):
        db_type = "postgres"
    if db_type in ("sqlite3",):
        db_type = "sqlite"
    fn = _CONNECTORS.get(db_type)
    if fn is None:
        raise RuntimeError(
            f"暂不支持 db_type={profile.get('db_type')}。当前支持的驱动：{sorted(set(_CONNECTORS.values()))}"
            "；该类型的驱动可按需补充到 _CONNECTORS。")
    return fn(profile)


def run_query(conn, sql: str, params: list[Any] | tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    """执行查询/写语句。SELECT 返回行列表（字典）；写语句返回空列表。"""
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        if cur.description:  # 有结果集 → 是查询
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        return []
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# 元数据：建表 / 列表 / 字段
# ---------------------------------------------------------------------------


def list_tables(profile: dict[str, Any]) -> list[str]:
    """列出某连接下可访问的表名。"""
    db_type = (profile.get("db_type") or "").lower()
    if db_type in ("sqlite", "sqlite3"):
        sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    elif db_type in ("postgres", "postgresql"):
        sql = ("SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') "
               "ORDER BY tablename")
    else:  # mysql / mariadb / 兜底
        sql = ("SELECT table_name FROM information_schema.tables "
               "WHERE table_schema = DATABASE() ORDER BY table_name")
    conn = connect(profile)
    try:
        rows = run_query(conn, sql)
    finally:
        conn.close()
    return [list(r.values())[0] for r in rows]


def describe_table(profile: dict[str, Any], table: str) -> list[dict[str, Any]]:
    """返回表字段定义列表：column、type、nullable、key（PK/UNI/MUL/''）、comment(如有)。"""
    db_type = (profile.get("db_type") or "").lower()
    conn = connect(profile)
    try:
        if db_type in ("mysql", "mariadb"):
            rows = run_query(
                conn,
                "SELECT COLUMN_NAME AS `column`, COLUMN_TYPE AS type, "
                "IS_NULLABLE AS nullable, COLUMN_KEY AS `key`, COLUMN_COMMENT AS comment "
                "FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = %s "
                "ORDER BY ORDINAL_POSITION",
                [table],
            )
        elif db_type in ("postgres", "postgresql"):
            rows = run_query(
                conn,
                "SELECT column_name AS column, data_type AS type, "
                "is_nullable AS nullable, '' AS key, '' AS comment "
                "FROM information_schema.columns WHERE table_name = %s ORDER BY ordinal_position",
                [table],
            )
        elif db_type in ("sqlite", "sqlite3"):
            rows = run_query(conn, f"PRAGMA table_info(`{table}`)")
            # PRAGMA 列: cid,name,type,notnull,dflt_value,pk
            rows = [
                {"column": r["name"], "type": r["type"],
                 "nullable": "NO" if r["notnull"] else "YES",
                 "key": "PRI" if r["pk"] else "", "comment": ""}
                for r in rows
            ]
        else:
            raise RuntimeError(f"describe_table 暂不支持 db_type={profile.get('db_type')}")
        return rows
    finally:
        conn.close()


def table_exists(profile: dict[str, Any], table: str) -> bool:
    try:
        return table in list_tables(profile)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# UPSERT（无重复入库：去重/更新）
# ---------------------------------------------------------------------------


def _normalize_db_type(db_type: str) -> str:
    dt = (db_type or "").lower()
    if dt in ("mariadb",):
        return "mysql"
    if dt in ("postgresql", "postgres"):
        return "postgres"
    if dt == "sqlite3":
        return "sqlite"
    return dt


def _quote_identifier(name: str, db_type: str = "mysql") -> str:
    """按目标库方言给标识符加引号：MySQL 反引号，PostgreSQL/SQLite 双引号。"""
    if "'" in name or '"' in name or "`" in name or ";" in name:
        raise ValueError(f"非法标识符: {name!r}")
    if _normalize_db_type(db_type) == "mysql":
        return f"`{name}`"
    return f'"{name}"'


def upsert_rows(profile: dict[str, Any], table: str, rows: list[dict[str, Any]],
                unique_keys: list[str] | None = None,
                batch: int = 200) -> dict[str, int]:
    """按唯一键 UPSERT 写库：已存在则更新，不存在则插入。返回 {inserted, updated}。

    - unique_keys：去重键（目标表主键/唯一键，或用户确认的自然唯一字段）。为空且无法从表推断时，
      退化为追加插入（只 inserted，不 updated）。
    - 自动推断：unique_keys 为空时尝试取表的主键字段（describe_table 中 key==PRI / pk=1）；
      若主键是自增字段（不提供自然键），也并入 upsert 依据——缺值则由库自行处理。
    """
    if not rows:
        return {"inserted": 0, "updated": 0}
    db_type = _normalize_db_type(profile.get("db_type") or "")
    cols = list(rows[0].keys())
    for extra in rows[1:]:
        for c in extra:
            if c not in cols:
                cols.append(c)

    # 去重键决议
    keys = list(unique_keys or [])
    if not keys:
        try:
            keys = [d["column"] for d in describe_table(profile, table) if d.get("key") in ("PRI", "pri")]
        except Exception:
            keys = []
    keys_unq = list(keys)
    qkeys = [_quote_identifier(k, db_type) for k in keys]
    qcols = [_quote_identifier(c, db_type) for c in cols]
    qtable = _quote_identifier(table, db_type)
    ph = "?" if db_type == "sqlite" else "%s"
    insert_sql = (f"INSERT INTO {qtable} ({', '.join(qcols)}) "
                  f"VALUES ({','.join([ph] * len(qcols))})")
    # 可更新的非去重键字段（用原始列名取值，SQL 里再用引号标识符）
    update_cols = [c for c in cols if (not qkeys) or (c not in qkeys)]
    if qkeys and update_cols:
        set_clause = ", ".join(f"{_quote_identifier(c, db_type)}={ph}" for c in update_cols)
        where_clause = " AND ".join(f"{k}={ph}" for k in qkeys)
        update_sql = f"UPDATE {qtable} SET {set_clause} WHERE {where_clause}"

    conn = connect(profile)
    try:
        cur = conn.cursor()
        inserted = updated = 0
        for i in range(0, len(rows), batch):
            chunk = rows[i:i + batch]
            for row in chunk:
                vals = [row.get(c) for c in cols]
                if qkeys and update_cols:
                    # 先按唯一键更新；未命中再插入（跨库计数准确）
                    cur.execute(update_sql,
                                [row.get(c) for c in update_cols] + [row.get(k) for k in keys_unq])
                    if (cur.rowcount or 0) > 0:
                        updated += 1
                        continue
                cur.execute(insert_sql, vals)
                inserted += 1
        conn.commit()
        return {"inserted": inserted, "updated": updated}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 命令行
# ---------------------------------------------------------------------------


def _resolve(args: argparse.Namespace) -> tuple[Path | None, list[dict[str, Any]]]:
    if getattr(args, "bobo_root", None):
        os.environ["BOBO_ROOT"] = args.bobo_root
    root = find_bobo_root(args.start)
    if root is None and not args.dbx_data_dir and not _env("BOBO_ROOT") and not _env("DBX_DATA_DIR"):
        print(f"警告：未定位到 BoBo 根目录（从 {args.start or Path.cwd()} 上查无 dbx-runtime）。",
              file=sys.stderr)
    profiles = load_profiles(None, root, args.dbx_data_dir)
    return root, profiles


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="dbx_connector",
        description="读取 DBX 已保存连接并操作数据库（列表/表结构/UPSERT 的基础库 + CLI）。")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_bool(parser: argparse.ArgumentParser, default: bool = False):
        parser.add_argument("--json", action="store_true", default=default,
                            help="以 JSON 输出")

    sp = sub.add_parser("list-connections", help="列出 DBX 已保存的连接")
    add_bool(sp)

    sp = sub.add_parser("list-tables", help="列出某连接下的表")
    sp.add_argument("conn", help="连接名")
    sp.add_argument("--json", action="store_true", help="以 JSON 输出")

    sp = sub.add_parser("describe-table", help="查看某表字段定义")
    sp.add_argument("conn", help="连接名")
    sp.add_argument("table", help="表名")
    sp.add_argument("--json", action="store_true", help="以 JSON 输出")

    sp = sub.add_parser("table-exists", help="判断某表是否存在")
    sp.add_argument("conn", help="连接名")
    sp.add_argument("table", help="表名")

    p.add_argument("--start", default=None, help="路径解析起点（缺省用当前目录）")
    p.add_argument("--dbx-data-dir", default=None,
                   help="显式指定 dbx-runtime/data 目录（找不到时用）")
    p.add_argument("--bo-bo-root", dest="bobo_root", default=None, help="显式指定 BoBo 根目录")

    if _env("BOBO_ROOT"):
        p.set_defaults(bobo_root=_env("BOBO_ROOT"))

    args = p.parse_args(argv)
    _, profiles = _resolve(args)

    def fmt(x):
        return print(json.dumps(x, ensure_ascii=False, indent=2, default=str)) if args.json else print(x)

    try:
        if args.cmd == "list-connections":
            out = [{k: v for k, v in pr.items() if k not in ("password", "_id", "connection_string", "external_config", "jdbc_driver_paths", "database_info")}
                   for pr in profiles]
            fmt(out)
        else:
            conn = find_profile(args.conn, profiles)
            if args.cmd == "list-tables":
                fmt(list_tables(conn))
            elif args.cmd == "describe-table":
                fmt(describe_table(conn, args.table))
            elif args.cmd == "table-exists":
                print(table_exists(conn, args.table))
        return 0
    except Exception as e:  # noqa: BLE001 — CLI 顶层兜底
        print(f"错误: {e}", file=sys.stderr)
        return 1


def iter_rows_hint() -> Iterator[None]:  # 供确实需要迭代的扩展点占位，无实际逻辑
    yield None


if __name__ == "__main__":
    raise SystemExit(main())