# -*- coding: utf-8 -*-
"""pdf-extract —— 本地 MCP server，为 BoBo 提供「读取 PDF」工具。

模型可见工具（serverName=pdf-extract → mcp__pdf-extract__pdf_extract_*）：
- pdf_extract_info(pdf_path)  —— 查看 PDF 页数 / 是否可读（不读正文，模型可先探页数再分批读）
- pdf_extract(pdf_path, page_start, page_end, mode, save, save_dir)
                               —— 提取文字 + 表格（表格转 Markdown），保住版式里的文本信息与表格结构

文字版（无 OCR）：只能提取「可选文字层」的 PDF；扫描件 / 纯图片 PDF 需要 OCR（后续再加）。
分批策略：单次最多解析 max_pages 页（默认 20），且产出正文最多 max_chars 字符（默认 40000），
先到先止，返回「本次覆盖的页区间」；模型拿到 `truncated=true` 后可续调 pdf_extract 读后续页。
落盘：默认不落盘（只返回给模型）；仅当模型按用户要求把 save=true 传入时才在 save_dir（缺省取
PDF 所在目录）写一份 `<文件名>.extracted.md`。与 persona 规则一致：用户没让落盘就不落盘。

用法（源码/打包版一致，MCP 子进程由 dsh 清洗 env，关键覆盖变量由预设显式回传）：
    .venv/Scripts/python.exe scripts/pdf_extract_server.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

# ── 分批上限（可用环境变量覆盖；打包版如需调整在 MCP 预设 env 里改） ─────────
MAX_PAGES = int(os.environ.get("PDF_EXTRACT_MAX_PAGES", "20"))
MAX_CHARS = int(os.environ.get("PDF_EXTRACT_MAX_CHARS", "40000"))
# 单页文本超过该字符数时截断该页正文（极端版面防护，不影响后续页）
_PAGE_CHAR_HARD_CAP = int(os.environ.get("PDF_EXTRACT_PAGE_CHAR_CAP", "12000"))

mcp = FastMCP("pdf-extract")


def _norm_cell(value: object) -> str:
    """格式化表格单元格为 Markdown 文本（内含竖线/换行转义，避免破坏表格结构）。"""
    if value is None:
        return ""
    s = str(value)
    return s.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def _table_to_markdown(rows: list[list[object | None]]) -> str:
    """把 pdfplumber 的 extract_tables() 结果转成 Markdown 表格。

    行长短不齐时对齐到表头宽度；表格空/退化时返回空字符串。
    """
    if not rows:
        return ""
    header = rows[0]
    if not header:
        return ""
    width = len(header)
    # 过滤全空列影响已尽量小；这里只按表头宽度对齐，缺单元格补空
    head = [_norm_cell(c) for c in header]
    lines = ["| " + " | ".join(head) + " |"]
    lines.append("|" + "|".join("---" for _ in range(width)) + "|")
    for row in rows[1:]:
        filled = [_norm_cell(row[i]) if i < len(row) else "" for i in range(width)]
        lines.append("| " + " | ".join(filled) + " |")
    return "\n".join(lines)


def _extract_page(page: object, mode: str) -> tuple[str, int]:
    """提取一页的正文（文本 + 表格），返回 (渲染文本, 该页字符数)。"""
    parts: list[str] = []

    text = ""
    recs = ""
    try:
        if mode in ("auto", "text"):
            # 默认模式（layout=False）：按阅读顺序输出，干净可读；表格单独用 extract_tables 转
            # Markdown。多栏版面若需要版式保留，可后续加 layout 选项。
            extracted = page.extract_text()
            if extracted:
                text = extracted.rstrip()
    except Exception:  # pdfminer 个别版面会抛异常，单页容错
        text = ""

    tables: list[list[list[object | None]]] = []
    if mode in ("auto", "table"):
        try:
            tables = page.extract_tables() or []
        except Exception:
            tables = []

    # 表内文本也计入字符预算，避免大表格撑爆上下文
    table_text = "\n".join(" ".join(str(c) for c in row) for t in tables for row in t)

    if text:
        parts.append(text)
    for t in tables:
        md = _table_to_markdown(t)
        if md.strip():
            parts.append(md)

    joined = "\n\n".join(p for p in parts if p.strip())
    chars = len(text) + len(table_text)
    return joined, chars


@mcp.tool()
def pdf_extract_info(pdf_path: str) -> dict:
    """查看 PDF 基本信息（页数、是否可读），不读取正文。

    读取大 PDF 前先调用本工具拿到 total_pages，据此决定分批读取的页区间。

    Args:
        pdf_path: PDF 文件绝对路径（或相对当前工作区的路径）。
    """
    p = Path(pdf_path)
    if not p.exists():
        return {"ok": False, "error": f"文件不存在: {pdf_path}"}
    if p.suffix.lower() != ".pdf":
        return {"ok": False, "error": f"不是 PDF 文件: {pdf_path}"}
    try:
        import pdfplumber
        with pdfplumber.open(str(p)) as pdf:  # type: ignore[attr-defined]
            return {
                "ok": True,
                "pdf": str(p),
                "total_pages": len(pdf.pages),
                "max_pages_per_call": MAX_PAGES,
                "max_chars_per_call": MAX_CHARS,
            }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "pdf": str(p),
            "error": f"无法打开 PDF（可能加密或已损坏）: {e}",
        }


@mcp.tool()
def pdf_extract(
    pdf_path: str,
    page_start: int = 1,
    page_end: int | None = None,
    mode: str = "auto",
    save: bool = False,
    save_dir: str = "",
) -> dict:
    """读取 PDF 的文字与表格内容（表格转为 Markdown，保住行列结构）。

    一次调用最多解析 MAX_PAGES 页、正文最多 MAX_CHARS 字符；超出会在页边界截断并设
    truncated=true，返回本次覆盖的页区间。拿到 truncated=true 后，继续用
    pdf_extract(pdf_path, page_start=<下一页>,...) 读后续页。

    Args:
        pdf_path: PDF 文件绝对路径（或相对当前工作区的路径）。
        page_start: 起始页（1 起）。
        page_end: 结束页（含）；缺省取 start+MAX_PAGES-1。
        mode: auto=文本+表格 / text=仅文本 / table=仅表格。
        save: 是否落盘一份 Markdown 副本（默认 False，只返回给模型）。仅当用户明确要求
              保存时才传 true。
        save_dir: 落盘目录；缺省取 PDF 所在目录。
    """
    p = Path(pdf_path)
    if not p.exists():
        return {"ok": False, "error": f"文件不存在: {pdf_path}"}
    if p.suffix.lower() != ".pdf":
        return {"ok": False, "error": f"不是 PDF 文件: {pdf_path}"}
    if mode not in ("auto", "text", "table"):
        mode = "auto"

    try:
        import pdfplumber
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"pdfplumber 未安装: {e}"}

    try:
        output_parts: list[str] = []
        char_count = 0
        truncated = False
        last_page = 0
        requires_more = False

        with pdfplumber.open(str(p)) as pdf:  # type: ignore[attr-defined]
            total = len(pdf.pages)
            start = max(1, page_start)
            if start > total:
                return {
                    "ok": False,
                    "pdf": str(p),
                    "error": f"起始页 {start} 超出总页数 {total}",
                }
            end = page_end if page_end is not None else start + MAX_PAGES - 1
            end = min(total, end)
            # 无论用户传多少，硬上限一次不超过 MAX_PAGES
            end = min(end, start + MAX_PAGES - 1)

            for idx in range(start, end + 1):
                page = pdf.pages[idx - 1]
                rendered, chars = _extract_page(page, mode)
                char_count += chars
                last_page = idx

                header = f"===== 第 {idx} / {total} 页 ====="
                if rendered.strip():
                    output_parts.append(f"{header}\n{rendered}")
                else:
                    output_parts.append(f"{header}\n（本页无可提取文字/表格）")

                # 达到页数上限或正文上限，在页边界截断，提示续读
                if idx >= start + MAX_PAGES - 1 or char_count >= MAX_CHARS:
                    truncated = idx < total
                    break
            else:
                truncated = False

        content = "\n\n".join(output_parts)
        result: dict = {
            "ok": True,
            "pdf": str(p),
            "total_pages": total,
            "pages_returned": [start, last_page],
            "char_count": char_count,
            "truncated": truncated,
            "output": content,
        }
        if truncated:
            result["next_page_start"] = last_page + 1
            result["note"] = f"正文达到上限，需续读：pdf_extract(pdf_path, page_start={last_page + 1}) 读取后续页。"

        if save:
            save_path = _do_save(p, content, save_dir)
            result["saved_path"] = str(save_path)
        return result
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "pdf": str(p),
            "error": f"读取 PDF 失败（可能加密或已损坏）: {e}",
        }


def _do_save(pdf: Path, content: str, save_dir: str) -> Path:
    """把提取结果落盘一份 `<文件名>.extracted.md`。"""
    out_dir = Path(save_dir) if save_dir and Path(save_dir).is_dir() else pdf.parent
    out = out_dir / f"{pdf.stem}.extracted.md"
    out.write_text(content, encoding="utf-8")
    return out


if __name__ == "__main__":
    print(f"[pdf-extract] 启动，MAX_PAGES={MAX_PAGES} MAX_CHARS={MAX_CHARS}", file=sys.stderr)
    mcp.run()