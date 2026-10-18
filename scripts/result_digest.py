# -*- coding: utf-8 -*-
"""result_digest —— 「在源头收敛上下文」的工具结果摘要层（仅标准库）。

背景：重型 MCP 工具原先把整包数据塞进模型上下文，dsh 事后才做 50KB 头尾溢出裁剪——
字节早已走完，裁剪省不回 token。本模块让**工具自己**返回结论（条数、列名、前 K 行、
文档小标题、磁盘定位），把完整载荷写到磁盘；模型要看细节时去读文件，而不是再发一次
大结果。

三条硬约束：
1. 只用标准库（pathlib / json / os / re / tempfile / time / datetime）；
2. **任何函数都不许抛出**：写盘失败返回 `{"path": "", "error": ...}`，结构异常返回空摘要。
   摘要层绝不能让一次成功的查询变成一次工具报错；
3. 落盘文件名 = 时间戳 + 净化后的名字片段 + pid + 纳秒尾数，并发调用互不覆盖（不加锁）。

落盘目录见 `result_dir()`：`$DSH_HOME/tool-results` > `$BOBO_ROOT/bobo-data/dsh/tool-results`
> 系统临时目录 `bobo-tool-results`。``bobo-data/`` 已在 .gitignore 中，产物不会进版本库。
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

__all__ = [
    "result_dir",
    "sanitize_name",
    "PayloadWriter",
    "write_payload",
    "digest_rows",
    "digest_text",
]

FALLBACK_NAME = "payload"
MAX_NAME_CHARS = 60
HEADING_LIMIT = 20
HEADING_CHARS_MAX = 100

_EXTENSIONS = {
    "jsonl": ".jsonl",
    "json": ".json",
    "md": ".md",
    "markdown": ".md",
    "txt": ".txt",
    "text": ".txt",
    "csv": ".csv",
}

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")
_ATX_HEADING = re.compile(r"^#{1,6}\s+\S")
_NUMBERED_HEADING = re.compile(
    r"^(?:\d+(?:\.\d+){0,3}|[一二三四五六七八九十]{1,3})(?:[、.．)]|\s)\s*\S"
)


# ── 落盘目录 ────────────────────────────────────────────────────────────────
def result_dir() -> Path:
    """大载荷落盘目录；不存在则创建。

    解析顺序（先命中先用）：`$DSH_HOME/tool-results` > `$BOBO_ROOT/bobo-data/dsh/tool-results`
    > `tempfile.gettempdir()/bobo-tool-results`。某个候选建不出来（只读盘等）就退到下一个；
    全都建不出来时返回最后一个候选路径，由调用方在写盘时自己降级——**不抛异常**。
    """
    candidates: list[Path] = []
    dsh_home = os.environ.get("DSH_HOME", "").strip()
    bobo_root = os.environ.get("BOBO_ROOT", "").strip()
    if dsh_home:
        candidates.append(Path(dsh_home) / "tool-results")
    if bobo_root:
        candidates.append(Path(bobo_root) / "bobo-data" / "dsh" / "tool-results")
    candidates.append(Path(tempfile.gettempdir()) / "bobo-tool-results")
    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except OSError:
            continue
    return candidates[-1]


# ── 文件名 ──────────────────────────────────────────────────────────────────
def sanitize_name(value: Any) -> str:
    """把任意字符串收成文件系统安全的名字片段（只留 `[A-Za-z0-9._-]`）。

    非 ASCII（含中文）片段会被替换成 `-`；整体退化为空时返回 `payload`。
    """
    text = _UNSAFE.sub("-", str(value or ""))
    text = text.strip("-._")[:MAX_NAME_CHARS].strip("-._")
    return text or FALLBACK_NAME


def _unique_path(name_hint: str, fmt: str) -> Path:
    suffix = _EXTENSIONS.get(str(fmt or "").lower(), f".{sanitize_name(fmt)}")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    unique = f"{os.getpid()}-{time.time_ns() % 1_000_000:06d}"
    return result_dir() / f"{stamp}-{sanitize_name(name_hint)}-{unique}{suffix}"


# ── 流式写盘 ────────────────────────────────────────────────────────────────
class PayloadWriter:
    """把大载荷**流式**写到 `result_dir()` 下的唯一文件，返回 `{"path", "bytes", "rows", "format"}`。

    供「不能把整包结果留在内存里」的场景使用（大结果集边读游标边落盘）。
    写失败只记录、不抛：后续写入变成空操作，`finish()` 返回 `{"path": "", "error": ...}`，
    调用方据此降级为「有摘要、没有磁盘定位」。
    """

    def __init__(self, name_hint: str, fmt: str = "jsonl") -> None:
        self.format = str(fmt or "jsonl")
        self.rows: int | None = 0 if self.format == "jsonl" else None
        self.bytes = 0
        self.error: str | None = None
        self.path: Path | None = None
        self._handle: Any = None
        try:
            self.path = _unique_path(name_hint, self.format)
            self._handle = self.path.open("w", encoding="utf-8", newline="\n")
        except OSError as error:
            self.error = f"{type(error).__name__}: {error}"

    def write_line(self, line: str) -> bool:
        """写一行（自动补换行）；返回是否成功。行内计数 +1。"""
        if self._handle is None:
            return False
        text = line if line.endswith("\n") else f"{line}\n"
        try:
            self._handle.write(text)
            self.bytes += len(text.encode("utf-8"))
        except (OSError, ValueError) as error:
            self.error = f"{type(error).__name__}: {error}"
            self._close()
            return False
        self.rows = (self.rows or 0) + 1
        return True

    def write_row(self, row: Any) -> bool:
        """写一行 JSON（不可序列化的值退成 repr，不抛）。"""
        try:
            line = json.dumps(row, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            line = json.dumps({"_unserializable": repr(row)}, ensure_ascii=False)
        return self.write_line(line)

    def write_text(self, text: str) -> bool:
        """写一段纯文本（不分行计数）。"""
        if self._handle is None:
            return False
        try:
            self._handle.write(text)
            self.bytes += len(text.encode("utf-8"))
            return True
        except (OSError, ValueError) as error:
            self.error = f"{type(error).__name__}: {error}"
            self._close()
            return False

    def _close(self) -> None:
        try:
            if self._handle is not None:
                self._handle.close()
        except OSError:
            pass
        self._handle = None

    def finish(self) -> dict:
        """收尾并返回摘要；写失败时返回 `{"path": "", "error": ...}`。"""
        self._close()
        if self.error or self.path is None:
            return {"path": "", "error": self.error or "写入失败"}
        return {"path": str(self.path), "bytes": self.bytes, "rows": self.rows, "format": self.format}


def write_payload(name_hint: str, rows: Iterable[Any] | None = None, text: str | None = None,
                  fmt: str = "jsonl", max_rows: int | None = None) -> dict:
    """把完整载荷写到磁盘，返回 `{"path", "bytes", "rows", "format"}`。

    - `rows`：按 `fmt`（默认 jsonl）逐行落盘；`text` 给了就写原文，两者以 `text` 优先。
    - `max_rows`：只对 `rows` 生效的额外上限（缺省不限，写全量）。
    - **写失败不抛**：返回 `{"path": "", "error": <str>}`，调用方照常返回本次查询的结论。
    """
    try:
        writer = PayloadWriter(name_hint, fmt)
        if text is not None:
            writer.write_text(text)
        elif rows is not None:
            limit = max(0, int(max_rows)) if max_rows is not None else None
            for index, row in enumerate(rows):
                if limit is not None and index >= limit:
                    break
                if not writer.write_row(row):
                    break
        return writer.finish()
    except Exception as error:  # noqa: BLE001 — 摘要层绝不外抛
        return {"path": "", "error": f"{type(error).__name__}: {error}"}


# ── 表格摘要 ────────────────────────────────────────────────────────────────
def digest_rows(rows: Any, *, head: int = 5) -> dict:
    """表格类结果的结论：列名、总行数、前若干行、是否截断。

    空列表、生成器、非 dict 的行都不会抛：非映射行不贡献列名，原样出现在 `head` 里。
    """
    try:
        items = list(rows) if rows is not None else []
    except TypeError:
        items = []

    columns: list[str] = []
    seen: set[str] = set()
    for item in items:
        try:
            names = list(item.keys())
        except (AttributeError, TypeError):
            continue
        for name in names:
            text = str(name)
            if text not in seen:
                seen.add(text)
                columns.append(text)

    try:
        limit = max(0, int(head))
    except (TypeError, ValueError):
        limit = 5
    return {
        "columns": columns,
        "row_count": len(items),
        "head": items[:limit],
        "truncated": len(items) > limit,
    }


# ── 正文摘要 ────────────────────────────────────────────────────────────────
def _headings(text: str, limit: int = HEADING_LIMIT) -> list[str]:
    """抽 Markdown ATX 标题与编号小节行，去重后截到 `limit` 条。"""
    found: list[str] = []
    seen: set[str] = set()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) > HEADING_CHARS_MAX:
            continue
        if not (_ATX_HEADING.match(stripped) or _NUMBERED_HEADING.match(stripped)):
            continue
        cleaned = stripped.lstrip("# \t").strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        found.append(cleaned)
        if len(found) >= limit:
            break
    return found


def digest_text(text: str, *, head_chars: int = 600, headings: bool = True) -> dict:
    """正文/长文类结果的结论：字符数、开头一段、小标题清单（正文留在磁盘上）。

    `headings=False` 时跳过标题扫描；非字符串输入按空串处理——**不抛异常**。
    """
    body = text if isinstance(text, str) else ("" if text is None else str(text))
    try:
        limit = max(0, int(head_chars))
    except (TypeError, ValueError):
        limit = 600
    heading_list: list[str] = []
    if headings:
        try:
            heading_list = _headings(body)
        except Exception:  # noqa: BLE001 — 标题扫描只是锦上添花，失败不影响结论
            heading_list = []
    return {"char_count": len(body), "head": body[:limit], "headings": heading_list}
