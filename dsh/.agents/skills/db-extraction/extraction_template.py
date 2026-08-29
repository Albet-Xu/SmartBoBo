# -*- coding: utf-8 -*-
"""
提取入库脚本模板（db-extraction 技能提供）—— 通用骨架可复用，勿重写。

生成脚本时：
 1. 本文件复制为  <工作区>/extraction_scripts/<名称>.py，并把同目录的 `dbx_connector.py`
    一并复制过来（脚本导入它读写数据库）。
 2. 只修改标有 `# ⛏️ GEN-CUSTOM` 的区域：CONFIG（连接/目标表/输入/source_format/去重键/固定值）
    与 `extract_rows()`（本网站特有的解析逻辑）；其余保持不变。
 3. 运行方式（建议用 BoBo 的 .venv python，已含 pymysql/psycopg 与 lxml）：
       python <名称>.py --dry-run                # 预览将要写入的行（回显给用户确认）
       python <名称>.py                          # 正式入库（UPSERT 去重/更新）
   可选参数：--conn/--table/--data/--unique/--limit/--input-format 会覆盖 CONFIG 对应项。
 4. 输出统一为"预览行 JSON + 插入/更新条数"，不做静默失败。

采集输出格式 source_format（与工作流采集落盘的 outputFormat 对应，必须一致）：
 - "md"（默认）：Markdown，适合标题 / 正文 / 简介等常规纯文本字段。
 - "html"：渲染后 HTML，适合需要用选择器精确定位 / 取链接(href) / 嵌套结构化字段。
 - "skeleton"：块级骨架（每行 `CSS路径 -> 文本`），适合按块 / 容器逐块取文本。
 工作流里按"入库字段的提取需求"选定；字段三种格式都可以时选默认 md。

读取的输入（采集数据）默认来自当前工作区 data/ 里 `crawl_fetch`（按 source_format 输出）或
逆向脚本落盘的 Markdown / HTML / 骨架文本；`extract_rows()` 负责把文本拆成一条条记录
（dict，键=数据库字段名）。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# 让同目录下的数据库连接库可被导入
sys.path.insert(0, str(Path(__file__).resolve().parent))
from dbx_connector import (
    find_profile,
    load_profiles,
    upsert_rows,
)


# ⛏️ GEN-CUSTOM —— 目标定制区（生成脚本时只改这里）───────────────────────────

CONFIG: dict = {
    # DBX 中已保存的连接名（用 dbx_connector.py list-connections 查看）
    "conn": "MySQL_tloz",
    # 目标表名
    "table": "target_table",
    # dbx.db 所在目录：BoBo/dbx-runtime/data（绝对路径）。
    # 生成脚本时由 AI 定位 BoBo 根目录后填入，确保在任何工作区都能读到 DBX 已存连接。
    "dbx_data_dir": "",
    # 输入数据：可以是单个文件、通配（*.md）、或一个目录（遍历其中 .md/.txt/.html/.skeleton.txt）。
    # 批量入库时通常填一个 data 目录或用 --data/--urls 指定。
    "input": "data",
    # URL 清单模式下的已抓数据目录（采集与入库分离：清单用于批量采集落盘，入库读这里）
    "data_dir": "data",
    # 采集输出的源格式："md"(默认) / "html" / "skeleton"。
    # 必须与工作流采集落到 data/ 的 crawl_fetch outputFormat 一致，extract_rows 按它解析。
    "source_format": "md",
    # 去重键：目标表主键/唯一键，或多条记录中共有的自然唯一字段（可多列）
    # 留空则尝试取表主键；仍无则退化为追加插入。
    "unique": [],
    # 固定值：{数据库字段名: 用户给定的固定值}，用于无法从网页提取的字段
    "fixed_values": {},
    # 字段重命名/别名：可选，{脚本内键: 目标字段名}
    "field_aliases": {},
}


def parse_source(text: str, source_format: str) -> object:
    """把采集源文本按格式初步拆成"可取值块列表"，供 extract_rows 使用。

    返回：
    - "md"      -> list[str]，按空行的段落块列表
    - "skeleton"-> list[(css_path, text)]，按 `路径 -> 文本` 行逐块拆
    - "html"    -> lxml 解析后的文档根（可用 xpath / cssselect 取值）；缺 lxml 时返回原文本
    这是通用拆分，具体字段取值仍在 extract_rows 里按网站写。
    """
    if source_format == "skeleton":
        blocks = []
        for line in text.splitlines():
            line = line.rstrip()
            if not line:
                continue
            if " -> " in line:
                path, val = line.split(" -> ", 1)
                blocks.append((path.strip(), val.strip()))
            else:
                blocks.append(("", line.strip()))
        return blocks
    if source_format == "html":
        try:
            from lxml import html as _lh
            return _lh.fromstring(text)
        except Exception:
            # 缺 lxml 时回退为原始文本，由 extract_rows 自行处理
            return text
    # md 默认：按空行拆段落
    return [b.strip() for b in re.split(r"\n\s*\n", text) if b and b.strip()]


def extract_rows(text: str, source_format: str) -> list[dict]:
    """把采集结果 text（其格式为 CONFIG.source_format，见 --input-format）解析成一条条记录。

    返回的每条 dict：键 = 数据库字段名，值 = 该记录该字段的值。
    - 网页上没有的字段：不要放进来（或放 None），模板会按 fixed_values/空值处理。
    - 字段值建议清洗后返回（去空白、取整、格式化）。
    - 先调用 parse_source(text, source_format) 得到通用"取值块"，再按字段取值。

    按格式的取值范式（示例）：
    - md：chunks = parse_source(text, "md")；按段落标题/关键词定位取值，如
        title = chunks[0] 或 从 "# " 标题解析。
    - skeleton：for path, val in parse_source(text, "skeleton"): 按 path 前缀/关键字取块，
        如 path 以 "div.list > h3" 含链接的取标题、相邻块取价格。
    - html：root = parse_source(text, "html")；用 xpath 精确定位，如
        root.xpath('//a[contains(@class,"title")]/text()') 取标题、@href 取链接。
    """
    # ---- 目标网站特有的解析逻辑：写在这里 ----
    # chunks = parse_source(text, source_format)
    # rows = []
    # for chunk in chunks:
    #     rows.append({...})   # 键=数据库字段名
    # return rows
    raise NotImplementedError(
        "请实现 extract_rows(text, source_format)（本网站特有的记录解析逻辑）。"
    )


# ⛏️ GEN-CUSTOM ——— 定制区结束 ─────────────────────────────────────────────


# ── 通用：字段清洗与固定值/空值处理 ────────────────────────────────────────

def _clean_scalar(v: object) -> object:
    """库前兜底清洗：纯空白字符串 → None。"""
    if isinstance(v, str):
        v = v.strip()
        return v if v else None
    return v


def _finalize_row(raw: dict, table_cols: list[str], fixed_values: dict) -> dict:
    """把 extract_rows 返回的记录规整成"目标表字段 → 值"，应用固定值与空值策略。"""
    row: dict = {}
    for col in table_cols:
        if col in raw:                       # 网页提取到的值
            row[col] = _clean_scalar(raw[col])
        elif col in fixed_values:            # 用户确认的固定值
            row[col] = _clean_scalar(fixed_values[col])
        else:                                # 无法提取且无固定值 → 空值(None)
            row[col] = None
    return row


def _dedup(rows: list[dict], keys: list[str]) -> list[dict]:
    """本地按唯一键简单去重（保留后出现的）。"""
    if not keys:
        return rows
    seen: dict[tuple, dict] = {}
    for r in rows:
        k = tuple(r.get(k) for k in keys)
        seen[k] = r
    return list(seen.values())


# ── 通用：CLI ───────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="把采集数据按字段抽取后 UPSERT 入库（去重/更新）。")
    p.add_argument("--conn", default=CONFIG.get("conn"), help="DBX 连接名")
    p.add_argument("--table", default=CONFIG.get("table"), help="目标表名")
    p.add_argument("--data", default=CONFIG.get("input") or "", help="输入：文件 / 通配(*.md) / 目录(遍历其中 md/txt/html)")
    p.add_argument("--data-dir", default=CONFIG.get("data_dir") or "data",
                   help="URL 清单模式下的已抓数据目录（默认 data）")
    p.add_argument("--urls", default="", help="URL 清单文件（每行一个 URL，采集与入库分离时作批量清单，入库读 data/）")
    p.add_argument("--dbx-data-dir", default=CONFIG.get("dbx_data_dir") or "",
                   help="dbx.db 所在目录（BoBo/dbx-runtime/data）")
    p.add_argument("--input-format", default=CONFIG.get("source_format") or "md",
                   choices=["md", "html", "skeleton"],
                   help="采集源格式 md/html/skeleton（覆盖 CONFIG.source_format；须与采集落盘格式一致）")
    p.add_argument("--unique", default="", help="逗号分隔的去重键（覆盖 CONFIG.unique）")
    p.add_argument("--limit", type=int, default=0, help="最多处理前 N 条（0=全部）")
    p.add_argument("--dry-run", action="store_true", help="只预览行数据，不写库")
    p.add_argument("--json-out", action="store_true", help="dry-run 输出为 JSON")
    return p


def _has_glob(pattern: str) -> bool:
    return any(ch in pattern for ch in "*?[")


def resolve_input(pattern: str, cwd: Path) -> list[Path]:
    """把输入展开为实际文件列表。

    支持：单个文件、通配（*.md）、或一个目录（遍历其中 *.md / *.txt / *.html）。
    注意：skeleton 产物的扩展名为 .skeleton.txt，以 .txt 结尾，目录遍历时已被覆盖。
    相对路径以 cwd（当前工作区）为基准；也支持绝对路径。
    """
    if not pattern:
        return []
    p = Path(pattern)
    base = p if p.is_absolute() else (cwd / pattern)
    if base.is_dir():
        return sorted(f for f in base.iterdir()
                      if f.is_file() and f.suffix.lower() in (".md", ".txt", ".html"))
    if base.is_file():
        return [base]
    if _has_glob(pattern):
        if p.is_absolute():
            return sorted(p.parent.glob(p.name)) if p.parent.exists() else []
        return sorted(cwd.glob(pattern)) if (cwd / pattern).parent.exists() else []
    return []


def read_url_list(path: str) -> list[str]:
    """读取 URL 清单文件（每行一个 URL；# 开头为注释）。返回清洗后的 URL 列表。"""
    p = Path(path)
    if not p.is_file():
        return []
    out: list[str] = []
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            out.append(s)
    return out


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cwd = Path.cwd()

    conn_name = args.conn
    table = args.table
    source_format = (args.input_format or (CONFIG.get("source_format") or "md")).strip().lower()
    unique = [k.strip() for k in (args.unique or ",".join(CONFIG.get("unique", []) or [])).split(",") if k.strip()]

    # 解析输入文件（批量：文件 / 通配 / 目录；URL 清单作批量清单，读 data 目录里的已抓文件）
    urls: list[str] = []
    if args.urls and Path(args.urls).is_file():
        urls = read_url_list(args.urls)
        # 采集与入库分离：清单用于批量采集落盘，入库读已抓好的目录
        inputs = resolve_input(args.data_dir or "data", cwd)
        if urls:
            print(f"URL 清单 {len(urls)} 条；入库 {args.data_dir or 'data'} 下已抓取的 {len(inputs)} 个文件。")
    else:
        data_arg = args.data or args.data_dir or ""
        inputs = resolve_input(data_arg, cwd)
        if not inputs:
            inputs = resolve_input("data", cwd)
    if not inputs:
        print(f"错误: 没有找到待入库数据（--data/--data-dir 下无 .md/.txt/.html）。", file=sys.stderr)
        return 1

    # 定位 DBX 连接
    if args.dbx_data_dir:
        os.environ["DBX_DATA_DIR"] = args.dbx_data_dir
    else:
        # 未在 CONFIG 填 dbx_data_dir 时兜底：自动定位 BoBo 根目录（含 dbx-runtime）
        try:
            from dbx_connector import find_bobo_root
            root = find_bobo_root()
            if root:
                os.environ["DBX_DATA_DIR"] = str(root / "dbx-runtime" / "data")
        except Exception:
            pass
    profiles = load_profiles()
    profile = find_profile(conn_name, profiles)
    try:
        all_rows: list[dict] = []
        for fp in inputs:
            text = fp.read_text(encoding="utf-8", errors="replace")
            rows = extract_rows(text, source_format)
            for r in rows:
                if CONFIG.get("field_aliases"):
                    for old_key, new_key in CONFIG["field_aliases"].items():
                        if old_key in r and new_key not in r:
                            r[new_key] = r.pop(old_key)
            all_rows.extend(rows)

        # 统一键为表字段；若未指定唯一键，让库尝试取表主键
        if unique:
            keys = unique
        else:
            keys = list(CONFIG.get("unique", []) or [])

        # 表字段清单（用于补固定值/空值）；失败时以免强依赖
        table_cols = list(dict.fromkeys(
            [k for r in all_rows for k in r.keys()] + list(CONFIG.get("fixed_values", {}).keys())))
        rows_out = [_finalize_row(r, table_cols, CONFIG.get("fixed_values", {})) for r in all_rows]
        rows_out = _dedup(rows_out, keys)
        if args.limit > 0:
            rows_out = rows_out[: args.limit]

        if not rows_out:
            print("没有可写入的记录。")
            return 0

        if args.dry_run:
            if args.json_out:
                print(json.dumps({"table": table, "rows": rows_out},
                                 ensure_ascii=False, indent=2, default=str))
            else:
                print(f"【预览】目标表 {table}，共 {len(rows_out)} 条（去重键 {keys or '未指定/取其主键'}）：")
                for i, r in enumerate(rows_out, 1):
                    print(f"  #{i} {json.dumps(r, ensure_ascii=False, default=str)}")
            return 0

        # 正式入库（UPSERT 去重/更新）
        print(f"入库 {table}（去重键 {keys or '取其主键/追加'}），{len(rows_out)} 条 ...")
        result = upsert_rows(profile, table, rows_out, unique_keys=keys or None)
        print(f"完成：插入 {result['inserted']} 条，更新 {result['updated']} 条。")
        return 0
    except Exception as e:  # noqa: BLE001 — 顶层兜底，不静默失败
        print(f"入库失败: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())