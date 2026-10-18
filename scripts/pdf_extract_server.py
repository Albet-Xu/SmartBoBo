# -*- coding: utf-8 -*-
"""pdf-extract —— 本地 MCP server，为 BoBo 提供「读取 PDF」工具。

模型可见工具（serverName=pdf-extract → mcp__pdf-extract__pdf_extract_*）：
- pdf_extract_info(pdf_path)  —— 查看 PDF 页数 / 是否可读（不读正文，模型可先探页数再分批读）
- pdf_extract(pdf_path, page_start, page_end, mode, save, save_dir, detail)
                               —— 提取文字 + 表格（表格转 Markdown），保住版式里的文本信息与表格结构

文字版（无 OCR）：只能提取「可选文字层」的 PDF；扫描件 / 纯图片 PDF 需要 OCR（后续再加）。
分批策略：单次最多解析 max_pages 页（默认 20），且产出正文最多 max_chars 字符（默认 40000），
先到先止，返回「本次覆盖的页区间」；**单页还有一个字符硬上限**（默认 12000），极端版面
（整本被识别成一页之类）不会靠"先到先止"漏网，截断的页号在 `pages_truncated` 里如实给出。
模型拿到 `truncated=true` 后可续调 pdf_extract 读后续页。
落盘：默认不落盘（只返回给模型）；仅当模型按用户要求把 save=true 传入时才在 save_dir（缺省取
PDF 所在目录）写一份 `<文件名>.extracted.md`。与 persona 规则一致：用户没让落盘就不落盘。

**上下文纪律（detail）**：`detail="auto"`（默认）在 `save=True` 时返回**摘要**（字符数、页区间、
小标题清单、开头一段 + 落盘路径）——正文已经在磁盘上了，再整篇回灌上下文纯属浪费；`save=False`
时返回全文（旧行为，没有磁盘副本就不能只给摘要）。`detail="full"` / `"digest"` 可强制。

用法（源码/打包版一致，MCP 子进程由 dsh 清洗 env，关键覆盖变量由预设显式回传）：
    .venv/Scripts/python.exe scripts/pdf_extract_server.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

sys.path.insert(0, str(Path(__file__).resolve().parent))
import result_digest  # noqa: E402

# ── 分批上限（可用环境变量覆盖；打包版如需调整在 MCP 预设 env 里改） ─────────
MAX_PAGES = int(os.environ.get("PDF_EXTRACT_MAX_PAGES", "20"))
MAX_CHARS = int(os.environ.get("PDF_EXTRACT_MAX_CHARS", "40000"))
# 单页文本超过该字符数时截断该页正文（极端版面防护，不影响后续页）
_PAGE_CHAR_HARD_CAP = int(os.environ.get("PDF_EXTRACT_PAGE_CHAR_CAP", "12000"))
_PAGE_CAP_MARK = "…（本页正文超过单页字符上限，已截断）"

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


def _extract_page(page: object, mode: str) -> tuple[str, int, bool]:
    """提取一页的正文（文本 + 表格），返回 (渲染文本, 实际返回字符数, 是否被单页上限截断)。"""
    parts: list[str] = []

    text = ""
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

    if text:
        parts.append(text)
    for t in tables:
        md = _table_to_markdown(t)
        if md.strip():
            parts.append(md)

    joined = "\n\n".join(p for p in parts if p.strip())
    # 单页硬上限：外层「先到先止」只在页边界停，一页本身就超过 MAX_CHARS 时挡不住
    # （整本扫描件被识别成一页、超长表格等）。超了就裁到上限，并把该页号回报上去。
    page_truncated = len(joined) > _PAGE_CHAR_HARD_CAP
    if page_truncated:
        joined = joined[:_PAGE_CHAR_HARD_CAP].rstrip() + "\n\n" + _PAGE_CAP_MARK
    # 字符预算按**实际返回**的正文算（含表格 Markdown 与截断标记），与"这一页进上下文多少"对齐
    return joined, len(joined), page_truncated


def _resolve_detail(detail: str, save: bool) -> str:
    """把 `detail` 收敛成 "full" / "digest"。

    `auto`：`save=True` 时正文已经写在磁盘上，再整篇回灌上下文纯属浪费 → digest；
    `save=False` 时没有磁盘副本，只给摘要就是丢数据 → full（旧行为）。
    """
    choice = str(detail or "auto").strip().lower()
    if choice in ("full", "digest"):
        return choice
    return "digest" if save else "full"


@mcp.tool()
def pdf_extract_info(pdf_path: str) -> dict:
    """查看 PDF 基本信息（页数、是否可读），不读取正文。

    读取大 PDF 前先调用本工具拿到 total_pages，据此决定分批读取的页区间（一次最多
    max_pages_per_call 页、正文最多 max_chars_per_call 字符、单页最多 page_char_cap 字符）。

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
                "page_char_cap": _PAGE_CHAR_HARD_CAP,
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
    detail: str = "auto",
) -> dict:
    """读取 PDF 的文字与表格内容（表格转为 Markdown，保住行列结构）。

    一次调用最多解析 MAX_PAGES 页、正文最多 MAX_CHARS 字符、单页最多 `_PAGE_CHAR_HARD_CAP`
    字符；超出会在页边界截断并设 truncated=true，返回本次覆盖的页区间与被截断的页号。
    拿到 truncated=true 后，继续用 pdf_extract(pdf_path, page_start=<下一页>,...) 读后续页。

    **别把整篇正文拉回上下文**：用户要求落盘（save=true）时，正文已经在磁盘上，本工具默认
    只回摘要（字符数、页区间、小标题清单、开头一段 + saved_path）；要看某一页就读/grep 那个
    文件里的 `===== 第 N / 总页数 页 =====` 标记。save=false 时没有磁盘副本，照旧回全文。

    Args:
        pdf_path: PDF 文件绝对路径（或相对当前工作区的路径）。
        page_start: 起始页（1 起）。
        page_end: 结束页（含）；缺省取 start+MAX_PAGES-1。
        mode: auto=文本+表格 / text=仅文本 / table=仅表格。
        save: 是否落盘一份 Markdown 副本（默认 False，只返回给模型）。仅当用户明确要求
              保存时才传 true。
        save_dir: 落盘目录；缺省取 PDF 所在目录。
        detail: auto（默认，save=true 时回摘要、save=false 时回全文）/ full（一定回全文）/
                digest（一定回摘要）。强制 digest 且 save=false 时正文既没落盘也没内联，
                返回的 note 会点明这一点。
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
        page_truncated: list[int] = []

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
                rendered, chars, page_capped = _extract_page(page, mode)
                char_count += chars
                last_page = idx
                if page_capped:
                    page_truncated.append(idx)

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
        }
        notes: list[str] = []
        if truncated:
            result["next_page_start"] = last_page + 1
            notes.append(f"正文达到上限，需续读：pdf_extract(pdf_path, page_start={last_page + 1}) 读取后续页。")
        if page_truncated:
            pages = "、".join(str(idx) for idx in page_truncated)
            result["pages_truncated"] = page_truncated
            notes.append(f"第 {pages} 页正文超过单页上限 {_PAGE_CHAR_HARD_CAP} 字符，该页已截断"
                         "（其余页不受影响）。")

        detail_mode = _resolve_detail(detail, save)
        saved_path = ""
        if save:
            try:
                saved_path = str(_do_save(p, content, save_dir))
                result["saved_path"] = saved_path
            except Exception as error:  # noqa: BLE001 — 落盘失败只降级，不能让一次成功的读取变成报错
                # 但没有磁盘副本就不能只给摘要，故降级为全文
                notes.append(f"落盘失败（{type(error).__name__}: {error}）；本次按未落盘处理，返回全文。")
                detail_mode = "full"

        if detail_mode == "digest":
            brief = result_digest.digest_text(content)
            result["headings"] = brief["headings"]
            result["head"] = brief["head"]
            if saved_path:
                notes.append(f"正文已落盘：{saved_path}——要看某一页就读/grep 该文件里的"
                             f"`===== 第 N / {total} 页 =====` 标记，不要把整篇正文拉回上下文。")
            else:
                notes.append('detail="digest" 且 save=false：本次正文既没内联也没落盘；'
                             '需要正文请改 detail="full" 或 save=true 重取。')
        else:
            result["output"] = content

        if notes:
            result["note"] = " ".join(notes)
        return result
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "pdf": str(p),
            "error": f"读取 PDF 失败（可能加密或已损坏）: {e}",
        }


def _do_save(pdf: Path, content: str, save_dir: str) -> Path:
    """把提取结果落盘一份 `<文件名>.extracted.md`；写失败由调用方降级（本函数会抛）。"""
    out_dir = Path(save_dir) if save_dir and Path(save_dir).is_dir() else pdf.parent
    out = out_dir / f"{pdf.stem}.extracted.md"
    out.write_text(content, encoding="utf-8")
    return out


if __name__ == "__main__":
    print(f"[pdf-extract] 启动，MAX_PAGES={MAX_PAGES} MAX_CHARS={MAX_CHARS} "
          f"PAGE_CHAR_CAP={_PAGE_CHAR_HARD_CAP}", file=sys.stderr)
    mcp.run()