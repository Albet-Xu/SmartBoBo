# -*- coding: utf-8 -*-
"""report_pptx —— 把 deck plan（`slide-plan.json`）渲染成**可编辑的** .pptx。

由文献汇报模式在 R4 调用：

    python <BoBo根>/scripts/report_pptx.py <汇报项目目录> [--out 03-产物/deck.pptx]

设计原则：

- **plan 是唯一真相**：脚本不做任何内容创作。页面文字、图表引用、讲稿备注全部来自
  `02-叙事/slide-plan.json`。要改页面就改 plan 再重跑，**不要直接改 pptx**——
  直接改 pptx 会让评分与产物脱钩（闸门靠 `render-manifest.json` 的哈希发现这件事）。
- **确定性**：同一份 plan 渲染出的 pptx 是同一份（不插入时间戳、不随机排序）。
  所以 plan 没变时可以跳过重渲染。
- **不假装能自动排版**：本脚本只做**估算级**的自适应——按字数与框宽估算字号并逐档下调，
  真正的几何与视觉校验由 `report_qa.py` 用渲染结果与 PowerPoint 实际布局来做。
  估算器宁可**保守**（提前缩号）也不让文字溢出。
- **中文字体要双写**：python-pptx 只写 `a:latin`，中文走 `a:ea`。只写 latin 会让渲染端
  回退到默认字体，出现方框或版式跳变。`_set_font` 同时写 latin + ea + cs。

plan schema（`bobo-report-deck/1`）见 `dsh/packages/bobo/presets/report/skills/report-slides/SKILL.md`。
本脚本对缺失字段一律给安全默认值，**不因为 plan 不完整就崩**——不完整会由 `report_qa.py` 报出来。
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Emu, Inches, Pt

SCHEMA = "bobo-report-deck/1"

#: 内置主题。`font_zh` / `font_en` 必须是**目标机器上真实存在**的字体，
#: 否则渲染端会静默回退并可能造成溢出——`report_qa.py` 会检查字体可用性。
THEMES: dict[str, dict] = {
    "academic-blue": {
        "bg": "FFFFFF", "fg": "1A1A1A", "accent": "1F4E79",
        "muted": "6E6E6E", "band": "EAF1F8", "line": "B8CCE0",
        "font_zh": "微软雅黑", "font_en": "Calibri",
    },
    "academic-gray": {
        "bg": "FFFFFF", "fg": "222222", "accent": "404040",
        "muted": "767676", "band": "F2F2F2", "line": "D0D0D0",
        "font_zh": "微软雅黑", "font_en": "Calibri",
    },
    "forest": {
        "bg": "FFFFFF", "fg": "1B2A20", "accent": "1E5F4B",
        "muted": "6B7A72", "band": "E8F1EC", "line": "BBD4C7",
        "font_zh": "微软雅黑", "font_en": "Calibri",
    },
}
DEFAULT_THEME = "academic-blue"

#: 每页正文/列表的字符预算（**机械 QA 会按这个数卡**，两边必须一致）。
#: 中文按「字」算，英文按「字符」算——同一份数值语义不同，故分列。
BUDGET = {
    "zh": {"bullets_chars": 260, "bullet_count": 6, "title_chars": 30,
           "min_font_pt": 16, "body_font_pt": 20, "notes_chars": 900},
    "en": {"bullets_chars": 520, "bullet_count": 6, "title_chars": 70,
           "min_font_pt": 14, "body_font_pt": 18, "notes_chars": 1500},
}

#: 需要「实质主张 + 证据」的页角色。封面/目录/参考文献/致谢不受此约束。
SUBSTANTIVE_ROLES = {"background", "question", "method", "data", "result",
                     "compare", "limitation", "takeaway"}

#: plan 的文本字段是**模型写的纯文本**，但模型会顺手写 Markdown 加粗。
#: 这里把 `**粗体**` 转成真正的加粗 run——如果不转，星号会被原样投影出来
#: （评分者在第 3 轮就抓到了这个：脚注里出现了可见的 `**`）。
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")


def text_segments(text: str) -> list[tuple[str, bool]]:
    """把一行文本拆成 `(片段, 是否加粗)`；落单的 `**` 会被去掉而不是留给投影。"""
    out: list[tuple[str, bool]] = []
    pos = 0
    for m in _BOLD_RE.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], False))
        out.append((m.group(1), True))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], False))
    if not out:
        out = [(text, False)]
    cleaned = [(seg.replace("**", ""), bold) for seg, bold in out]
    return [(seg, bold) for seg, bold in cleaned if seg != ""] or [("", False)]

SLIDE_W_IN = 13.333
SLIDE_H_IN = 7.5


def _lang_of(plan: dict) -> str:
    lang = str((plan.get("meta") or {}).get("language") or "zh").strip().lower()
    return "en" if lang.startswith("en") else "zh"


def _theme_of(plan: dict) -> dict:
    """解析主题：`theme.id` 选基底色板，`theme.colors` 在其上逐键覆盖。

    `id` 不认识时退回默认色板（不报错）——plan 是模型写的，不该因为拼错主题名就渲染失败，
    但机械质检会把不认识的主题名报出来（`_check_theme`）。
    """
    given = plan.get("theme") or {}
    base = str(given.get("id") or DEFAULT_THEME)
    theme = dict(THEMES.get(base) or THEMES[DEFAULT_THEME])
    for key, value in given.items():
        if key == "colors" and isinstance(value, dict):
            theme.update({k: str(v).lstrip("#").upper() for k, v in value.items()})
        elif key in ("font_zh", "font_en"):
            theme[key] = value
    return theme


def _set_font(run, theme: dict, size_pt: float, bold: bool = False, color: str | None = None):
    """给 run 设字体——**同时写 latin / ea / cs**，否则中文会走渲染端默认字体。"""
    font = run.font
    font.size = Pt(size_pt)
    font.bold = bold
    name = theme["font_en"]
    font.name = name
    try:
        font.color.rgb = RGBColor.from_string(color or theme["fg"])
    except Exception:  # noqa: BLE001 - 颜色非法时用主题前景色兜底
        font.color.rgb = RGBColor.from_string(theme["fg"])
    # east asian / complex script 需要直接写 XML（python-pptx 没有对应 API）
    rPr = run._r.get_or_add_rPr()
    from pptx.oxml.ns import qn
    for tag, typeface in (("a:ea", theme["font_zh"]), ("a:cs", theme["font_en"])):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {})
            rPr.append(el)
        el.set("typeface", str(typeface))


def _text_width_units(text: str) -> float:
    """把字符串折算成「等宽单位数」：CJK/全角记 1.0，其余记 0.55。"""
    total = 0.0
    for ch in text:
        total += 1.0 if ord(ch) > 0x2E7F else 0.55
    return total


def _wrap_lines(text: str, box_width_in: float, size_pt: float) -> int:
    """估算折行数：一行能放多少个「等宽单位」。"""
    if not text:
        return 0
    per_line = max(1.0, (box_width_in * 72.0) / max(1.0, size_pt))
    return max(1, math.ceil(_text_width_units(text) / per_line))


def _fit_size(lines: list[str], box_width_in: float, box_height_in: float,
              start_pt: float, min_pt: float, line_ratio: float = 1.34) -> float:
    """逐档下调字号直到内容高度落在框内（估算级，宁可保守）。

    返回最终字号；到下限仍放不下也会返回下限——溢出由 report_qa 报出来，而不是靠这里静默压扁。
    """
    size = start_pt
    while size > min_pt:
        need = sum(_wrap_lines(t, box_width_in, size) for t in lines)
        if need * size * line_ratio <= box_height_in * 72.0:
            return size
        size -= 1.0
    return min_pt


class DeckBuilder:
    """按 deck plan 逐页渲染。"""

    def __init__(self, plan: dict, base_dir: Path):
        self.plan = plan
        self.base = base_dir
        self.lang = _lang_of(plan)
        self.budget = BUDGET[self.lang]
        self.theme = _theme_of(plan)
        self.prs = Presentation()
        self.prs.slide_width = Inches(SLIDE_W_IN)
        self.prs.slide_height = Inches(SLIDE_H_IN)
        self.blank = self.prs.slide_layouts[6]
        self.warnings: list[str] = []

    # ── 基础绘制部件 ──────────────────────────────────────────────────
    def _slide(self):
        return self.prs.slides.add_slide(self.blank)

    def _bg(self, slide):
        bg = RGBColor.from_string(self.theme["bg"])
        fill = slide.background.fill
        fill.solid()
        fill.fore_color.rgb = bg

    def _rect(self, slide, x, y, w, h, color):
        from pptx.enum.shapes import MSO_SHAPE
        shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y),
                                       Inches(w), Inches(h))
        shape.fill.solid()
        shape.fill.fore_color.rgb = RGBColor.from_string(color)
        shape.line.fill.background()
        shape.shadow.inherit = False
        return shape

    def _textbox(self, slide, x, y, w, h):
        box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = Emu(0)
        tf.margin_top = tf.margin_bottom = Emu(0)
        return box, tf

    def _write(self, tf, lines: list[str], size_pt: float, *, bold=False,
               color=None, align=PP_ALIGN.LEFT, bullet=False, spacing_pt=None):
        """把若干行写进 text_frame（每个元素一段）。

        行内的 `**粗体**` 会转成真正的加粗 run，其余按 `bold` 参数统一处理——
        plan 是纯文本字段，但默认的 `bold` 语义（标题/强调条）优先级低于行内标记。
        """
        for i, line in enumerate(lines):
            para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            para.alignment = align
            if spacing_pt is not None:
                para.space_after = Pt(spacing_pt)
            text = f"• {line}" if bullet else line
            for seg, seg_bold in text_segments(str(text)):
                run = para.add_run()
                run.text = seg
                _set_font(run, self.theme, size_pt, bold=bold or seg_bold, color=color)

    # ── 页眉 / 页脚 ───────────────────────────────────────────────────
    def _title(self, slide, text: str):
        size = _fit_size([text], SLIDE_W_IN - 1.6, 0.9,
                         start_pt=30, min_pt=self.budget["min_font_pt"] + 4)
        box, tf = self._textbox(slide, 0.8, 0.45, SLIDE_W_IN - 1.6, 0.95)
        self._write(tf, [text or " "], size, bold=True, color=self.theme["accent"])
        self._rect(slide, 0.8, 1.44, SLIDE_W_IN - 1.6, 0.028, self.theme["line"])

    def _footer(self, slide, no: int, total: int):
        box, tf = self._textbox(slide, SLIDE_W_IN - 2.0, SLIDE_H_IN - 0.52, 1.4, 0.34)
        self._write(tf, [f"{no} / {total}"], 12, color=self.theme["muted"],
                    align=PP_ALIGN.RIGHT)

    def _key_finding(self, slide, text: str):
        """底部强调条——受配额限制（配额由 report_qa 机械校验）。"""
        y = SLIDE_H_IN - 1.62
        self._rect(slide, 0.8, y, SLIDE_W_IN - 1.6, 0.86, self.theme["band"])
        box, tf = self._textbox(slide, 1.0, y + 0.12, SLIDE_W_IN - 2.0, 0.62)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        size = _fit_size([text], SLIDE_W_IN - 2.0, 0.62, start_pt=17,
                         min_pt=self.budget["min_font_pt"])
        self._write(tf, [f"关键发现：{text}" if self.lang == "zh" else f"Key finding: {text}"],
                    size, bold=True, color=self.theme["accent"])

    # ── 各页角色 ──────────────────────────────────────────────────────
    def _render_cover(self, slide, sp):
        self._rect(slide, 0, 0, SLIDE_W_IN, 0.34, self.theme["accent"])
        self._rect(slide, 0, SLIDE_H_IN - 0.22, SLIDE_W_IN, 0.22, self.theme["band"])
        title = sp.get("title") or (self.plan.get("meta") or {}).get("title") or "文献汇报"
        sub = sp.get("subtitle") or (self.plan.get("meta") or {}).get("subtitle") or ""
        size = _fit_size([title], SLIDE_W_IN - 3.0, 2.0, start_pt=40,
                         min_pt=self.budget["min_font_pt"] + 10)
        box, tf = self._textbox(slide, 1.5, 2.25, SLIDE_W_IN - 3.0, 2.1)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        self._write(tf, [title], size, bold=True, color=self.theme["accent"],
                    align=PP_ALIGN.CENTER)
        if sub:
            box2, tf2 = self._textbox(slide, 1.5, 4.4, SLIDE_W_IN - 3.0, 0.9)
            self._write(tf2, [sub], 19, color=self.theme["muted"], align=PP_ALIGN.CENTER)
        meta = self.plan.get("meta") or {}
        foot = sp.get("notes") and "" or ""
        line = " · ".join(x for x in [meta.get("presenter") or "",
                                      meta.get("audience") or "",
                                      meta.get("date") or ""] if x)
        if line:
            box3, tf3 = self._textbox(slide, 1.5, 5.5, SLIDE_W_IN - 3.0, 0.5)
            self._write(tf3, [line], 15, color=self.theme["muted"], align=PP_ALIGN.CENTER)
        del foot

    def _render_thanks(self, slide, sp):
        text = sp.get("title") or ("谢谢，请批评指正" if self.lang == "zh" else "Thank you")
        box, tf = self._textbox(slide, 1.5, 2.8, SLIDE_W_IN - 3.0, 1.6)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        self._write(tf, [text], 36, bold=True, color=self.theme["accent"],
                    align=PP_ALIGN.CENTER)
        if sp.get("subtitle"):
            box2, tf2 = self._textbox(slide, 1.5, 4.5, SLIDE_W_IN - 3.0, 0.8)
            self._write(tf2, [sp["subtitle"]], 18, color=self.theme["muted"],
                        align=PP_ALIGN.CENTER)

    def _render_bullets(self, slide, sp, *, emphasize=None):
        self._title(slide, sp.get("title", ""))
        bullets = [str(b) for b in (sp.get("bullets") or [])]
        para = str(sp.get("paragraph") or "").strip()
        lines = ([para] if para else []) + bullets
        bottom = 1.75
        height = SLIDE_H_IN - bottom - (1.85 if sp.get("key_finding") else 0.75)
        if lines:
            width = SLIDE_W_IN - 1.6
            start = self.budget["body_font_pt"] + (2 if emphasize == "question" else 0)
            size = _fit_size(lines, width, height, start_pt=start,
                             min_pt=self.budget["min_font_pt"])
            box, tf = self._textbox(slide, 0.8, bottom, width, height)
            self._write(tf, lines, size, bullet=bool(bullets) and not para,
                        color=emphasize and self.theme["accent"] or None,
                        spacing_pt=8)
        if sp.get("key_finding"):
            self._key_finding(slide, str(sp["key_finding"]))

    def _image_ratio(self, path) -> float:
        """读图片高宽比；读不出按 3:2 估。"""
        try:
            from PIL import Image
            with Image.open(path) as im:
                return im.height / max(1, im.width)
        except Exception:  # noqa: BLE001
            return 0.667

    def _render_image(self, slide, sp):
        """图片页：**宽图上下分栏、窄图左右分栏**。

        为什么按高宽比切换：论文里的系数分布图多为横长条（高宽比约 0.34），
        若一律左右分栏，图会只有 6.5in 宽、内容看不清；改成上面文字、下面整幅图，
        图的可用宽度接近 11in，是左右分栏的 1.8 倍。
        """
        self._title(slide, sp.get("title", ""))
        img = sp.get("image") or {}
        path = self._resolve_image(img.get("path"))
        bullets = [str(b) for b in (sp.get("bullets") or [])]
        cap = str(img.get("caption") or "")
        bottom = 1.75
        has_kf = bool(sp.get("key_finding"))
        reserve = (1.85 if has_kf else 0.75)
        available = SLIDE_H_IN - bottom - reserve
        full_w = SLIDE_W_IN - 1.6

        if path is None:
            self.warnings.append(
                f"第 {sp.get('no')} 页：声明了 image 但文件不存在（{img.get('path')!r}），已退化为纯文字页")
            if bullets:
                size = _fit_size(bullets, full_w, available,
                                 start_pt=self.budget["body_font_pt"],
                                 min_pt=self.budget["min_font_pt"])
                box, tf = self._textbox(slide, 0.8, bottom, full_w, available)
                self._write(tf, bullets, size, bullet=True, spacing_pt=8)
            if has_kf:
                self._key_finding(slide, str(sp["key_finding"]))
            return

        ratio = self._image_ratio(path)
        cap_h = 0.32 if cap else 0.0

        if ratio < 0.55:
            # 宽图：文字在上、整幅图在下。子弹多于 2 条时**分两栏**——
            # 3:1 的图在 7.5in 高的页面上本来就吃不饱，文字占位直接决定图能多大。
            two_col = len(bullets) > 2
            if bullets:
                if two_col:
                    half = (len(bullets) + 1) // 2
                    groups = [bullets[:half], bullets[half:]]
                    col_w = (full_w - 0.4) / 2
                    text_h = min(1.1, available * 0.30)
                    size = _fit_size(groups[0], col_w, text_h,
                                     start_pt=self.budget["body_font_pt"] - 2,
                                     min_pt=self.budget["min_font_pt"] - 2)
                    for i, group in enumerate(groups):
                        if not group:
                            continue
                        box, tf = self._textbox(slide, 0.8 + i * (col_w + 0.4), bottom,
                                                col_w, text_h)
                        self._write(tf, group, size, bullet=True, spacing_pt=4)
                else:
                    text_h = min(1.4, available * 0.34)
                    size = _fit_size(bullets, full_w, text_h,
                                     start_pt=self.budget["body_font_pt"] - 2,
                                     min_pt=self.budget["min_font_pt"] - 2)
                    box, tf = self._textbox(slide, 0.8, bottom, full_w, text_h)
                    self._write(tf, bullets, size, bullet=True, spacing_pt=4)
            else:
                text_h = 0.0
            img_h_avail = max(0.8, available - text_h - cap_h - 0.12)
            img_w = min(full_w, img_h_avail / ratio)
            img_h = img_w * ratio
            img_top = bottom + text_h + 0.12
            slide.shapes.add_picture(str(path), Inches((SLIDE_W_IN - img_w) / 2),
                                     Inches(img_top), Inches(img_w), Inches(img_h))
            if cap:
                box2, tf2 = self._textbox(slide, 0.8, img_top + img_h + 0.04, full_w, cap_h)
                self._write(tf2, [cap], 12, color=self.theme["muted"],
                            align=PP_ALIGN.CENTER)
        else:
            # 竖图 / 方图：左文右图
            text_w = 4.5
            img_w = full_w - text_w - 0.3
            img_h = min(available, img_w * ratio)
            slide.shapes.add_picture(str(path), Inches(0.8 + text_w + 0.3),
                                     Inches(bottom), Inches(img_w), Inches(img_h))
            if cap:
                box, tf = self._textbox(slide, 0.8 + text_w + 0.3,
                                        bottom + img_h + 0.05, img_w, cap_h)
                self._write(tf, [cap], 12, color=self.theme["muted"])
            if bullets:
                size = _fit_size(bullets, text_w, available,
                                 start_pt=self.budget["body_font_pt"],
                                 min_pt=self.budget["min_font_pt"])
                box2, tf2 = self._textbox(slide, 0.8, bottom, text_w, available)
                self._write(tf2, bullets, size, bullet=True, spacing_pt=6)

        if has_kf:
            self._key_finding(slide, str(sp["key_finding"]))

    def _render_columns(self, slide, sp):
        self._title(slide, sp.get("title", ""))
        cols = list(sp.get("columns") or [])[:3]
        bottom = 1.75
        has_kf = bool(sp.get("key_finding"))
        height = SLIDE_H_IN - bottom - (1.85 if has_kf else 0.75)
        if cols:
            n = len(cols)
            gap = 0.3
            width = (SLIDE_W_IN - 1.6 - gap * (n - 1)) / n
            for i, col in enumerate(cols):
                x = 0.8 + i * (width + gap)
                self._rect(slide, x, bottom, width, 0.46, self.theme["band"])
                box, tf = self._textbox(slide, x + 0.12, bottom + 0.07, width - 0.24, 0.4)
                self._write(tf, [str(col.get("header") or "")], 16, bold=True,
                            color=self.theme["accent"])
                items = [str(b) for b in (col.get("bullets") or [])]
                if items:
                    size = _fit_size(items, width - 0.24, height - 0.6,
                                     start_pt=self.budget["body_font_pt"] - 2,
                                     min_pt=self.budget["min_font_pt"] - 2)
                    box2, tf2 = self._textbox(slide, x + 0.12, bottom + 0.6,
                                              width - 0.24, height - 0.6)
                    self._write(tf2, items, size, bullet=True, spacing_pt=6)
        if has_kf:
            self._key_finding(slide, str(sp["key_finding"]))

    def _render_table(self, slide, sp):
        self._title(slide, sp.get("title", ""))
        table = sp.get("table") or {}
        header = [str(h) for h in (table.get("header") or [])]
        rows = [[str(c) for c in row] for row in (table.get("rows") or [])]
        if not header or not rows:
            self._render_bullets(slide, sp)
            return
        ncols = len(header)
        nrows = len(rows) + 1
        top = 1.75
        has_kf = bool(sp.get("key_finding"))
        height = SLIDE_H_IN - top - (1.85 if has_kf else 0.75)
        width = SLIDE_W_IN - 1.6
        note = str(sp.get("paragraph") or "").strip()
        # 表下口径/来源脚注：表格数字脱离口径就没法解读（评分者会因此扣分），
        # 所以给表格版式一个固定的脚注位，而不是让模型把口径硬塞进标题。
        note_h = 0.55 if note else 0.0
        table_h = height - note_h
        shape = slide.shapes.add_table(nrows, ncols, Inches(0.8), Inches(top),
                                       Inches(width), Inches(table_h))
        tbl = shape.table
        # 字号：按「最长的单元格 + 行数」估算，逐档下调
        cells_text = header + [c for row in rows for c in row]
        col_w = width / ncols
        size = self.budget["body_font_pt"] - 4
        while size > 10:
            lines = sum(max(_wrap_lines(c, col_w - 0.1, size)
                            for c in ([header[i]] + [r[i] for r in rows]))
                        for i in range(ncols))
            if lines * size * 1.3 <= table_h * 72.0 - nrows * 4:
                break
            size -= 1.0
        for r in range(nrows):
            for c in range(ncols):
                cell = tbl.cell(r, c)
                cell.text = ""
                tf = cell.text_frame
                tf.word_wrap = True
                para = tf.paragraphs[0]
                raw = header[c] if r == 0 else rows[r - 1][c]
                for seg, seg_bold in text_segments(raw):
                    run = para.add_run()
                    run.text = seg
                    _set_font(run, self.theme, size, bold=(r == 0) or seg_bold,
                              color=self.theme["accent"] if r == 0 else self.theme["fg"])
                if r == 0:
                    cell.fill.solid()
                    cell.fill.fore_color.rgb = RGBColor.from_string(self.theme["band"])
        if note:
            box, tf = self._textbox(slide, 0.8, top + table_h + 0.06, width, note_h)
            self._write(tf, [note], 12, color=self.theme["muted"])
        if has_kf:
            self._key_finding(slide, str(sp["key_finding"]))

    # ── 图片路径解析 ──────────────────────────────────────────────────
    def _resolve_image(self, raw):
        if not raw:
            return None
        p = Path(str(raw))
        cands = [p] if p.is_absolute() else [self.base / p, self.base / "01-文献" / p,
                                             self.base / "02-叙事" / p]
        for c in cands:
            if c.is_file():
                return c
        return None

    # ── 主入口 ────────────────────────────────────────────────────────
    def build(self) -> Presentation:
        slides = self.plan.get("slides") or []
        total = len(slides)
        for idx, sp in enumerate(slides, start=1):
            sp = dict(sp or {})
            sp.setdefault("no", idx)
            slide = self._slide()
            self._bg(slide)
            role = str(sp.get("role") or "background").strip().lower()
            if role == "cover":
                self._render_cover(slide, sp)
            elif role == "thanks":
                self._render_thanks(slide, sp)
            elif (sp.get("table") or {}).get("rows"):
                # 表格优先于其它版式：把数据排成表是页面内容本身，不该被 role 限制
                self._render_table(slide, sp)
            elif sp.get("columns"):
                self._render_columns(slide, sp)
            elif (sp.get("image") or {}).get("path"):
                self._render_image(slide, sp)
            elif role == "question":
                self._render_bullets(slide, sp, emphasize="question")
            else:
                self._render_bullets(slide, sp)
            if role not in ("cover", "thanks"):
                self._footer(slide, int(sp.get("no") or idx), total)
            # 讲稿写进 PowerPoint 备注（组会实讲时最需要的东西）。
            # 备注是**非投影内容**：notes.md 保留 Markdown 加粗（打印出来可读），
            # 但备注面板不解析 Markdown，所以写进 pptx 时把 `**` 去掉。
            notes = str(sp.get("notes") or "").strip()
            if notes:
                slide.notes_slide.notes_text_frame.text = notes.replace("**", "")
        return self.prs


def load_plan(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"plan 格式错误：顶层必须是对象（{path}）")
    return data


def _normalize_pptx(path: Path) -> None:
    """把 pptx（本质是 zip）里所有成员的时间戳固定，使同一份 plan 渲染出**字节一致**的文件。

    为什么必须做：python-pptx 写 zip 时以当前时间作为成员时间戳（2 秒粒度），
    于是同一份 plan 隔几秒渲染两次哈希就不同。而「pptx 指纹绑定」与
    「分数不单调时交付取最高分那一版」都依赖"同一份内容 → 同一个哈希"——
    只回滚 plan 再重渲染却对不上 `render-manifest.json`，会让整套返修流程卡死。
    """
    import time
    import zipfile
    tmp = path.with_name(f"{path.name}.tmp")
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            fixed = zipfile.ZipInfo(info.filename, date_time=(1980, 1, 1, 0, 0, 0))
            fixed.compress_type = info.compress_type
            fixed.external_attr = info.external_attr
            fixed.internal_attr = info.internal_attr
            fixed.create_system = info.create_system
            dst.writestr(fixed, data)
    # PowerPoint COM 在 Quit 之后还要一小会儿才真正释放文件句柄（异步退出），
    # 紧接着重渲染就会撞上 WinError 5。重试而不是失败——这是时序问题，不是逻辑问题。
    last: Exception | None = None
    for _ in range(20):
        try:
            tmp.replace(path)
            return
        except OSError as e:  # noqa: PERF203 - 重试窗口很短，不必优化
            last = e
            time.sleep(0.25)
    try:
        tmp.unlink(missing_ok=True)
    except OSError:
        pass
    raise RuntimeError(
        f"无法替换 {path}（{last}）。通常是 PowerPoint 还占着这个文件："
        "请确认没有打开的 PowerPoint 窗口，或稍后重试。") from last


def build(project: Path, out_path: Path | None = None, plan_path: Path | None = None) -> dict:
    """渲染 deck 并落盘；返回摘要（供 CLI 与测试使用）。"""
    project = Path(project).resolve()
    plan_path = plan_path or (project / "02-叙事" / "slide-plan.json")
    if not plan_path.is_file():
        raise SystemExit(f"找不到 deck plan：{plan_path}\n"
                         "请先在 R3 写出 02-叙事/slide-plan.json。")
    plan = load_plan(plan_path)
    builder = DeckBuilder(plan, project)
    prs = builder.build()
    out_path = Path(out_path) if out_path else (project / "03-产物" / "deck.pptx")
    if not out_path.is_absolute():
        out_path = project / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out_path))
    _normalize_pptx(out_path)
    slides = plan.get("slides") or []
    notes_path = write_notes(project, plan, out_path)
    return {
        "ok": True,
        "schema": SCHEMA,
        "pptx": str(out_path),
        "notes": str(notes_path),
        "slides": len(slides),
        "language": _lang_of(plan),
        "report_type": str((plan.get("meta") or {}).get("report_type") or ""),
        "theme": str((plan.get("theme") or {}).get("id") or DEFAULT_THEME),
        "with_notes": sum(1 for s in slides if str((s or {}).get("notes") or "").strip()),
        "warnings": builder.warnings,
    }


def write_notes(project: Path, plan: dict, pptx_path: Path) -> Path:
    """把每页讲稿汇总成 `03-产物/notes.md`（供打印或对着念）。

    讲稿的**唯一真相是 plan 的 `notes` 字段**；本文件与 pptx 备注页同源，
    所以两者不可能不一致——这也是闸门禁止手写 `notes.md` 的原因。
    """
    meta = plan.get("meta") or {}
    slides = [s or {} for s in (plan.get("slides") or [])]
    lang = _lang_of(plan)
    total_sec = sum(int(s.get("time_sec") or 0) for s in slides)
    L = [
        f"# 讲稿：{meta.get('title') or '文献汇报'}",
        "",
        f"- PPT 语言：{meta.get('language') or lang}",
        f"- 汇报类型：{meta.get('report_type') or '未声明'}",
        f"- 预期时长：{meta.get('duration_min') or '未声明'} 分钟"
        + (f"（各页 time_sec 合计 {total_sec // 60} 分 {total_sec % 60} 秒）" if total_sec else ""),
        f"- 目标听众：{meta.get('audience') or '未声明'}",
        f"- 讲稿来源：`02-叙事/slide-plan.json` 的 `notes` 字段（与 {pptx_path.name} 的备注页同源）",
        "",
        "> 本文件由 `scripts/report_pptx.py` 生成，**不要手写**——改讲稿请改 plan 再重跑渲染。",
        "",
    ]
    for idx, sp in enumerate(slides, start=1):
        no = int(sp.get("no") or idx)
        role = str(sp.get("role") or "")
        title = str(sp.get("title") or "")
        sec = int(sp.get("time_sec") or 0)
        head = f"## 第 {no} 页 · {role} · {title}"
        if sec:
            head += f"（建议 {sec} 秒）"
        L += [head, ""]
        srcs = [str((c or {}).get("source") or "").strip() for c in (sp.get("claims") or [])]
        srcs = [s for s in srcs if s]
        if srcs:
            L += [f"出处：{'；'.join(srcs)}", ""]
        notes = str(sp.get("notes") or "").strip()
        L += [notes if notes else "**（本页缺讲稿）**", ""]
    out = project / "03-产物" / "notes.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(L), encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="把 deck plan 渲染成可编辑 .pptx")
    parser.add_argument("project", help="汇报项目目录（含 02-叙事/slide-plan.json）")
    parser.add_argument("--out", default=None, help="输出 pptx 路径（默认 03-产物/deck.pptx）")
    parser.add_argument("--plan", default=None, help="plan 路径（默认 02-叙事/slide-plan.json）")
    parser.add_argument("--stdout", action="store_true", help="摘要打到 stdout（默认也是）")
    args = parser.parse_args(argv)
    try:
        summary = build(Path(args.project),
                        Path(args.out) if args.out else None,
                        Path(args.plan) if args.plan else None)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"渲染失败: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
