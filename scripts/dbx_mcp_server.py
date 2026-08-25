# -*- coding: utf-8 -*-
"""dbx-mcp —— 本地 MCP server，把 DBX 已保存连接的数据库读操作暴露给采集/工作流 AI。

方案 A：轻量、高频的"读/查/描述"（连接枚举、表结构、只读查询）走**常驻 MCP**——
server 常驻内存，带 **连接池**与**表结构缓存**，替代工作流里"逐命令起 Python 子进程
跑 dbx_connector"的启动开销，显著提速字段确认与表结构读取。**批量写库仍由提取入库脚本
进程内 `import dbx_connector` 完成**，不经过 MCP（避免行的 JSON-RPC 序列化开销）。

暴露的只读工具（模型可见名：mcp__dbx__*）：
- dbx_list_connections()                —— 列出 DBX 已保存的连接
- dbx_describe_table(conn, table)       —— 表字段定义（column/type/nullable/key/comment），带缓存
- dbx_table_exists(conn, table)         —— 判断表是否存在
- dbx_query(conn, sql)                  —— 仅允许只读 SELECT 的轻量查询

复用 `~/.dsh/skills/db-extraction/dbx_connector.py`（连库/元数据/UPSERT 单一实现来源），
用 `find_bobo_root()` 自动定位 BoBo 根目录、读取 dbx-runtime/data/dbx.db 的连接。
由 dsh 的 `@deepseek-ai/dsh-mcp-client` 插件以 stdio 方式拉起。
"""
from __future__ import annotations

import sys
from pathlib import Path

# ── 导入 dbx_connector（技能目录为单一实现来源；找不到时回退到脚本同目录） ──
_SKILL_DIR = Path.home() / ".dsh" / "skills" / "db-extraction"
if not _SKILL_DIR.is_dir():
    _SKILL_DIR = Path(__file__).resolve().parent
if str(_SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(_SKILL_DIR))

from mcp.server.fastmcp import FastMCP  # noqa: E402

import dbx_connector as dbx  # noqa: E402

mcp = FastMCP("dbx")

# 进程内缓存：BOBO_ROOT / 连接(每连接一个) / 表结构(每 连接+表)
_ROOT_CACHE: dict[bool, Path] = {}
_CONN_CACHE: dict[str, object] = {}
_SCHEMA_CACHE: dict[tuple[str, str], list[dict]] = {}


def _root() -> Path:
    if not _ROOT_CACHE:
        r = dbx.find_bobo_root()
        if r is None:
            raise RuntimeError("未定位到 BoBo 根目录（找不到含 dbx-runtime 的目录）。请确认在 BoBo 环境内运行。")
        _ROOT_CACHE[True] = r
    return _ROOT_CACHE[True]


def _profile(conn_name: str):
    profiles = dbx.load_profiles(bobo_root=_root())
    return dbx.find_profile(conn_name, profiles)


def _get_conn(conn_name: str):
    key = conn_name
    if key not in _CONN_CACHE:
        _CONN_CACHE[key] = dbx.connect(_profile(conn_name))
    return _CONN_CACHE[key]


@mcp.tool()
def dbx_list_connections() -> list[dict]:
    """列出 DBX 中已保存的数据库连接（连接名 / 类型 / 主机 / 库，不含密码）。

    供 AI 在"确认目标库连接"时使用，取代逐命令起子进程跑 `dbx_connector list-connections`。
    """
    return [
        {k: v for k, v in p.items()
         if k not in ("password", "_id", "connection_string", "external_config",
                      "jdbc_driver_paths", "database_info")}
        for p in dbx.load_profiles(bobo_root=_root())
    ]


@mcp.tool()
def dbx_describe_table(conn: str, table: str) -> list[dict]:
    """返回连接 `conn` 下表 `table` 的字段定义列表（column/type/nullable/key/comment）。

    供 AI 读取目标表结构、核对字段时使用。同一 (conn,table) 结果进程内缓存，重复调用不重建连。
    """
    key = (conn, table)
    if key not in _SCHEMA_CACHE:
        _SCHEMA_CACHE[key] = dbx.describe_table(_profile(conn), table)
    return _SCHEMA_CACHE[key]


@mcp.tool()
def dbx_table_exists(conn: str, table: str) -> bool:
    """判断连接 `conn` 下是否存在表 `table`。"""
    return dbx.table_exists(_profile(conn), table)


@mcp.tool()
def dbx_query(conn: str, sql: str) -> list[dict]:
    """在连接 `conn` 上执行一条**只读 SELECT** 查询，返回行列表（每行一个 dict）。

    仅允许以 SELECT 开头的语句，防止误写库；连接在进程内复用。批量写库请走提取入库脚本。
    """
    if not sql.strip().lower().startswith("select"):
        raise ValueError("dbx_query 仅允许只读 SELECT 查询；写库请用提取入库脚本（dbx_connector）。")
    return dbx.run_query(_get_conn(conn), sql)


if __name__ == "__main__":
    mcp.run(transport="stdio")