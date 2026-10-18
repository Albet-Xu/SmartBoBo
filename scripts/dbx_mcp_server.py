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
- dbx_query(conn, sql, max_rows, detail, save)
                                        —— 仅允许只读 SELECT；默认返回**摘要 + 磁盘定位**
                                           （列名/行数/前 K 行/落盘路径），完整结果集写磁盘

「在源头收敛上下文」：`dbx_query` 默认不回整张表——SELECT * 打到宽表曾直接把几万行塞进模型
上下文，dsh 事后做 50KB 头尾裁剪时字节早已走完。现在工具自己给结论（列名、真实行数、前
max_rows 行、落盘路径），完整结果集由 `result_digest` 写到磁盘，模型按需去读/grep。
`detail="full"` 保留旧行为（原样返回全部行），供确知结果很小的调用方使用。

复用 `<DSH_HOME>/skills/db-extraction/dbx_connector.py`（连库/元数据/UPSERT 单一实现来源），
优先用 DBX_DATA_DIR（桌面壳注入）定位 dbx.db，否则用 `find_bobo_root()` 定位 BoBo 根目录读取 dbx-runtime/data/dbx.db。
由 dsh 的 `@deepseek-ai/dsh-mcp-client` 插件以 stdio 方式拉起。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# ── 导入 dbx_connector（技能目录为单一实现来源；找不到时回退到脚本同目录） ──
# 查找顺序：$DSH_HOME/skills（桌面壳/打包版用户数据根）> $BOBO_ROOT/skills（打包版随包）
# > $BOBO_ROOT/bobo-data/dsh/skills（开发态播种位置）> 脚本同目录。
_dsh_home = os.environ.get("DSH_HOME")
_bobo_root = os.environ.get("BOBO_ROOT")
_SKILL_DIR = Path(_dsh_home) / "skills" / "db-extraction" if _dsh_home else None
if not _SKILL_DIR or not _SKILL_DIR.is_dir():
    _SKILL_DIR = Path(_bobo_root) / "skills" / "db-extraction" if _bobo_root else None
if not _SKILL_DIR or not _SKILL_DIR.is_dir():
    _SKILL_DIR = Path(_bobo_root) / "bobo-data" / "dsh" / "skills" / "db-extraction" if _bobo_root else None
if not _SKILL_DIR or not _SKILL_DIR.is_dir():
    _SKILL_DIR = Path(__file__).resolve().parent.parent / "dsh" / ".agents" / "skills" / "db-extraction"
if not _SKILL_DIR.is_dir():
    _SKILL_DIR = Path(__file__).resolve().parent
if str(_SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(_SKILL_DIR))

from mcp.server.fastmcp import FastMCP  # noqa: E402

import dbx_connector as dbx  # noqa: E402

# 摘要层与本文件同目录（脚本目录入路径，保证以任意 cwd 拉起 MCP 子进程都能 import）
sys.path.insert(0, str(Path(__file__).resolve().parent))
import result_digest  # noqa: E402

mcp = FastMCP("dbx")

# 单次查询最多取回/落盘的**硬上限**（防 `SELECT *` 打爆内存与磁盘）。
# 到达上限时行数不再真实（是上限值），返回值里会显式说明。
HARD_FETCH_CEILING = 20000
# 游标分批读取粒度：只留前 max_rows 行，其余边读边落盘，不整表驻留内存。
_ROW_BATCH = 500
_DEFAULT_MAX_ROWS = 200

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


def _profiles() -> list[dict]:
    """读取 DBX 连接列表。优先 DBX_DATA_DIR（桌面壳注入，安装版唯一可靠来源），
    否则回落到含 dbx-runtime 的 BoBo 根目录。"""
    data_dir = os.environ.get("DBX_DATA_DIR", "").strip()
    if data_dir:
        return dbx.load_profiles(db_path=Path(data_dir) / "dbx.db")
    return dbx.load_profiles(bobo_root=_root())


def _profile(conn_name: str):
    profiles = _profiles()
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
        for p in _profiles()
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


def _read_rows(conn_name: str, sql: str, max_rows: int, save: bool) -> dict:
    """按游标分批读结果集：只留前 `max_rows` 行，超出部分边读边落盘。

    用 DB-API 游标（sqlite3 / pymysql / psycopg 都支持 `cursor()`/`fetchmany()`），而不是
    `dbx.run_query()` 的裸 `fetchall()`——后者会把整张表一次性搬进内存。落盘失败只记进
    `written.error`，不影响本次查询的结论（row_count / 前 K 行照常返回）。
    """
    cur = _get_conn(conn_name).cursor()
    head: list[dict] = []
    row_count = 0
    ceiling_hit = False
    writer = None
    written: dict = {}
    try:
        cur.execute(sql)
        description = getattr(cur, "description", None)
        columns = [d[0] for d in description] if description else []
        if not columns:
            return {"columns": [], "head": [], "row_count": 0, "ceiling_hit": False, "written": {}}
        while True:
            batch = cur.fetchmany(_ROW_BATCH)
            if not batch:
                break
            for raw in batch:
                if row_count >= HARD_FETCH_CEILING:
                    ceiling_hit = True
                    break
                row = dict(zip(columns, raw))
                row_count += 1
                if len(head) < max_rows:
                    head.append(row)
                elif save:
                    if writer is None:
                        # 第 max_rows+1 行才开文件；先补写头部，落盘的是完整结果集
                        writer = result_digest.PayloadWriter(f"dbx-{conn_name}", fmt="jsonl")
                        for buffered in head:
                            writer.write_row(buffered)
                    writer.write_row(row)
            if ceiling_hit:
                break
    finally:
        cur.close()
    if writer is not None:
        written = writer.finish()
    return {"columns": columns, "head": head, "row_count": row_count,
            "ceiling_hit": ceiling_hit, "written": written}


@mcp.tool()
def dbx_query(conn: str, sql: str, max_rows: int = 200, detail: str = "digest",
              save: bool = True) -> dict | list[dict]:
    """在连接 `conn` 上执行一条**只读 SELECT**，默认返回摘要（摘要 + 落盘路径，不给整张表）。

    仅允许以 SELECT 开头的语句，防止误写库；连接在进程内复用。批量写库请走提取入库脚本。

    **先加 WHERE / LIMIT**。默认 `detail="digest"` 只为宽表兜底，不是让你拿它当分页器：
    - 结果 ≤ `max_rows`（默认 200）：完整行内联在 `rows` 里（3 行的小查询不必再取一次）；
    - 结果 > `max_rows`：只回 `head`（前 `max_rows` 行）+ 真实 `row_count`，**完整结果集写到磁盘**
      （`written.jsonl` 是文件路径，`save=True` 时才有），要看全量直接读/grep 那个文件——
      **不要为了翻页反复重跑同一句 SQL**；
    - `detail="full"`：旧行为，原样返回全部行（无行列上限，结果大时会把上下文撑爆，慎用）。

    单次最多取回 `HARD_FETCH_CEILING=20000` 行；到达该上限时 `row_count` 是上限值而非真实
    总行数，`notes` 里会写明。

    Args:
        conn: DBX 已保存的连接名（见 dbx_list_connections）。
        sql: 只读 SELECT 语句。先自己加 WHERE / LIMIT / ORDER BY，别整表拉回来再筛。
        max_rows: 内联返回的最大行数（默认 200，上限 20000）。
        detail: digest（默认，摘要 + 落盘）或 full（原样返回全部行）。
        save: 结果被截断时是否把**完整结果集**写到磁盘（默认 True；写失败只在 notes 里说明，
            不会让本次查询失败）。
    """
    if not sql.strip().lower().startswith("select"):
        raise ValueError("dbx_query 仅允许只读 SELECT 查询；写库请用提取入库脚本（dbx_connector）。")

    if str(detail).strip().lower() == "full":
        return dbx.run_query(_get_conn(conn), sql)

    try:
        limit = max(1, min(int(max_rows), HARD_FETCH_CEILING))
    except (TypeError, ValueError):
        limit = _DEFAULT_MAX_ROWS

    data = _read_rows(conn, sql, limit, bool(save))
    head = data["head"]
    row_count = data["row_count"]
    ceiling_hit = data["ceiling_hit"]
    truncated = ceiling_hit or row_count > len(head)
    # house envelope 的写法：written 是 {角色: 路径}，角色不同工具不同（这里是 jsonl）
    spilled = data["written"]
    spilled_path = spilled.get("path") or ""
    written = {"jsonl": spilled_path} if spilled_path else {}

    result: dict = {
        "ok": True,
        "conn": conn,
        "sql": sql,
        "columns": data["columns"],
        "row_count": row_count,
        "returned": len(head),
        "truncated": truncated,
    }
    if truncated:
        result["head"] = head
    else:
        result["rows"] = head
    result["written"] = written

    notes: list[str] = []
    if not truncated:
        notes.append(f"结果完整（{row_count} 行 ≤ max_rows={limit}），已内联在 `rows`，未落盘。")
        result["next"] = "需要更多行就放宽 WHERE/LIMIT 后重查；本结果无磁盘副本。"
    else:
        result["next"] = (
            f"要看更多：① 加 WHERE/LIMIT 只取需要的列与行；② 提高 max_rows（当前 {limit}）重查；"
            + (f"③ 直接读/grep 落盘文件 {written['jsonl']}（完整结果集，不必重跑 SQL）。"
               if written else "③ 本次未落盘（save=False 或写盘失败），需全量请带 save=True 重查。")
        )
        notes.append(f"结果共 {row_count} 行、超过 max_rows={limit}，本次只回 `head` 前 {len(head)} 行。")
        if written:
            notes.append(f"完整结果集已落盘（JSONL）：{spilled_path}（{spilled.get('bytes', 0)} 字节）。"
                         "要具体行就读那个文件，别为了翻页反复重跑同一句 SQL。")
        elif save:
            notes.append(f"落盘失败：{spilled.get('error', '未知原因')}；本次只有摘要。")
        else:
            notes.append("未落盘（save=False）：超过 max_rows 的行本次被丢弃。")
    if ceiling_hit:
        notes.append(f"已达单次硬上限 {HARD_FETCH_CEILING} 行：`row_count` 是上限值，不是真实总行数；"
                     "请用 COUNT(*) 或加 WHERE 缩小范围。")
    result["notes"] = notes
    return result


if __name__ == "__main__":
    mcp.run(transport="stdio")