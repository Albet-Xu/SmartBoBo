# -*- coding: utf-8 -*-
"""report_deliver —— 生成《汇报说明》：讲清「这份汇报的逻辑」与「每个项目文件干什么」。

由文献汇报模式在 R6 调用：

    python <BoBo根>/scripts/report_deliver.py <汇报项目目录> [--check] [--stdout]

产物：`<项目目录>/05-交付/汇报说明.md`。

三条设计原则（与 `paper_report.py` 同构）：

- **机械组装**：页数、每页出处、引用数、证据数、评分与轮次都从盘上读出来；
  本文件**不许手写**（闸门会拦对它的写入），改完产物重跑本脚本覆盖即可。
- **引用而非重述**：叙事主线按每页的 `claims` 与标题**摘引** deck plan 原文，
  不做 R6 的事后复述——事后复述一定会写成编的。
- **单一真相**：每个文件的作用，真相在 `report-common` 的目录约定里；本脚本的 `CATALOG`
  只是它的派生视图。

**这一份文件是给"下次做汇报的人"看的**：它要能回答「这份 PPT 为什么这样排」，
以及「我下次照着改哪里」。所以它把**评分者逐页扣了什么分**与**每页依据哪篇论文的第几页**
并列出来——这两列放在一起，才能看出"哪类内容最容易翻车"。
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

REPORT_REL = "05-交付/汇报说明.md"
SCRIPT_VERSION = "1"
SNAPSHOT_OPEN = "<!-- report-deliver-snapshot"
SNAPSHOT_CLOSE = "-->"
HASH_LIMIT_BYTES = 5 * 1024 * 1024
HASH_PREFIX = 12
PATTERN_MARKER = "*"
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv"}


# ── 文件目录（派生视图；真相在 report-common 的目录约定里）──────────────────
@dataclass(frozen=True)
class Entry:
    path: str
    purpose: str
    types: tuple[str, ...] = ()


CATALOG: tuple[Entry, ...] = (
    Entry("00-选题/brief.md", "汇报定盘：语言、时长、页数上限、汇报类型、受众、想讲清的三个问题"),
    Entry("00-选题/config.json", "机器可读标量：language / report_type / duration_min / slide_target / theme"),
    Entry("00-选题/progress.md", "阶段推进记账：每阶段一行「完成判定 + 进入下一阶段的依据」"),
    Entry("01-文献/papers/", "源论文原件（PDF）。**不许删改**——所有出处都要能回到这里"),
    Entry("01-文献/extraction.jsonl", "逐篇结构化抽取：问题/方法/数据/主要结果/局限/可迁移点，一条一行"),
    Entry("01-文献/matrix.md", "对比矩阵：多篇汇报的共有维度对照表（含共同结论与分歧点两栏）", ("multi", "survey")),
    Entry("evidence.jsonl", "证据层：每页 claim 的唯一取数来源，source 必须指向论文的具体页码/图表"),
    Entry("02-叙事/storyline.md", "叙事主线：这份汇报想让听众记住什么、按什么顺序讲、哪些内容决定不讲"),
    Entry("02-叙事/slide-plan.json", "deck plan——**页面的唯一真相**。改页面就改它再重跑渲染，不要直接改 pptx"),
    Entry("02-叙事/slide-plan.round-*.json", "逐轮 plan 留档：**分数不单调是常态**，交付取最高分那一版时要能整套还原（plan + pptx 一起回滚，否则指纹对不上）"),
    Entry("03-产物/deck.pptx", "交付物：可编辑 PPT（由 report_pptx.py 从 plan 渲染）"),
    Entry("03-产物/notes.md", "讲稿：每页口播内容（与 pptx 备注页同源，均为 plan 的 notes 字段）"),
    Entry("03-产物/preview/", "每页渲染图——**评分者只看得到这个**；评分依据与交付物靠指纹绑定"),
    Entry("04-评审/qa-report.json", "机械质检：文字预算/越界/字号/证据链/配额，按 high/medium/low 分级"),
    Entry("04-评审/render-manifest.json", "渲染指纹：pptx 与每页预览图的 sha256（改完 pptx 不重渲染即失效）"),
    Entry("04-评审/score.json", "评分结论：总分 + 分维度 + 逐页扣分依据（**由独立评分者产出，不许生成者写**）"),
    Entry("04-评审/score-history.jsonl", "逐轮分数台账：每轮一行，用于判断迭代是否真的在收敛"),
    Entry("04-评审/issues.jsonl", "评分者提出的问题清单（带 severity 与 status，闸门据此判断能否交付）"),
    Entry("04-评审/revision-log.md", "返修记账：每条 issue 改了什么、或为什么决定不改"),
    Entry("04-评审/experience-candidates.md", "经验候选草稿（由 report_experience_candidates.py 生成，不许手写）"),
    Entry(REPORT_REL, "本文件：这份汇报的逻辑 + 每个文件干什么 + 评分与返修账"),
)

SLIDE_ROLE_LABEL = {
    "cover": "封面", "outline": "目录", "background": "背景", "question": "研究问题",
    "method": "方法", "data": "数据", "result": "结果", "compare": "对比矩阵",
    "limitation": "局限", "takeaway": "结论与启发", "reference": "参考文献", "thanks": "致谢",
}


# ── 工具 ────────────────────────────────────────────────────────────────────


def now_local() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def sha256_of(path: Path) -> str:
    try:
        if not path.is_file() or path.stat().st_size > HASH_LIMIT_BYTES:
            return ""
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()[:HASH_PREFIX]
    except OSError:
        return ""


def _sha256_full(path: Path) -> str:
    """完整 sha256——与 report_qa.py 写进 render-manifest.json 的口径一致（不做截断）。"""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return ""


def collect_files(project: Path) -> list[str]:
    out: list[str] = []
    for p in sorted(project.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(project).as_posix()
        if any(part in SKIP_DIRS for part in rel.split("/")):
            continue
        if rel == REPORT_REL:
            continue
        out.append(rel)
    return out


def read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def read_jsonl(path: Path) -> list[dict]:
    out: list[dict] = []
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
            if isinstance(rec, dict):
                out.append(rec)
        except Exception:  # noqa: BLE001
            continue
    return out


# ── 报告渲染 ────────────────────────────────────────────────────────────────


def render(project: Path) -> str:
    now = now_local()
    plan = read_json(project / "02-叙事" / "slide-plan.json") or {}
    qa = read_json(project / "04-评审" / "qa-report.json") or {}
    manifest = read_json(project / "04-评审" / "render-manifest.json") or {}
    score = read_json(project / "04-评审" / "score.json") or {}
    issues = read_jsonl(project / "04-评审" / "issues.jsonl")
    history = read_jsonl(project / "04-评审" / "score-history.jsonl")
    evidence = read_jsonl(project / "evidence.jsonl")
    extraction = read_jsonl(project / "01-文献" / "extraction.jsonl")
    meta = plan.get("meta") or {}
    slides = [s or {} for s in (plan.get("slides") or [])]
    files = collect_files(project)

    lines: list[str] = []
    add = lines.append

    rtype = str(meta.get("report_type") or "").strip().lower()
    add("# 汇报说明")
    add("")
    add(f"**{meta.get('title') or '（未命名汇报）'}**")
    add("")
    add("| 项 | 值 |")
    add("| --- | --- |")
    add(f"| 汇报类型 | `{rtype or '未声明'}` |")
    add(f"| 语言 | `{meta.get('language') or '未声明'}` |")
    add(f"| 预期时长 | {meta.get('duration_min') or '未声明'} 分钟 |")
    add(f"| 受众 | {meta.get('audience') or '未声明'} |")
    add(f"| 页数 | {len(slides)} 页 |")
    add(f"| 源论文 | {len(extraction) or len(meta.get('source_papers') or [])} 篇 |")
    if score:
        add(f"| 评分 | **{score.get('total', '—')} / 100**"
            f"（阈值 {score.get('threshold', 85)}，第 {score.get('round', '?')} 轮） |")
    else:
        add("| 评分 | 尚未评分 |")
    add("")
    add("> 本文件由 `scripts/report_deliver.py` 机械生成，**不许手写**（闸门会拦）。"
        "改完产物重跑本脚本即可覆盖。")
    add("")

    # ── 一、这份汇报的逻辑 ──
    add("## 一、这份汇报讲什么、为什么这样排")
    add("")
    storyline = project / "02-叙事" / "storyline.md"
    if storyline.is_file():
        for chunk in _plain_head(storyline, limit=12):
            add(chunk)
        add("")
    else:
        add("⚠️ 缺少 `02-叙事/storyline.md`——没有叙事主线，页面顺序就无从解释。")
        add("")

    if slides:
        add("### 逐页地图与出处")
        add("")
        add("> 「依据」列是每页 claim 指向的论文出处。**这一列必须每一行都有内容**——"
            "空白意味着该页的主张没有出处。")
        add("")
        add("| 页 | 角色 | 标题 | 讲稿 | 依据（论文出处） |")
        add("| --- | --- | --- | --- | --- |")
        for idx, sp in enumerate(slides, start=1):
            no = int(sp.get("no") or idx)
            role = SLIDE_ROLE_LABEL.get(str(sp.get("role") or ""), str(sp.get("role") or "—"))
            title = str(sp.get("title") or "—").replace("|", "\\|")
            notes = str(sp.get("notes") or "")
            notes_mark = f"{len(notes)} 字" if notes else "**缺失**"
            srcs = []
            for claim in (sp.get("claims") or []):
                src = str((claim or {}).get("source") or "").strip()
                if src:
                    srcs.append(src.replace("|", "\\|"))
            src_cell = "；".join(srcs) if srcs else "**无**"
            add(f"| {no} | {role} | {title} | {notes_mark} | {src_cell} |")
        add("")

        add("### 页面元素统计")
        add("")
        qf = sum(1 for sp in slides if sp.get("key_finding"))
        imgs = sum(1 for sp in slides if (sp.get("image") or {}).get("path"))
        tables = sum(1 for sp in slides if (sp.get("table") or {}).get("rows"))
        cols = sum(1 for sp in slides if sp.get("columns"))
        claims = sum(len(sp.get("claims") or []) for sp in slides)
        add(f"- 带图片的页：{imgs}")
        add(f"- 带表格的页：{tables}；带分栏的页：{cols}")
        add(f"- 底部强调条：{qf} 处（配额 max(1, 页数//3) = {max(1, len(slides) // 3)} 处）")
        add(f"- claims 总数：{claims}；证据层条目：{len(evidence)}")
        add("")

    add("### 源论文与对比矩阵")
    add("")
    if extraction:
        add("| # | 论文 | 研究问题 | 方法 | 关键结果 |")
        add("| --- | --- | --- | --- | --- |")
        for i, rec in enumerate(extraction, start=1):
            def cell(key):
                v = str(rec.get(key) or "—")
                return v[:90].replace("|", "\\|").replace("\n", " ") + ("…" if len(v) > 90 else "")
            add(f"| {i} | {cell('title')} | {cell('question')} | {cell('method')} | {cell('key_result')} |")
        add("")
    else:
        add("⚠️ 缺少 `01-文献/extraction.jsonl`——没有逐篇抽取，多篇汇报的对比就无从谈起。")
        add("")
    matrix = project / "01-文献" / "matrix.md"
    if matrix.is_file():
        add(f"对比矩阵见 `01-文献/matrix.md`（{matrix.stat().st_size} 字节）。")
    elif rtype in ("multi", "survey"):
        add("⚠️ 多篇/综述汇报缺少 `01-文献/matrix.md`。")
    add("")

    # ── 二、评分与返修 ──
    add("## 二、评分与返修账")
    add("")
    if score:
        add(f"- 总分：**{score.get('total', '—')} / 100**（阈值 {score.get('threshold', 85)}）")
        add(f"- 判定：`{score.get('verdict', '—')}`｜第 {score.get('round', '?')} 轮")
        add(f"- 评分者：独立子会话 `{score.get('evaluator_session_id', '—')}`")
        add(f"- 评分依据的 pptx 指纹：`{score.get('pptx_sha256', '—')}`")
        add("")
        dims = score.get("dimensions") or []
        if dims:
            add("| 维度 | 得分 | 权重 | 依据 |")
            add("| --- | --- | --- | --- |")
            for dim in dims:
                basis = str((dim or {}).get("basis") or "—").replace("|", "\\|")[:120]
                add(f"| {dim.get('name', '—')} | {dim.get('score', '—')} | "
                    f"{dim.get('weight', '—')} | {basis} |")
            add("")
    else:
        add("⚠️ 尚无 `04-评审/score.json`。")
        add("")

    if manifest:
        add("### 渲染指纹（评分与交付物的绑定）")
        add("")
        add(f"- pptx sha256：`{manifest.get('pptx_sha256', '—')}`"
            f"（{manifest.get('pptx_bytes', 0)} 字节）")
        add(f"- 渲染：{manifest.get('renderer', '—')} @ {manifest.get('dpi', '—')} dpi，"
            f"{manifest.get('rendered_slides', 0)}/{manifest.get('slides', 0)} 页，"
            f"{manifest.get('rendered_at', '—')}")
        add("- **pptx 此后被任何方式改写，本指纹即失效，评分作废、必须重跑质检与评分。**")
        add("")

    if history:
        add("### 逐轮分数")
        add("")
        add("| 轮次 | 总分 | 主要扣分项 | 相对上一轮 |")
        add("| --- | --- | --- | --- |")
        prev = None
        for rec in history:
            total = rec.get("total")
            delta = "—"
            if isinstance(total, (int, float)) and isinstance(prev, (int, float)):
                d = total - prev
                delta = f"{'+' if d >= 0 else ''}{d:g}"
            prev = total if isinstance(total, (int, float)) else prev
            top = str(rec.get("top_issues") or "—").replace("|", "\\|")[:100]
            add(f"| {rec.get('round', '?')} | {total if total is not None else '—'} | {top} | {delta} |")
        add("")
        totals = [r.get("total") for r in history if isinstance(r.get("total"), (int, float))]
        if len(totals) >= 2:
            best = max(totals)
            add(f"- 历史最高分：**{best:g}**；末轮得分：{totals[-1]:g}。"
                f"**交付应取最高分那一版**——改 A 坏 B 是返修的常态，分数并不单调。")
            add("")

    if issues:
        open_high = [i for i in issues
                     if str(i.get("severity") or "").lower() == "high"
                     and str(i.get("status") or "").lower() not in ("resolved", "wontfix")]
        add(f"- 问题清单共 {len(issues)} 条，其中未了结的高严重度项 {len(open_high)} 条。")
        if open_high:
            add(f"  - ⚠️ 未了结：{'、'.join(str(i.get('id') or i.get('where') or '?') for i in open_high)}")
        add("")
        # 已知缺口：`wontfix` 与仍开放的**非 high** 项都归这里——它们是交付的一部分，
        # 不是被藏起来的未完成项。评审判据是「high 必须了结」，其余可以带着交付。
        accepted = [i for i in issues
                    if str(i.get("severity") or "").lower() != "high"
                    and (not _settled(i) or str(i.get("status") or "").lower() == "wontfix")]
        if accepted:
            add("### 已知缺口（已评估并接受，随本次交付一起移交）")
            add("")
            add("| ID | 严重度 | 位置 | 缺口 | 为什么不改 |")
            add("| --- | --- | --- | --- | --- |")
            for i in accepted:
                why = str(i.get("reason") or i.get("resolution") or "—")
                why = why.replace("|", "\\|").replace("\n", " ")[:200]
                gap = str(i.get("problem") or "").replace("|", "\\|").replace("\n", " ")[:200]
                where = str(i.get("where") or "—").replace("|", "\\|")
                add(f"| {i.get('id', '—')} | {i.get('severity', '—')} | {where} | {gap} | {why} |")
            add("")

    qa_v = qa.get("violations") or []
    if qa_v:
        counts = qa.get("counts") or {}
        add(f"- 机械质检：high={counts.get('high', 0)} / medium={counts.get('medium', 0)} "
            f"/ low={counts.get('low', 0)}")
        for v in qa_v[:20]:
            add(f"  - [{v.get('severity')}] 第 {v.get('slide', '—')} 页 `{v.get('rule')}`：{v.get('detail')}")
        add("")

    # ── 三、文件地图 ──
    add("## 三、每个项目文件是干什么的")
    add("")
    add("> 作用说明的真相在系统提示词的目录约定（`report-common`）里，"
        "本表是它按实际磁盘内容生成的派生视图。")
    add("")
    exact = {e.path for e in CATALOG}
    claimed: set[str] = set()
    for entry in CATALOG:
        rel = entry.path
        if "*" in rel:
            matched = [f for f in files if f not in exact and fnmatch.fnmatch(f, rel)]
            if not matched:
                continue
            claimed.update(matched)
            add(f"- **`{rel}`** — {entry.purpose}（本项目有 {len(matched)} 个）")
            for item in matched:
                add(f"    - `{item}`（{(project / item).stat().st_size} 字节）")
        elif rel.endswith("/"):
            if not (project / rel).is_dir():
                continue
            children = [f for f in files if f.startswith(rel)]
            claimed.update(children)
            add(f"- **`{rel}`** — {entry.purpose}（{len(children)} 个文件）")
            for item in children[:12]:
                add(f"    - `{item}`（{(project / item).stat().st_size} 字节）")
            if len(children) > 12:
                add(f"    - …另有 {len(children) - 12} 个")
        else:
            path = project / rel
            if not path.exists():
                continue
            claimed.add(rel)
            add(f"- **`{rel}`** — {entry.purpose}（{path.stat().st_size} 字节）")
    add("")

    extra = [f for f in files if f not in claimed and f not in exact]
    if extra:
        add("### 目录约定之外的文件")
        add("")
        add("下面这些文件不在 `report-common` 的目录约定里。若是过程产物，建议移出项目目录；"
            "若是应该长期保留的，建议补进约定。")
        add("")
        for rel in extra:
            add(f"- `{rel}`（{(project / rel).stat().st_size} 字节）")
        add("")

    # ── 四、生成信息 ──
    add("## 四、生成信息")
    add("")
    add(f"- 生成时间：{now}")
    add(f"- 生成脚本：`scripts/report_deliver.py` v{SCRIPT_VERSION}")
    add("- 核对方式：`python scripts/report_deliver.py <项目目录> --check`"
        "（重算产物快照并与本文件记录比对，不一致即报错）")
    add("")

    snapshot = {rel: digest for rel in files if (digest := sha256_of(project / rel))}
    add(SNAPSHOT_OPEN)
    add(json.dumps({"version": SCRIPT_VERSION, "at": now, "files": snapshot},
                   ensure_ascii=False, sort_keys=True))
    add(SNAPSHOT_CLOSE)
    add("")
    return "\n".join(lines)


def _plain_head(path: Path, limit: int) -> list[str]:
    """摘引某个 markdown 的前若干非空行（保留标题层级，去掉过长的代码块）。"""
    out: list[str] = []
    in_fence = False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if line.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence or not line.strip():
            continue
        out.append(line)
        if len(out) >= limit:
            out.append("")
            out.append(f"（完整内容见 `{path.as_posix().split('/')[-2]}/{path.name}`）")
            break
    return out


def check(project: Path) -> int:
    """重算快照并与现有报告比对。"""
    report_path = project / REPORT_REL
    if not report_path.is_file():
        print(f"{REPORT_REL} 不存在——先生成再核对。", file=sys.stderr)
        return 1
    existing = report_path.read_text(encoding="utf-8")
    match = re.search(re.escape(SNAPSHOT_OPEN) + r"(.*?)" + re.escape(SNAPSHOT_CLOSE),
                      existing, re.S)
    if match is None:
        print("现有报告里没有快照块，无法核对。", file=sys.stderr)
        return 1
    try:
        recorded = json.loads(match.group(1)).get("files") or {}
    except json.JSONDecodeError:
        print("快照块不是合法 JSON，无法核对。", file=sys.stderr)
        return 1

    current = {rel: digest for rel in collect_files(project)
               if (digest := sha256_of(project / rel))}
    changed = sorted(rel for rel in set(recorded) | set(current)
                     if recorded.get(rel) != current.get(rel))
    if not changed:
        print(f"✓ {REPORT_REL} 与产物一致（{len(current)} 个文件）。")
        return 0
    print(f"✗ {REPORT_REL} 已与产物不一致，共 {len(changed)} 处：", file=sys.stderr)
    for rel in changed:
        if rel not in current:
            print(f"   - 已删除：{rel}", file=sys.stderr)
        elif rel not in recorded:
            print(f"   + 新增：{rel}", file=sys.stderr)
        else:
            print(f"   ~ 已修改：{rel}（{recorded[rel]} → {current[rel]}）", file=sys.stderr)
    print("请重跑本脚本（不带 --check）覆盖报告。", file=sys.stderr)
    return 1


# ── 交付闸门（权威判定点）────────────────────────────────────────────────────
#
# 为什么把判定放在**这个脚本**里：`report_gate.mjs` 只能看到文件写入，看不到"要不要生成
# 交付说明"这个决定；而**做出交付决定的操作就是运行本脚本**。所以权威判定在这里，
# 插件那一份是纵深防御（拦手写与散落文件）。
#
# 三查：分数与指纹、未了结 high、经验是否已沉淀。

MAX_ROUNDS = 3
DEFAULT_THRESHOLD = 85


def _report_experience_data_dir(project: Path) -> Path | None:
    """定位汇报经验库目录；找不到返回 None（经验库未接入 → 不做沉淀判定）。"""
    cands: list[Path] = []
    dsh_home = os.environ.get("DSH_HOME", "").strip()
    if dsh_home:
        base = Path(dsh_home).parent
        cands.append(base / "experience-pool" / "report-experience")
        cands.append(base / "report-experience")  # 旧布局回退
    bobo_root = os.environ.get("BOBO_ROOT", "").strip()
    if bobo_root:
        cands.append(Path(bobo_root) / "bobo-data" / "experience-pool" / "report-experience")
        cands.append(Path(bobo_root) / "bobo-data" / "report-experience")
    cur = Path(__file__).resolve().parent.parent
    cands.append(cur / "bobo-data" / "experience-pool" / "report-experience")
    cands.append(cur / "bobo-data" / "report-experience")
    cands.append(project / "bobo-data" / "experience-pool" / "report-experience")
    cands.append(project / "bobo-data" / "report-experience")
    for c in cands:
        if (c / "registry.json").is_file() or c.is_dir():
            return c
    return None


def _experience_saved(project: Path) -> tuple[bool, str]:
    """本次汇报是否已沉淀经验。返回 (是否满足, 说明)。

    经验库未接入时**不阻塞**（fail-open 于基础设施）：没连 Qdrant 的用户本来就不该被拦。
    """
    d = _report_experience_data_dir(project)
    if d is None:
        return True, "经验库未接入（未找到 report-experience 数据目录），跳过沉淀判定"
    reg_path = d / "registry.json"
    if not reg_path.is_file():
        return True, f"经验库尚无 registry.json（{d}），跳过沉淀判定"
    try:
        reg = json.loads(reg_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return True, "经验库 registry.json 读不出，跳过沉淀判定"
    name = project.name
    hits = [r for r in reg.values()
            if not r.get("archived") and not r.get("merged_into")
            and str(((r.get("provenance") or {}).get("report_project")) or "") == name]
    if hits:
        return True, f"本次汇报已沉淀 {len(hits)} 条经验（report_project={name}）"
    return False, (
        f"本次汇报还没有沉淀任何经验（registry 里没有 report_project={name} 的在库记录）。\n"
        "  请先跑 `python scripts/report_experience_candidates.py <汇报项目目录>` 生成候选草稿，\n"
        "  逐条过迁移判据后用 report_experience_save 入库——**带上 report_project**，\n"
        "  否则换汇报复现时 confirmed_projects 无法累加。")


def delivery_gate(project: Path) -> list[str]:
    """交付前的权威判定；返回阻塞理由列表（空 = 可以交付）。"""
    reasons: list[str] = []

    pptx = project / "03-产物" / "deck.pptx"
    if not pptx.is_file():
        reasons.append("缺少 03-产物/deck.pptx（请先跑 report_pptx.py）")
        return reasons
    disk_hash = _sha256_full(pptx)

    qa = read_json(project / "04-评审" / "qa-report.json")
    if qa is None:
        reasons.append("缺少 04-评审/qa-report.json（请先跑 report_qa.py）")
    else:
        high = (qa.get("counts") or {}).get("high", 0)
        if high:
            rules = sorted({v.get("rule", "?") for v in (qa.get("violations") or [])
                            if v.get("severity") == "high"})
            reasons.append(f"机械质检还有 {high} 条 high 违规：{'、'.join(rules)}"
                           "（请改 plan 后重跑 report_pptx.py + report_qa.py）")
        if qa.get("rendered") is not True:
            reasons.append("还没有渲染分页图片（评分者看不到页面实际样子）")

    manifest = read_json(project / "04-评审" / "render-manifest.json")
    if manifest is None:
        reasons.append("缺少 04-评审/render-manifest.json（渲染指纹，必须由 report_qa.py 产出）")
    elif str(manifest.get("pptx_sha256") or "") != disk_hash:
        reasons.append(
            "deck.pptx 与渲染指纹不一致——pptx 被改过但没重新质检。\n"
            "  请重跑 `python scripts/report_qa.py <汇报项目目录>`，再让评分者重评。")

    score = read_json(project / "04-评审" / "score.json")
    if score is None:
        reasons.append("缺少 04-评审/score.json（必须由**独立会话**的评分者产出）")
    else:
        total = score.get("total")
        threshold = float(score.get("threshold") or DEFAULT_THRESHOLD)
        round_no = int(score.get("round") or 0)
        if str(score.get("pptx_sha256") or "") != disk_hash:
            reasons.append("score.json 绑定的 pptx 指纹与盘上的 deck.pptx 不一致——"
                           "评分评的是旧版本，请重跑质检与评分。")
        if isinstance(total, (int, float)):
            if total < threshold and round_no < MAX_ROUNDS:
                reasons.append(f"总分 {total:g} 低于门槛 {threshold:g}，且只到第 {round_no}/{MAX_ROUNDS} 轮——"
                               "继续返修，不要提前交付。")
        else:
            reasons.append("score.json 缺 total（无法判断是否达标）")
        if not (score.get("dimensions") or []):
            reasons.append("score.json 的 dimensions 为空——只有总分没有分维度，返修没有方向。")

    issues = read_jsonl(project / "04-评审" / "issues.jsonl")
    open_high = [i for i in issues
                 if str(i.get("severity") or "").lower() == "high" and not _settled(i)]
    if open_high:
        ids = "、".join(str(i.get("id") or i.get("where") or "?") for i in open_high)
        reasons.append(f"还有未了结的高严重度问题：{ids}（能改的 resolved，不改的 wontfix 并写明理由）")

    ok, note = _experience_saved(project)
    if not ok:
        reasons.append(note)

    return reasons


def _settled(issue: dict) -> bool:
    """与 report-gate.mjs 的 `isSettled` 同一判据（两处必须一起改）。"""
    status = str(issue.get("status") or "").lower()
    if status == "resolved":
        return True
    if status == "wontfix":
        return str(issue.get("reason") or "").strip() != ""
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成或核对《汇报说明》")
    parser.add_argument("project", help="汇报项目目录")
    parser.add_argument("--check", action="store_true", help="只核对现有报告与产物是否一致")
    parser.add_argument("--stdout", action="store_true", help="把报告输出到标准输出，不写文件")
    parser.add_argument("--skip-gate", action="store_true",
                        help="跳过交付闸门（仅供排障：生成一份不达标的说明用于诊断）")
    args = parser.parse_args(argv)

    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"不是目录：{project}", file=sys.stderr)
        return 2
    if args.check:
        return check(project)

    if not args.skip_gate and not args.stdout:
        blockers = delivery_gate(project)
        if blockers:
            print("交付闸门未通过，不能生成《汇报说明》：", file=sys.stderr)
            for b in blockers:
                print(f"  ✗ {b}", file=sys.stderr)
            print("\n（排障时可用 --skip-gate 生成一份诊断用的说明，但那不是交付物。）",
                  file=sys.stderr)
            return 3

    report = render(project)
    if args.stdout:
        print(report)
        return 0
    out = project / REPORT_REL
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding="utf-8")
    print(f"已生成 {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
