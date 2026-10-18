# -*- coding: utf-8 -*-
"""report_qa —— 文献汇报 PPT 的**机械质检 + 渲染 + 指纹**三合一。

由文献汇报模式在 R5 调用：

    python <BoBo根>/scripts/report_qa.py <汇报项目目录> [--dpi 150] [--no-render]

产物（三个文件必须由本脚本产出，**闸门会拦住手写**）：

| 文件 | 内容 |
| --- | --- |
| `03-产物/preview/slide-NN.png` | 每页渲染图——**评分者只看得到这个，看不到 pptx** |
| `04-评审/qa-report.json` | 机械违规清单（按 high/medium/low 分级，每条带页码与实测值） |
| `04-评审/render-manifest.json` | pptx 与每张预览图的 sha256 + 渲染参数（**指纹绑定**） |

为什么要机械质检：**模型自评会通胀**。把"文字超不超过预算""元素越不越界""关键数字有没有
证据"这类可机械判定的事交给脚本，评分者才只剩真正需要判断的部分（叙事、取舍、视觉说服力）。

为什么要指纹：评分依据是**渲染图**，而交付物是 **pptx**。两者一旦脱钩（改完 pptx 不重渲染、
或用旧评分过关），整套评分就失效了。`render-manifest.json` 记录渲染时刻的 pptx 哈希；
`.pptx` 之后被任何方式改写，哈希就对不上，闸门会拒绝放行。

渲染走 **PowerPoint COM**（Windows 原生桌面最高保真）。COM 不可用时**不假装成功**：
`rendered=false` 会升级为 high 违规，闸门据此拒绝进入 R6——宁可报错也不给"没渲染就评分"留口子。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import winreg
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "bobo-report-qa/1"
MANIFEST_SCHEMA = "bobo-report-render/1"

#: 与 report_pptx.py 的 BUDGET **必须一致**（同一份数值语义）。
BUDGET = {
    "zh": {"bullets_chars": 260, "bullet_count": 6, "title_chars": 30,
           "min_font_pt": 16, "body_font_pt": 20, "notes_chars": 900},
    "en": {"bullets_chars": 520, "bullet_count": 6, "title_chars": 70,
           "min_font_pt": 14, "body_font_pt": 18, "notes_chars": 1500},
}
SUBSTANTIVE_ROLES = {"background", "question", "method", "data", "result",
                     "compare", "limitation", "takeaway"}
NO_KEY_FINDING_ROLES = {"cover", "outline", "reference", "thanks"}
EMU_PER_INCH = 914400
PIXEL_TOLERANCE = 2          # 与画面边缘"贴边"的判定像素容差
#: 页码这类装饰性小字不参与字号下限判定（它们是版式元素，不是阅读内容）。
DECORATIVE_TEXT = re.compile(r"^\s*\d+\s*/\s*\d+\s*$")

#: 中文字体名 → 注册表里的英文名。只收「中文名与英文名不成字面包含关系」的常见字体。
FONT_ALIASES: dict[str, tuple[str, ...]] = {
    "微软雅黑": ("microsoft yahei",),
    "宋体": ("simsun",),
    "新宋体": ("nsimsun",),
    "黑体": ("simhei",),
    "楷体": ("kaiti", "simkai"),
    "仿宋": ("fangsong", "simfang"),
    "等线": ("dengxian",),
    "隶书": ("lisu",),
    "幼圆": ("youyuan",),
    "思源黑体": ("source han sans", "noto sans cjk"),
    "思源宋体": ("source han serif", "noto serif cjk"),
    "文泉驿微米黑": ("wenquanyi micro hei",),
    "方正黑体": ("fzhei",),
    "华文中宋": ("stzhongsong",),
    "华文楷体": ("stkaiti",),
    "苹方": ("pingfang",),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _lang_of(plan: dict) -> str:
    lang = str((plan.get("meta") or {}).get("language") or "zh").strip().lower()
    return "en" if lang.startswith("en") else "zh"


# ---------------------------------------------------------------------------
# 违规记账
# ---------------------------------------------------------------------------


class Report:
    """违规清单。每条带 `severity` / `slide` / `rule` / `detail`。"""

    def __init__(self) -> None:
        self.violations: list[dict] = []

    def add(self, severity: str, rule: str, detail: str, slide: int | None = None):
        self.violations.append({"severity": severity, "rule": rule,
                                "detail": detail, "slide": slide})

    def counts(self) -> dict:
        out = {"high": 0, "medium": 0, "low": 0}
        for v in self.violations:
            out[v["severity"]] = out.get(v["severity"], 0) + 1
        return out

    @property
    def ok(self) -> bool:
        return self.counts()["high"] == 0


# ---------------------------------------------------------------------------
# 系统字体探测（防"plan 里写了机器上没有的字体 → 渲染回退 → 版式跳变"）
# ---------------------------------------------------------------------------


def installed_fonts() -> set[str]:
    """从注册表读已安装字体名（小写）。读不到时返回空集合（调用方跳过该检查）。"""
    names: set[str] = set()
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                             r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts")
        count = winreg.QueryInfoKey(key)[1]
        for i in range(count):
            value_name, _, _ = winreg.EnumValue(key, i)
            # 注册表值名形如 "Microsoft YaHei & Microsoft YaHei UI (TrueType)" 或 "微软雅黑 (TrueType)"
            clean = value_name.split("(")[0].strip()
            for part in clean.split("&"):
                part = part.strip().lower()
                if part:
                    names.add(part)
            names.add(clean.lower())
    except Exception:  # noqa: BLE001
        return set()
    return names


def font_available(name: str, fonts: set[str]) -> bool:
    """字体是否可用。

    Windows 注册表里的字体**用英文名登记**（"Microsoft YaHei & Microsoft YaHei UI (TrueType)"），
    而 plan 里写的常是中文名（"微软雅黑"）。所以要按别名表把中文名折成英文名再查，
    否则每个用中文名的 plan 都会被误报 `font_missing`——误报比漏报更有害，
    它会让使用者学会无视这条检查。
    """
    if not fonts or not name:
        return True                      # 探测不到就不误报
    low = str(name).strip().lower()
    probes = {low}
    for alias in FONT_ALIASES.get(low, ()):
        probes.add(alias.lower())
    return any(any(p == f or p in f for f in fonts) for p in probes)


# ---------------------------------------------------------------------------
# plan 级检查
# ---------------------------------------------------------------------------


def check_plan(project: Path, plan: dict, rep: Report) -> None:
    lang = _lang_of(plan)
    budget = BUDGET[lang]
    slides = plan.get("slides") or []
    if not slides:
        rep.add("high", "no_slides", "slide-plan.json 里没有任何 slides")
        return

    # 证据层
    evidence_ids: set[str] = set()
    ev_path = project / "evidence.jsonl"
    if ev_path.is_file():
        for line in ev_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:  # noqa: BLE001
                rep.add("medium", "evidence_unparsable", "evidence.jsonl 有一行不是合法 JSON")
                continue
            if rec.get("id"):
                evidence_ids.add(str(rec["id"]))
    else:
        rep.add("high", "no_evidence", "缺少 evidence.jsonl——没有证据层，每个关键数字都无从追溯")

    n = len(slides)
    roles = [str((s or {}).get("role") or "") for s in slides]
    kf_quota = max(1, n // 3)
    kf_used = 0

    for idx, sp in enumerate(slides, start=1):
        sp = sp or {}
        no = int(sp.get("no") or idx)
        role = str(sp.get("role") or "").strip().lower()
        if not role:
            rep.add("medium", "missing_role", "缺 role 字段（无法确定版式）", no)
        title = str(sp.get("title") or "")
        if not title.strip():
            rep.add("medium", "missing_title", "该页没有标题", no)
        elif len(title) > budget["title_chars"]:
            rep.add("low", "title_too_long",
                    f"标题 {len(title)} 字 > 上限 {budget['title_chars']} 字", no)

        bullets = [str(b) for b in (sp.get("bullets") or [])]
        para = str(sp.get("paragraph") or "")
        body_len = sum(len(b) for b in bullets) + len(para)
        if body_len > budget["bullets_chars"]:
            rep.add("medium", "char_budget",
                    f"正文合计 {body_len} 字 > 上限 {budget['bullets_chars']} 字"
                    f"（{lang} 预算），请拆页或删减", no)
        if len(bullets) > budget["bullet_count"]:
            rep.add("medium", "bullet_count",
                    f"列表 {len(bullets)} 条 > 上限 {budget['bullet_count']} 条", no)

        # 讲稿：组会实讲时最需要的东西
        notes = str(sp.get("notes") or "").strip()
        if not notes:
            rep.add("high", "missing_notes",
                    "缺讲稿备注（notes）——交付物必须包含每页口播内容", no)
        elif len(notes) > budget["notes_chars"]:
            rep.add("low", "notes_too_long",
                    f"讲稿 {len(notes)} 字 > 建议上限 {budget['notes_chars']} 字", no)

        # 证据链：实质页必须能指回论文原文
        if role in SUBSTANTIVE_ROLES:
            claims = list(sp.get("claims") or [])
            if not claims:
                rep.add("high", "no_claims",
                        f"实质页（role={role}）没有任何 claims——"
                        "页面主张必须能追到论文原文的具体位置", no)
            for ci, claim in enumerate(claims, start=1):
                claim = claim or {}
                if not str(claim.get("claim") or "").strip():
                    rep.add("high", "claim_empty", f"第 {ci} 条 claim 没有 claim 文本", no)
                if not str(claim.get("source") or "").strip():
                    rep.add("high", "claim_no_source",
                            f"第 {ci} 条 claim 没有 source（必须给论文页码/图表编号），"
                            "没有出处的主张等于编的", no)
                eid = str(claim.get("evidence_id") or "").strip()
                if not eid:
                    rep.add("high", "claim_no_evidence",
                            f"第 {ci} 条 claim 没有 evidence_id", no)
                elif evidence_ids and eid not in evidence_ids:
                    rep.add("high", "evidence_not_found",
                            f"第 {ci} 条 claim 的 evidence_id={eid!r} 在 evidence.jsonl 里不存在", no)

        # 底部强调条配额
        if sp.get("key_finding"):
            kf_used += 1
            if role in NO_KEY_FINDING_ROLES:
                rep.add("medium", "key_finding_role",
                        f"role={role} 的页面不应使用底部强调条", no)

        # 对比页必须有真内容
        if role == "compare":
            has_table = bool((sp.get("table") or {}).get("rows"))
            has_cols = bool(sp.get("columns"))
            if not (has_table or has_cols):
                rep.add("high", "compare_empty",
                        "compare 页既没有 table 也没有 columns——对比矩阵是空的", no)

    if kf_used > kf_quota:
        rep.add("medium", "key_finding_quota",
                f"底部强调条共 {kf_used} 处 > 配额 {kf_quota} 处"
                f"（max(1, 页数//3)），隔页滥用会让强调失效")

    # 汇报类型专属要求
    rtype = str((plan.get("meta") or {}).get("report_type") or "").strip().lower()
    if rtype == "multi":
        if "compare" not in roles:
            rep.add("high", "multi_no_matrix",
                    "多篇汇报必须有一页对比矩阵（role=compare，含 table 或 columns）")
        if "takeaway" not in roles:
            rep.add("high", "multi_no_takeaway",
                    "多篇汇报必须有一页共同结论/分歧点（role=takeaway）——"
                    "逐篇罗列不是汇报，读者要的是综合判断")
    if rtype in ("multi", "survey") and "reference" not in roles:
        rep.add("low", "no_reference_slide",
                "缺少 reference 页（列出本次汇报的所有源论文及其页码定位）")

    # 时长/页数匹配（组会汇报最常见的事故是超时）
    minutes = (plan.get("meta") or {}).get("duration_min")
    try:
        minutes = float(minutes) if minutes else 0.0
    except (TypeError, ValueError):
        minutes = 0.0
    if minutes > 0:
        per_slide = minutes / max(1, n)
        if per_slide < 0.35:
            rep.add("medium", "pacing_fast",
                    f"{n} 页 / {minutes:g} 分钟 = 每页 {per_slide:.2f} 分钟，讲不完；请减页或加时")
        elif per_slide > 1.6:
            rep.add("low", "pacing_slow",
                    f"{n} 页 / {minutes:g} 分钟 = 每页 {per_slide:.2f} 分钟，偏空；可加内容")


# ---------------------------------------------------------------------------
# pptx 级检查
# ---------------------------------------------------------------------------


def check_pptx(pptx_path: Path, plan: dict, rep: Report) -> dict:
    """几何与字号检查；返回统计信息。"""
    from pptx import Presentation
    from pptx.util import Emu

    lang = _lang_of(plan)
    budget = BUDGET[lang]
    fonts = installed_fonts()

    prs = Presentation(str(pptx_path))
    slide_w = prs.slide_width
    slide_h = prs.slide_height
    stats = {"shapes": 0, "runs": 0, "min_font_pt": None,
             "slides": len(prs.slides._sldIdLst)}  # noqa: SLF001 - python-pptx 没有公开的页数接口

    # 主题字体与主题名可用性
    theme = plan.get("theme") or {}
    known = {"academic-blue", "academic-gray", "forest"}
    tid = str(theme.get("id") or "").strip()
    if tid and tid not in known:
        rep.add("low", "unknown_theme",
                f"theme.id={tid!r} 不在内置主题里（{'/'.join(sorted(known))}），已退回默认色板；"
                "要自定义配色请显式写 theme.colors")
    for key in ("font_zh", "font_en"):
        name = theme.get(key)
        if name and not font_available(str(name), fonts):
            rep.add("high", "font_missing",
                    f"字体 {name!r}（{key}）在本机未安装——渲染端会静默回退，"
                    "中文字形与版式都会跳变。请改用本机已装的字体。")

    tol = Emu(int(0.02 * EMU_PER_INCH))
    for idx, slide in enumerate(prs.slides, start=1):
        for shape in slide.shapes:
            stats["shapes"] += 1
            try:
                left, top = shape.left, shape.top
                width, height = shape.width, shape.height
            except Exception:  # noqa: BLE001
                continue
            if None in (left, top, width, height):
                continue
            if left < -tol or top < -tol:
                rep.add("high", "shape_out_of_bounds",
                        f"形状越出页面左上边界（left={left/EMU_PER_INCH:.2f}in, "
                        f"top={top/EMU_PER_INCH:.2f}in）", idx)
            if left + width > slide_w + tol or top + height > slide_h + tol:
                rep.add("high", "shape_out_of_bounds",
                        f"形状越出页面右下边界（right={(left+width)/EMU_PER_INCH:.2f}in, "
                        f"bottom={(top+height)/EMU_PER_INCH:.2f}in，"
                        f"页面 {slide_w/EMU_PER_INCH:.2f}×{slide_h/EMU_PER_INCH:.2f}in）", idx)

            tf = getattr(shape, "text_frame", None)
            if tf is None:
                continue
            for para in tf.paragraphs:
                for run in para.runs:
                    size = run.font.size
                    if size is None:
                        continue
                    pt = float(size.pt)
                    stats["runs"] += 1
                    stats["min_font_pt"] = pt if stats["min_font_pt"] is None \
                        else min(stats["min_font_pt"], pt)
                    if DECORATIVE_TEXT.match(run.text or ""):
                        continue                       # 页码不判下限
                    if "**" in (run.text or ""):
                        rep.add("medium", "markdown_leaked",
                                f"文字里出现了未解析的 Markdown 标记 `**`：{run.text[:40]!r}——"
                                "plan 的文本字段是纯文本，`**` 会原样投影到页面上", idx)
                    floor = budget["min_font_pt"] - 4      # 容忍表格/图注等小字
                    if pt < floor:
                        rep.add("medium", "font_too_small",
                                f"字号 {pt:g}pt < 下限 {floor:g}pt：{run.text[:24]!r}", idx)

        # 讲稿是否真的写进了备注
        if slide.has_notes_slide:
            note = (slide.notes_slide.notes_text_frame.text or "").strip()
            if not note:
                rep.add("low", "empty_notes", "备注页存在但内容为空", idx)

    return {"slide_width_in": round(slide_w / EMU_PER_INCH, 3),
            "slide_height_in": round(slide_h / EMU_PER_INCH, 3),
            **stats}


# ---------------------------------------------------------------------------
# 渲染（PowerPoint COM）
# ---------------------------------------------------------------------------


def render_powerpoint(pptx_path: Path, out_dir: Path, dpi: int) -> tuple[bool, str, list[Path]]:
    """用 PowerPoint COM 把每页导出为 PNG。返回 (成功, 错误信息, 文件列表)。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        import win32com.client  # noqa: PLC0415
    except Exception as e:  # noqa: BLE001
        return False, f"pywin32 不可用（{e}），无法用 PowerPoint 渲染", []

    from pptx import Presentation
    prs = Presentation(str(pptx_path))
    width_px = int(prs.slide_width / EMU_PER_INCH * dpi)
    height_px = int(prs.slide_height / EMU_PER_INCH * dpi)
    n_slides = len(prs.slides._sldIdLst)

    app = None
    pres = None
    produced: list[Path] = []
    try:
        # DispatchEx：新建独立实例，避免把用户正在开的 PowerPoint 一起 Quit 掉
        app = win32com.client.DispatchEx("PowerPoint.Application")
        # 本机实测：PowerPoint 的无窗口模式（WithWindow=False）打不开含图片的
        # pptx（报 "PowerPoint could not open the file"，纯文字文件正常），
        # 带窗口打开则正常导出。渲染仍走 PowerPoint COM，不绕过渲染。
        pres = app.Presentations.Open(str(pptx_path), ReadOnly=True,
                                      Untitled=False, WithWindow=True)
        try:
            pres.Window.Visible = False  # 打开成功后隐藏窗口，保持无干扰
        except Exception:  # noqa: BLE001
            pass
        for i in range(1, n_slides + 1):
            target = out_dir / f"slide-{i:02d}.png"
            pres.Slides(i).Export(str(target), "PNG", width_px, height_px)
            if not target.is_file() or target.stat().st_size == 0:
                return False, f"第 {i} 页导出后文件缺失或为空：{target}", produced
            produced.append(target)
    except Exception as e:  # noqa: BLE001
        return False, f"PowerPoint 渲染失败：{type(e).__name__}: {e}", produced
    finally:
        for obj in (pres, app):
            if obj is None:
                continue
            try:
                obj.Close() if obj is pres else obj.Quit()
            except Exception:  # noqa: BLE001
                pass
    # Quit 是异步的：进程还没退干净时文件句柄仍在，紧接着重渲染会撞上 WinError 5。
    # 这里等一个短窗口，让 PowerPoint 真正释放 deck.pptx。
    time.sleep(1.0)

    return True, "", produced


def check_pixels(pngs: list[Path], plan: dict, rep: Report) -> list[dict]:
    """从**渲染结果**上做像素级检查：贴边（可能被裁切）与低对比。

    这是"看渲染图"的第一层——真正需要判断的部分（叙事、说服力）留给评分者。
    """
    try:
        from PIL import Image
    except Exception as e:  # noqa: BLE001
        rep.add("low", "pixel_checks_skipped", f"Pillow 不可用，跳过像素检查：{e}")
        return []

    slides = plan.get("slides") or []
    out: list[dict] = []
    for i, png in enumerate(pngs, start=1):
        role = ""
        if i - 1 < len(slides):
            role = str((slides[i - 1] or {}).get("role") or "").lower()
        try:
            with Image.open(png) as im:
                rgb = im.convert("RGB")
                w, h = rgb.size
                px = rgb.load()
                # 背景取四角众数（画面四周一定是底色）
                from collections import Counter
                corners = Counter()
                for (cx, cy) in [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]:
                    corners[px[cx, cy]] += 1
                bg = corners.most_common(1)[0][0]

                def is_ink(c) -> bool:
                    return abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) > 60

                # 逐行扫墨迹边界（每 2 像素采样，足够快）
                min_x, min_y, max_x, max_y = w, h, -1, -1
                for y in range(0, h, 2):
                    for x in range(0, w, 2):
                        if is_ink(px[x, y]):
                            if x < min_x:
                                min_x = x
                            if x > max_x:
                                max_x = x
                            if y < min_y:
                                min_y = y
                            if y > max_y:
                                max_y = y
                if max_x < 0:
                    out.append({"no": i, "ink": None})
                    rep.add("low", "blank_slide", "该页渲染后几乎是空白", i)
                    continue
                margins = {"left": min_x, "right": w - 1 - max_x,
                           "top": min_y, "bottom": h - 1 - max_y}
                out.append({"no": i, "width_px": w, "height_px": h, "ink": margins})
                # 封面/致谢有意使用满幅色带，不判贴边
                if role not in ("cover", "thanks"):
                    for side in ("left", "right", "bottom"):
                        if margins[side] <= PIXEL_TOLERANCE:
                            rep.add("medium", "content_touches_edge",
                                    f"渲染后内容贴到{ {'left':'左','right':'右','bottom':'下'}[side] }边缘"
                                    f"（{margins[side]}px）——可能被裁切或溢出，请缩字或拆页", i)
        except Exception as e:  # noqa: BLE001
            rep.add("low", "pixel_check_failed", f"第 {i} 页像素检查失败：{e}", i)
    return out


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def run(project: Path, dpi: int = 150, do_render: bool = True) -> dict:
    project = Path(project).resolve()
    plan_path = project / "02-叙事" / "slide-plan.json"
    pptx_path = project / "03-产物" / "deck.pptx"
    if not plan_path.is_file():
        raise SystemExit(f"找不到 deck plan：{plan_path}")
    if not pptx_path.is_file():
        raise SystemExit(f"找不到 deck.pptx：{pptx_path}\n请先跑 report_pptx.py。")

    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    rep = Report()

    check_plan(project, plan, rep)
    geometry = check_pptx(pptx_path, plan, rep)

    sha_before = sha256_file(pptx_path)
    preview_dir = project / "03-产物" / "preview"
    rendered = False
    render_error = ""
    pngs: list[Path] = []
    if do_render:
        n_plan = len(plan.get("slides") or [])
        rendered, render_error, pngs = render_powerpoint(pptx_path, preview_dir, dpi)
        if not rendered:
            rep.add("high", "render_failed",
                    f"渲染失败：{render_error}。"
                    "**没有渲染图就不许评分**——评分者必须看到页面实际长什么样。")
        elif len(pngs) != n_plan:
            rep.add("high", "render_count_mismatch",
                    f"plan 有 {n_plan} 页，渲染出 {len(pngs)} 页——产物与 plan 不一致")
    else:
        rep.add("high", "render_skipped",
                "未渲染（--no-render）：评分所需的分页图片不存在，不能进入评分环节")

    pixel_info = check_pixels(pngs, plan, rep) if pngs else []
    sha_after = sha256_file(pptx_path)
    if sha_before != sha_after:
        rep.add("high", "pptx_changed_during_qa",
                "pptx 在质检过程中被改写——本次质检结果作废，请重跑")

    previews = []
    for p in pngs:
        if p.is_file():
            previews.append({"no": int(p.stem.split("-")[-1]), "png": str(p),
                             "sha256": sha256_file(p), "bytes": p.stat().st_size})

    manifest = {
        "schema": MANIFEST_SCHEMA,
        "project": str(project),
        "pptx": str(pptx_path),
        "pptx_sha256": sha_after,
        "pptx_bytes": pptx_path.stat().st_size,
        "slides": len(plan.get("slides") or []),
        "rendered_slides": len(previews),
        "dpi": dpi,
        "renderer": "powerpoint-com" if rendered else "none",
        "rendered_at": now_iso(),
        "slide_size": {"width_in": geometry.get("slide_width_in"),
                       "height_in": geometry.get("slide_height_in")},
        "previews": previews,
        "note": ("评分者只能基于本清单里的 previews 与 pptx_sha256 评分；"
                 "pptx 被改写后本清单失效，必须重跑 report_qa.py。"),
    }
    (project / "04-评审").mkdir(parents=True, exist_ok=True)
    (project / "04-评审" / "render-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    counts = rep.counts()
    report = {
        "schema": SCHEMA,
        "ok": rep.ok,
        "project": str(project),
        "pptx": str(pptx_path),
        "pptx_sha256": sha_after,
        "language": _lang_of(plan),
        "report_type": str((plan.get("meta") or {}).get("report_type") or ""),
        "slides": len(plan.get("slides") or []),
        "rendered": rendered,
        "render_error": render_error,
        "preview_dir": str(preview_dir),
        "geometry": geometry,
        "pixel_info": pixel_info,
        "counts": counts,
        "violations": rep.violations,
        "generated_at": now_iso(),
        "next": ("机械检查通过，可进入评分环节（评分者读 previews 与 pptx_sha256）。"
                 if rep.ok else
                 "存在 high 违规：请先按 violations 逐条修 plan 并重跑 report_pptx.py + report_qa.py，"
                 "不要直接改 pptx。"),
    }
    (project / "04-评审" / "qa-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="文献汇报 PPT 机械质检 + 渲染 + 指纹")
    parser.add_argument("project", help="汇报项目目录")
    parser.add_argument("--dpi", type=int, default=150, help="渲染 DPI（默认 150）")
    parser.add_argument("--no-render", action="store_true", help="跳过渲染（仅排障用）")
    parser.add_argument("--quiet", action="store_true", help="只回一行结论")
    args = parser.parse_args(argv)
    try:
        report = run(Path(args.project), dpi=max(72, int(args.dpi)),
                     do_render=not args.no_render)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"质检失败: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    if args.quiet:
        c = report["counts"]
        print(f"{'PASS' if report['ok'] else 'FAIL'} "
              f"high={c['high']} medium={c['medium']} low={c['low']} "
              f"slides={report['slides']} rendered={report['rendered']}")
    else:
        print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
