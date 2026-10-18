# -*- coding: utf-8 -*-
"""paper_report —— 生成《论文写作说明》：讲清「这篇论文的逻辑」与「每个项目文件干什么」。

由论文写作模式在 S6 调用：

    python <BoBo根>/scripts/paper_report.py <论文项目目录> [--mode empirical|modeling|review|experiment] [--check]

产物：`<项目目录>/论文写作说明.md`（项目根，与 `投稿转换说明.md` 并列）。

三条设计原则：

- **机械组装**：文件清单、篇幅、引用数、证据数都从盘上读出来；本文件**不许手写**（闸门会拦对它的写入），
  改完产物重跑本脚本覆盖即可。
- **引用而非重述**：方向部分按小标题从 `design.md` / `positioning.md` / `protocol.md`
  **摘引原文**，不做 S6 的事后复述——事后复述一定会写成编的。
- **单一真相**：每个文件的作用，真相在 `paper-common` 的目录约定里；本脚本的 `CATALOG` 只是它的
  派生视图，`tests/test_paper_report.py` 有对齐测试保证两者不漂移。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

REPORT_FILENAME = "论文写作说明.md"
SCRIPT_VERSION = "1"
SNAPSHOT_OPEN = "<!-- paper-report-snapshot"
SNAPSHOT_CLOSE = "-->"
HASH_LIMIT_BYTES = 5 * 1024 * 1024
HASH_PREFIX = 12
MARKDOWN_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)
CITATION_KEY = re.compile(r"\[@([^\]\s]+)\]")


# ── 文件目录（派生视图；真相在 paper-common 的目录约定里）────────────────────
@dataclass(frozen=True)
class Entry:
    """一个项目文件（或目录）的说明。`modes` 为空表示四个模式都适用。"""

    path: str
    purpose: str
    modes: tuple[str, ...] = ()


CATALOG: tuple[Entry, ...] = (
    Entry("00-选题/design.md", "研究设计与方向定盘：研究问题、假设、变量操作化表、识别策略、事前分析计划、局限预期"),
    Entry("00-选题/preregistration.md", "预注册（实验模式）：假设与指标定义、评测冻结、预算、种子数、停止规则、成功判据", ("experiment",)),
    Entry("00-选题/idea.json", "机器可读的选题元数据：模式、语言、引用规范等标量字段"),
    Entry("00-选题/progress.md", "阶段推进记账：每阶段一行「完成判定 + 进入下一阶段的依据」"),
    Entry("00-选题/frozen.json", "冻结清单（实验模式）：评测脚本与留出集的登记表，登记后不许再改", ("experiment",)),
    Entry("01-文献/positioning.md", "选题定位：已有研究做了什么、gap 在哪、本文的贡献声明", ("empirical", "modeling", "experiment")),
    Entry("01-文献/protocol.md", "综述协议（综述与质性模式）：研究问题框架、可复现检索式、纳入排除标准、质量评价方法", ("review",)),
    Entry("01-文献/search-log.jsonl", "检索留档：每次检索的检索式、参数、各源成败与命中键（由文献工具机械追加）"),
    Entry("01-文献/references.jsonl", "引用台账：引用键 + 记录 + 核验状态（闸门据此判断正文里的引用能否使用）"),
    Entry("01-文献/refs.bib", "BibTeX 导出，供外部引用管理器使用"),
    Entry("01-文献/references.md", "按所选样式（GB/T 7714 或 APA）渲染好的参考文献列表"),
    Entry("01-文献/notes/", "逐篇文献的阅读笔记"),
    Entry("02-数据/raw/", "原始快照：只增不改，供回溯口径"),
    Entry("02-数据/dataset_v1.csv", "冻结的数据集版本（分析期间不再变动；改数据必须升版本号）"),
    Entry("02-数据/dataset_v1.manifest.json", "数据集清单：采集时间窗、字段说明与内容哈希"),
    Entry("02-数据/cleaning-log.md", "清洗决策日志：决策 + 触发原因 + 影响 + 依据，边做边记（不许事后补写）"),
    Entry("02-数据/extraction_scripts/", "采集与字段提取脚本及其索引"),
    Entry("03-分析/scripts/", "可重跑的分析脚本（正文的图与表都由它们生成，不许手抄）"),
    Entry("03-分析/results.json", "分析结果的唯一权威来源：正文数字都从它取"),
    Entry("03-分析/figures/", "由分析脚本生成的图"),
    Entry("03-分析/proofs/", "命题核验脚本（建模模式）：`P<i>-check.py`，符号验证 + 数值验证双路", ("modeling",)),
    Entry("03-实验/results.tsv", "实验台账（实验模式）：只由实验脚本追加，模型不许手写", ("experiment",)),
    Entry("03-实验/run.log", "实验运行日志（实验模式）：与台账分离，不读进模型上下文", ("experiment",)),
    Entry("04-稿件/outline.md", "全文提纲：分节安排与各节要回答的问题"),
    Entry("04-稿件/NN-分节.md", "分节稿源：每节一个文件（编号决定顺序），全部写完再合成 paper.md"),
    Entry("04-稿件/paper.md", "论文终稿（主交付物）"),
    Entry("04-稿件/figures/", "稿件用图"),
    Entry("05-评审/review.json", "评审结论：维度分 + 问题清单（含严重度与处理状态），闸门读它"),
    Entry("05-评审/revision-log.md", "返修记录：与问题清单一一对应，含「为什么不改」的理由"),
    Entry("evidence.jsonl", "证据层：写作的唯一取数来源，正文每个数字与每条引用都要能追到这里"),
    Entry("投稿转换说明.md", "投稿转换注意事项：公式、交叉引用、字体、图表分辨率的处理说明"),
    Entry("论文写作说明.md", "本文件：说明论文的逻辑与每个项目文件的作用，由脚本生成"),
)

# 目录条目里含 `NN` 的表示「按模式匹配的一组文件」（如 `04-稿件/NN-分节.md`）。
PATTERN_MARKER = "NN"


def matches_pattern(entry: Entry, rel: str) -> bool:
    """`NN-…` 形式的目录条目按「编号开头」匹配文件，例如 `04-稿件/01-引言.md`。"""
    name = entry.path.rsplit("/", 1)[-1]
    if PATTERN_MARKER not in name:
        return False
    suffix = name.split(PATTERN_MARKER, 1)[1]
    extension = Path(suffix).suffix
    own = rel.rsplit("/", 1)[-1]
    return bool(re.match(r"^\d+[-_]", own)) and own.endswith(extension or "")


# ── 各模式的档案（问题来源与标准骨架）────────────────────────────────────────
MODES: dict[str, dict] = {
    "empirical": {
        "label": "实证研究模式",
        "type_package": "paper-empirical",
        "markers": ("02-数据/dataset_v1.csv",),
        "sources": (
            ("00-选题/design.md", ("研究问题", "假设", "贡献声明", "识别策略", "事前分析计划")),
            ("01-文献/positioning.md", ("贡献声明",)),
        ),
        "skeleton": ("引言", "文献综述与假设", "研究设计", "描述性统计", "实证结果", "讨论与结论", "附录"),
    },
    "modeling": {
        "label": "建模研究模式",
        "type_package": "paper-modeling",
        "markers": ("03-分析/proofs",),
        "sources": (
            ("00-选题/design.md", ("研究问题", "假设", "贡献声明", "待证性质")),
            ("01-文献/positioning.md", ("贡献声明",)),
        ),
        "skeleton": ("引言", "文献综述", "模型设定", "分析", "数值算例", "讨论与结论", "附录"),
    },
    "review": {
        "label": "综述与质性研究模式",
        "type_package": "paper-synthesis",
        "markers": ("01-文献/protocol.md",),
        "sources": (("01-文献/protocol.md", ("研究问题", "检索", "纳入", "质量评价")),),
        "skeleton": ("引言", "方法", "结果", "讨论", "结论", "附录"),
    },
    "experiment": {
        "label": "实验研究模式",
        "type_package": "paper-experiment",
        "markers": ("00-选题/preregistration.md", "03-实验/results.tsv"),
        "sources": (
            ("00-选题/preregistration.md", ("假设", "指标", "成功判据", "预算")),
            ("00-选题/design.md", ("研究问题", "贡献声明")),
        ),
        "skeleton": ("引言", "相关工作", "方法", "实验设置", "结果与消融", "讨论", "结论", "附录"),
    },
}


# ── 小工具 ──────────────────────────────────────────────────────────────────
def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def sections_of(text: str) -> list[tuple[str, str]]:
    """把 markdown 按标题切段，返回 `[(标题, 正文)]`（不含标题行本身）。"""
    matches = list(MARKDOWN_HEADING.finditer(text))
    out: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        out.append((match.group(2).strip(), text[match.end():end].strip()))
    return out


def quote_sections(project: Path, rel: str, keywords: tuple[str, ...]) -> list[dict]:
    """从某个文件里按小标题关键词摘引原文；找不到就记一笔「未找到」，不编。"""
    text = read_text(project / rel)
    if text is None:
        return []
    found = []
    for heading, body in sections_of(text):
        if any(keyword in heading for keyword in keywords):
            found.append({"file": rel, "heading": heading, "body": body})
    return found


def sha256_of(path: Path) -> str | None:
    try:
        if path.stat().st_size > HASH_LIMIT_BYTES:
            return None
        return hashlib.sha256(path.read_bytes()).hexdigest()[:HASH_PREFIX]
    except OSError:
        return None


def detect_mode(project: Path, explicit: str | None) -> tuple[str | None, str]:
    """判定写作模式。返回 `(模式键或 None, 判定依据)`。"""
    if explicit:
        if explicit not in MODES:
            raise SystemExit(f"未知模式：{explicit}（可选 {', '.join(MODES)}）")
        return explicit, "命令行指定"
    for key, profile in MODES.items():
        for marker in profile["markers"]:
            if (project / marker).exists():
                return key, f"发现标志物 `{marker}`"
    return None, "未发现任何模式的标志物"


# ── 采集 ────────────────────────────────────────────────────────────────────
def collect_files(project: Path) -> list[str]:
    """项目内所有常规文件的相对路径（不含本报告自身）。"""
    files = []
    for path in sorted(project.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(project).as_posix()
        if rel == REPORT_FILENAME or rel.startswith("."):
            continue
        files.append(rel)
    return files


def collect_evidence(project: Path) -> dict:
    """证据层概览：条数、类型分布、按分节文件计数。"""
    text = read_text(project / "evidence.jsonl")
    if text is None:
        return {"total": 0, "by_type": {}, "by_file": {}, "malformed": 0}
    by_type: dict[str, int] = {}
    by_file: dict[str, int] = {}
    total = 0
    malformed = 0
    for line in text.splitlines():
        if line.strip() == "":
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            malformed += 1
            continue
        if not isinstance(row, dict):
            malformed += 1
            continue
        total += 1
        by_type[str(row.get("type") or "未标注")] = by_type.get(str(row.get("type") or "未标注"), 0) + 1
        used = row.get("used_in")
        for locator in (used if isinstance(used, list) else [used]):
            if not isinstance(locator, str):
                continue
            target = locator.split("#", 1)[0].strip()
            if target:
                by_file[target] = by_file.get(target, 0) + 1
    return {"total": total, "by_type": by_type, "by_file": by_file, "malformed": malformed}


def collect_manuscript(project: Path) -> list[dict]:
    """稿件分节地图：每个 `04-稿件/*.md` 一行，带机械统计。"""
    directory = project / "04-稿件"
    if not directory.is_dir():
        return []
    rows = []
    for path in sorted(directory.glob("*.md")):
        if path.name == "outline.md":
            continue
        text = read_text(path) or ""
        rows.append({
            "file": f"04-稿件/{path.name}",
            "name": re.sub(r"^\d+[-_]", "", path.stem),
            "chars": len(re.sub(r"\s+", "", text)),
            "citations": len(CITATION_KEY.findall(text)),
            "is_final": path.name == "paper.md",
        })
    return rows


def collect_counts(project: Path) -> dict:
    counts = {}
    ledger = read_text(project / "01-文献" / "references.jsonl")
    if ledger is not None:
        statuses = []
        for line in ledger.splitlines():
            if line.strip() == "":
                continue
            try:
                statuses.append(str(json.loads(line).get("status") or "未标注"))
            except json.JSONDecodeError:
                statuses.append("损坏")
        counts["references"] = len(statuses)
        counts["references_verified"] = statuses.count("verified")
    log = read_text(project / "01-文献" / "search-log.jsonl")
    if log is not None:
        counts["searches"] = sum(1 for line in log.splitlines() if line.strip() != "")
    results = read_text(project / "03-分析" / "results.json")
    if results is not None:
        try:
            parsed = json.loads(results)
            counts["result_keys"] = len(parsed) if isinstance(parsed, (dict, list)) else 0
        except json.JSONDecodeError:
            counts["result_keys"] = None
    ledger_tsv = read_text(project / "03-实验" / "results.tsv")
    if ledger_tsv is not None:
        counts["experiment_rows"] = max(0, len([line for line in ledger_tsv.splitlines() if line.strip()]) - 1)
    return counts


# ── 渲染 ────────────────────────────────────────────────────────────────────
def render(project: Path, mode: str | None, basis: str) -> str:
    profile = MODES.get(mode or "", None)
    label = profile["label"] if profile else "未识别（按通用格式生成）"
    files = collect_files(project)
    evidence = collect_evidence(project)
    manuscript = collect_manuscript(project)
    counts = collect_counts(project)
    now = datetime.now().astimezone().isoformat(timespec="seconds")

    lines: list[str] = []
    add = lines.append

    add(f"# {project.name} · 论文写作说明")
    add("")
    add("> 本文件由 `scripts/paper_report.py` 生成，**不要手写**——改完产物重跑脚本即可覆盖。")
    add("")

    # ── 速览 ──
    add("## 速览")
    add("")
    add("| 项 | 内容 |")
    add("| --- | --- |")
    add(f"| 写作模式 | {label}（判定依据：{basis}） |")
    if profile:
        add(f"| 类型包技能 | `{profile['type_package']}` |")
    add(f"| 项目文件 | 共 {len(files)} 个 |")
    if "references" in counts:
        add(f"| 引用 | 台账 {counts['references']} 条，其中已核验 {counts.get('references_verified', 0)} 条 |")
    if "searches" in counts:
        add(f"| 检索留档 | {counts['searches']} 次 |")
    if evidence["total"]:
        mix = "、".join(f"{key} {value} 条" for key, value in sorted(evidence["by_type"].items()))
        add(f"| 证据层 | {evidence['total']} 条（{mix}） |")
    if "result_keys" in counts and counts["result_keys"] is not None:
        add(f"| 分析结果 | {counts['result_keys']} 个结果键 |")
    if "experiment_rows" in counts:
        add(f"| 实验台账 | {counts['experiment_rows']} 行 |")
    final = next((row for row in manuscript if row["is_final"]), None)
    if final:
        add(f"| 论文终稿 | `{final['file']}`，{final['chars']} 字 |")
    add("")

    # ── 一、论文的逻辑 ──
    add("## 一、这篇论文的逻辑")
    add("")
    add("### 问题的提出与主张（原文摘引，不是事后复述）")
    add("")
    if profile:
        for rel, keywords in profile["sources"]:
            if not (project / rel).exists():
                continue
            blocks = quote_sections(project, rel, keywords)
            for block in blocks:
                add(f"**引自 `{block['file']}`「{block['heading']}」**")
                add("")
                for line in block["body"].splitlines():
                    add(f"> {line}" if line.strip() else ">")
                add("")
            if not blocks:
                add(f"⚠️ `{rel}` 里没找到模式要求的小标题（下列任一个即可）："
                    f"{'、'.join(f'「{keyword}」' for keyword in keywords)}。"
                    "请检查该文件的结构是否完整——报告不替它补内容。")
                add("")
    else:
        add("未能识别写作模式，跳过主张摘引。")
        add("")

    add("### 论证链")
    add("")
    add("从问题到结论，每一环都落在具体产物上：")
    add("")
    add("| 环节 | 依据的产物 | 状态 |")
    add("| --- | --- | --- |")
    chain = [
        ("方向与假设", "00-选题/design.md"),
        ("定位与贡献", "01-文献/positioning.md" if mode != "review" else "01-文献/protocol.md"),
        ("证据层", "evidence.jsonl"),
        ("数据", "02-数据/dataset_v1.csv"),
        ("分析结果", "03-分析/results.json"),
        ("实验台账", "03-实验/results.tsv"),
        ("引用核验", "01-文献/references.jsonl"),
        ("检索留档", "01-文献/search-log.jsonl"),
        ("论证成文", "04-稿件/paper.md"),
        ("评审结论", "05-评审/review.json"),
    ]
    for stage, rel in chain:
        exists = (project / rel).exists()
        add(f"| {stage} | `{rel}` | {'✓' if exists else '—（本模式未使用或尚未产出）'} |")
    add("")

    add("### 章节地图")
    add("")
    if manuscript:
        add("| 稿件分节 | 篇幅 | 引用键 | 证据条目 |")
        add("| --- | --- | --- | --- |")
        for row in manuscript:
            used = evidence["by_file"].get(row["file"], 0)
            mark = "（终稿）" if row["is_final"] else ""
            add(f"| `{row['file']}`{mark}<br>{row['name']} | {row['chars']} 字 | {row['citations']} | {used} |")
        add("")
        if profile:
            names = [row["name"] for row in manuscript]
            missing = [section for section in profile["skeleton"]
                       if not any(section in name or name in section for name in names)]
            if missing:
                add(f"⚠️ 本模式的标准骨架里，稿件中未找到对应分节：{'、'.join(missing)}。")
                add("")
            else:
                add("✓ 标准骨架里的分节都能在稿件中找到对应。")
                add("")
        add("各节该消费哪些产物，见本模式写作层技能（`paper-writing`）§1 的分节取数表。")
    else:
        add("`04-稿件/` 下还没有分节稿件。")
    add("")

    # ── 二、文件地图 ──
    add("## 二、每个项目文件是干什么的")
    add("")
    add("> 作用说明的真相在系统提示词的目录约定（`paper-common`）里，本表是它按实际磁盘内容生成的派生视图。")
    add("")
    entries = [entry for entry in CATALOG if not (entry.modes and mode not in entry.modes)]
    exact = {entry.path for entry in entries}
    claimed: set[str] = set()
    for entry in entries:
        rel = entry.path
        if PATTERN_MARKER in rel.rsplit("/", 1)[-1]:
            matched = [item for item in files if item not in exact and matches_pattern(entry, item)]
            if not matched:
                continue
            claimed.update(matched)
            add(f"- **`{rel}`** — {entry.purpose}（本项目有 {len(matched)} 个）")
            for item in matched:
                add(f"    - `{item}`（{(project / item).stat().st_size} 字节）")
        elif rel.endswith("/"):
            if not (project / rel).is_dir():
                continue
            children = [item for item in files if item.startswith(rel)]
            claimed.update(children)
            add(f"- **`{rel}`** — {entry.purpose}（{len(children)} 个文件）")
        else:
            path = project / rel
            if not path.exists():
                continue
            claimed.add(rel)
            add(f"- **`{rel}`** — {entry.purpose}（{path.stat().st_size} 字节）")
    add("")

    extra = [item for item in files if item not in claimed]
    if extra:
        add("### 目录约定之外的文件")
        add("")
        add("下面这些文件不在 `paper-common` 的目录约定里。若是过程产物，建议移出项目目录；"
            "若是应该长期保留的，建议补进约定。")
        add("")
        for rel in extra:
            add(f"- `{rel}`（{(project / rel).stat().st_size} 字节）")
        add("")

    # ── 三、生成信息 ──
    add("## 三、生成信息")
    add("")
    add(f"- 生成时间：{now}")
    add(f"- 生成脚本：`scripts/paper_report.py` v{SCRIPT_VERSION}")
    add("- 核对方式：`python scripts/paper_report.py <项目目录> --check`"
        "（重算产物快照并与本文件记录比对，不一致即报错）")
    add("")
    if evidence["malformed"]:
        add(f"⚠️ `evidence.jsonl` 里有 {evidence['malformed']} 行无法解析——请检查证据层格式。")
        add("")

    snapshot = {rel: digest for rel in files if (digest := sha256_of(project / rel))}
    add(SNAPSHOT_OPEN)
    add(json.dumps({"version": SCRIPT_VERSION, "at": now, "files": snapshot}, ensure_ascii=False, sort_keys=True))
    add(SNAPSHOT_CLOSE)
    add("")
    return "\n".join(lines)


def check(project: Path) -> int:
    """重算快照并与现有报告比对。"""
    existing = read_text(project / REPORT_FILENAME)
    if existing is None:
        print(f"{REPORT_FILENAME} 不存在——先生成再核对。", file=sys.stderr)
        return 1
    match = re.search(re.escape(SNAPSHOT_OPEN) + r"(.*?)" + re.escape(SNAPSHOT_CLOSE), existing, re.S)
    if match is None:
        print("现有报告里没有快照块，无法核对。", file=sys.stderr)
        return 1
    try:
        recorded = json.loads(match.group(1)).get("files") or {}
    except json.JSONDecodeError:
        print("快照块不是合法 JSON，无法核对。", file=sys.stderr)
        return 1

    current = {rel: digest for rel in collect_files(project) if (digest := sha256_of(project / rel))}
    changed = sorted(rel for rel in set(recorded) | set(current) if recorded.get(rel) != current.get(rel))
    if not changed:
        print(f"✓ {REPORT_FILENAME} 与产物一致（{len(current)} 个文件）。")
        return 0
    print(f"✗ {REPORT_FILENAME} 已与产物不一致，共 {len(changed)} 处：", file=sys.stderr)
    for rel in changed:
        if rel not in current:
            print(f"   - 已删除：{rel}", file=sys.stderr)
        elif rel not in recorded:
            print(f"   + 新增：{rel}", file=sys.stderr)
        else:
            print(f"   ~ 已修改：{rel}（{recorded[rel]} → {current[rel]}）", file=sys.stderr)
    print("请重跑本脚本（不带 --check）覆盖报告。", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成或核对《论文写作说明》")
    parser.add_argument("project", help="论文项目目录")
    parser.add_argument("--mode", choices=sorted(MODES), default=None, help="强制指定写作模式（默认按标志物推断）")
    parser.add_argument("--check", action="store_true", help="只核对现有报告与产物是否一致")
    parser.add_argument("--stdout", action="store_true", help="把报告输出到标准输出，不写文件")
    args = parser.parse_args(argv)

    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"不是目录：{project}", file=sys.stderr)
        return 2
    if args.check:
        return check(project)

    mode, basis = detect_mode(project, args.mode)
    report = render(project, mode, basis)
    if args.stdout:
        print(report)
        return 0
    (project / REPORT_FILENAME).write_text(report, encoding="utf-8")
    print(f"已生成 {project / REPORT_FILENAME}（模式：{MODES[mode]['label'] if mode else '未识别'}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
