# -*- coding: utf-8 -*-
"""report-experience/memory_store.py —— 文献汇报 PPT 经验库（字段语义层）。

机制（数据目录 / registry / readiness / 向量化 / Qdrant / 检索与沉淀骨架）全部来自
共享模块 `experience-store/experience_store.py`；本文件只提供**文献汇报侧的字段语义**，
与 `paper-experience` 的 `PaperAdapter` 平级、互不共用集合。

与论文写作经验库的四处关键差异：

1. **检索键**：`(scope, method_tags, stage, kind)` → `(report_type, tags, stage, kind)`。
   `report_type`（单篇/多篇/组会/开题/综述）是**硬过滤**而不是加权——组会汇报踩的坑
   与开题汇报踩的坑几乎不通用，这一点与论文池「scope 只做加权」的结论相反。
   召回主力仍是 `tags` + 语义向量。
2. **stage 取值**：`R0`–`R6`（汇报流程的七步），与论文池的 `S0`–`S6` 刻意不同名——
   两个池的 stage 语义不同（论文是研究阶段，汇报是制作阶段），混用会误导检索方。
3. **kind 取值**：改为 `narrative / content / visual / review / process / pipeline`。
   PPT 经验的失败面是「叙事断裂 / 内容取舍错 / 版式溢出 / 评分误判 / 流程漏步 / 工具链坏」，
   论文池的 `method/data/tooling` 在这里指代不清。
4. **排序含向量分**：`sort_key` 把 Qdrant 返回的相似度分纳入排序（论文池把它丢掉了，
   同类经验只剩置信度可比）。降级本地检索时相似度分为 0，自动退回 `report_type` + 置信度。

**指纹只有一份实现**：`feature_hash` 只在本文件里定义，种子脚本 import 它而不是自己再算一遍
（论文池的种子脚本自己算了一份、大小写口径与运行期不一致，导致同一条经验无法走「强化」合并）。

环境变量（沿用 `PAPER_MEMORY_*` 的命名与回传方式）：
- `REPORT_MEMORY_QDRANT_URL`      直接指定 Qdrant 地址（优先于 DBX 连接）
- `REPORT_MEMORY_QDRANT_API_KEY`  直接指定 API Key（优先于 DBX 连接里的密钥）
- `REPORT_MEMORY_QDRANT_CONN`     指定 DBX 中的 Qdrant 连接名（缺省取第一个 qdrant 连接）
- `REPORT_MEMORY_READONLY`        1 表示只读（不注册写工具）
- `REPORT_MEMORY_EMBEDDING`       0 表示禁用向量化（纯关键词检索）
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

# ── 加载共享机制层（技能目录优先，回退项目内路径）────────────────────────────
_HERE = Path(__file__).resolve().parent
for _cand in (_HERE.parent / "experience-store",
              _HERE.parent.parent / "dsh" / ".agents" / "skills" / "experience-store",
              _HERE.parent.parent.parent / "dsh" / ".agents" / "skills" / "experience-store"):
    if (_cand / "experience_store.py").is_file():
        sys.path.insert(0, str(_cand))
        break
else:  # pragma: no cover - 仅当目录被误删时命中
    raise RuntimeError("找不到 experience_store.py（共享机制层），请确认 experience-store 技能随包存在。")

from experience_store import Adapter, ExperienceStore, env, now_iso  # noqa: E402

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

COLLECTION = "report_experience"
DATA_DIR_NAME = "report-experience"
EMBED_MODEL = "BAAI/bge-small-zh-v1.5"
DEFAULT_EMBED_DIM = 512
CONFIDENCE_THRESHOLD = 2.0
CONFIDENCE_MAX = 5.0
CONFIDENCE_STEP = 0.5                 # 强化时 confidence = max(旧,新) + 0.5

#: 汇报类型——决定叙事骨架与评分权重，是**硬过滤**维度。
VALID_TYPES = ("single", "multi", "seminar", "proposal", "survey")

#: 制作阶段 R0–R6。
VALID_STAGES = ("R0", "R1", "R2", "R3", "R4", "R5", "R6")

#: 经验类别——PPT 的失败面。
VALID_KINDS = ("narrative", "content", "visual", "review", "process", "pipeline")

VALID_RESULTS = ("SUCCESS", "FAIL", "PARTIAL_SUCCESS")

#: 页角色——这条经验作用在哪类页面上（可多选）。检索时按页角色加权。
VALID_PAGE_ROLES = ("cover", "outline", "background", "question", "method", "data",
                    "result", "compare", "limitation", "takeaway", "reference", "thanks")


def _norm(s: str) -> str:
    """通用归一化：小写、去首尾空白、多空白合一、下划线转横线。"""
    return re.sub(r"\s+", "-", (s or "").strip().lower().replace("_", "-"))


def infer_report_type(papers_count: int, requested: str = "") -> str:
    """按论文篇数推断汇报类型；显式传入优先。"""
    r = _norm(requested)
    if r in VALID_TYPES:
        return r
    n = int(papers_count or 1)
    if n >= 2:
        return "multi"
    return "single"


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class ReportPPTAdapter(Adapter):
    """文献汇报 PPT 经验的字段语义。"""

    def __init__(self) -> None:
        super().__init__(
            env_prefix="REPORT_MEMORY",
            data_dir_name=DATA_DIR_NAME,
            collection=COLLECTION,
            docs_dir_name="report-experience",
            threshold=CONFIDENCE_THRESHOLD,
            embed_model=EMBED_MODEL,
            embed_dim=DEFAULT_EMBED_DIM,
            confidence_max=CONFIDENCE_MAX,
            feedback_step=CONFIDENCE_STEP,
            cleanup_max_age_days=90,
            cleanup_confidence_max=2.5,
        )

    # ── 指纹：本文件是唯一实现（种子脚本 import 本函数）───────────────
    def feature_hash(self, rec: dict) -> str:
        key = "|".join([
            _norm(rec.get("report_type", "")),
            ",".join(sorted(_norm(t) for t in (rec.get("tags") or []))),
            (rec.get("kind") or "").lower(),
            (rec.get("stage") or "").upper(),
        ])
        return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]

    # ── 语义文本（参与向量化；召回主力）──────────────────────────────
    def semantic_text(self, rec: dict) -> str:
        parts = [
            rec.get("report_type", ""),
            " ".join(rec.get("tags") or []),
            rec.get("stage", ""),
            rec.get("kind", ""),
            " ".join(rec.get("page_roles") or []),
            rec.get("applicable_when", ""),
            " ".join(rec.get("pitfalls") or []),
            rec.get("final_recipe", ""),
            " ".join(rec.get("positive_lessons") or []),
            " ".join(rec.get("negative_lessons") or []),
        ]
        return " ".join(x for x in parts if x)[:2000]

    # ── payload（写入 Qdrant 的结构）──────────────────────────────────
    def payload(self, rec: dict) -> dict:
        keep = ("id", "report_type", "tags", "stage", "kind", "result", "confidence",
                "confirmed_projects", "language", "page_roles", "applicable_when",
                "pitfalls", "attempts", "final_recipe", "positive_lessons",
                "negative_lessons", "tools_used", "used_experience_ids", "provenance",
                "feature_hash", "created_at", "updated_at", "used_count", "md_path")
        out = {k: rec.get(k) for k in keep}
        # MatchAny 是精确匹配，而 tag 是大小写混写的（`Marp` / `PPTX`）。
        # 额外落一份归一化副本专供过滤，展示用 tags 保持原样。
        out["tags_norm"] = sorted({_norm(t) for t in (rec.get("tags") or [])})
        return out

    def dir_key(self, rec: dict) -> str:
        return _norm(rec.get("report_type", "")) or "unknown"

    # ── MD 渲染 ────────────────────────────────────────────────────────
    def md_content(self, rec: dict) -> str:
        L = [
            "# 文献汇报 PPT 经验日志",
            "",
            f"- ID: {rec['id']}",
            f"- 汇报类型: {rec['report_type']}    语言: {rec.get('language') or '-'}",
            f"- stage: {rec['stage']}    kind: {rec['kind']}",
            f"- 标签: {', '.join(rec.get('tags') or []) or '-'}",
            f"- 页角色: {', '.join(rec.get('page_roles') or []) or '-'}",
            f"- 结果: {rec['result']}",
            f"- 置信度: {rec['confidence']}",
            f"- 跨汇报复现数 confirmed_projects: {rec.get('confirmed_projects', 0)}",
            f"- 使用工具: {', '.join(rec.get('tools_used') or []) or '-'}",
            f"- 参考过的历史经验: {', '.join(rec.get('used_experience_ids') or []) or '-'}",
            f"- 时间: {rec.get('created_at', '')}",
        ]
        prov = rec.get("provenance") or {}
        if prov.get("report_project"):
            L.append(f"- 汇报项目: {prov.get('report_project')}")
        if prov.get("artifacts"):
            L.append(f"- 产物定位: {', '.join(prov.get('artifacts') or [])}")
        if prov.get("seed"):
            L.append("- 来源: **技能种子**（非真实汇报项目 earned 经验）")
        L += ["", "## 适用条件（applicable_when）", "", rec.get("applicable_when") or "（未填）", "",
              "## 踩到的坑", ""]
        L += [f"- {x}" for x in (rec.get("pitfalls") or [])] or ["- （无）"]
        L += ["", "## 尝试过的方案", ""]
        if rec.get("attempts"):
            for a in rec["attempts"]:
                mark = "✅" if str(a.get("result", "")).lower() in ("success", "成功", "ok") else "❌"
                note = a.get("note", "")
                L.append(f"- {mark} {a.get('method','')} → {a.get('result','')}"
                         + (f"，原因：{note}" if note else ""))
        else:
            L.append("- （无）")
        L += ["", "## 最终做法（final_recipe）", "", rec.get("final_recipe") or "（无）",
              "", "## 经验总结（正向）"]
        L += [f"- {x}" for x in (rec.get("positive_lessons") or [])] or ["- （无）"]
        L += ["", "## 教训总结（负向）"]
        L += [f"- {x}" for x in (rec.get("negative_lessons") or [])] or ["- （无）"]
        return "\n".join(L) + "\n"

    # ── 记录构造 ───────────────────────────────────────────────────────
    def new_record(self, f: dict) -> dict:
        report_type = _norm(f.get("report_type") or "")
        if report_type not in VALID_TYPES:
            raise ValueError(
                f"report_type 必填，且必须是 {'/'.join(VALID_TYPES)} 之一，收到 {report_type!r}。")
        applicable_when = (f.get("applicable_when") or "").strip()
        if not applicable_when:
            # 与其他两个池一致的红线：没有适用条件不许入库（防负向经验过度泛化）
            raise ValueError(
                "applicable_when（适用条件）必填：请写清「在什么条件下这条经验成立」，"
                "如「多篇论文结论方向不一致、且用户要 20 分钟内讲完时」。"
                "没有适用条件的经验泛化出去会误导后续汇报，故不允许入库。")
        stage = (f.get("stage") or "").upper().strip()
        if stage not in VALID_STAGES:
            raise ValueError(f"stage 必须是 {'/'.join(VALID_STAGES)} 之一，收到 {stage!r}。")
        kind = (f.get("kind") or "narrative").lower().strip()
        if kind not in VALID_KINDS:
            raise ValueError(f"kind 必须是 {'/'.join(VALID_KINDS)} 之一，收到 {kind!r}。")
        result = (f.get("result") or "SUCCESS").upper().strip()
        if result not in VALID_RESULTS:
            result = "PARTIAL_SUCCESS"
        try:
            conf = round(float(f.get("confidence") or 0.0), 1)
        except (TypeError, ValueError):
            conf = 0.0
        roles = [_norm(r_) for r_ in (f.get("page_roles") or []) if _norm(r_)]
        # provenance 允许两种写法：嵌套 `provenance.report_project`（MCP 层用它），
        # 或顶层 `report_project` / `artifacts`（脚本与自检用例的直接调用）。
        prov = dict(f.get("provenance") or {})
        report_project = prov.get("report_project") or f.get("report_project") or None
        artifacts = list(prov.get("artifacts") or f.get("artifacts") or [])
        return {
            "id": f.get("id") or __import__("uuid").uuid4().hex,
            "report_type": report_type,
            "tags": [str(t) for t in (f.get("tags") or []) if str(t).strip()],
            "stage": stage,
            "kind": kind,
            "result": result,
            "confidence": conf,
            "confirmed_projects": int(f.get("confirmed_projects") or 0),
            "language": _norm(f.get("language") or "") or "",
            "page_roles": roles,
            "applicable_when": applicable_when,
            "pitfalls": [str(x) for x in (f.get("pitfalls") or [])],
            "attempts": list(f.get("attempts") or []),
            "final_recipe": f.get("final_recipe") or "",
            "positive_lessons": [str(x) for x in (f.get("positive_lessons") or [])],
            "negative_lessons": [str(x) for x in (f.get("negative_lessons") or [])],
            "tools_used": [str(x) for x in (f.get("tools_used") or [])],
            "used_experience_ids": [str(x) for x in (f.get("used_experience_ids") or [])],
            "provenance": {
                "report_project": report_project,
                "artifacts": artifacts,
                "seed": bool(prov.get("seed", False)),
                "note": prov.get("note", ""),
            },
            "feature_hash": "",
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "used_count": 0,
            "archived": False,
            "merged_into": None,
            "archive_reason": "",
            "qdrant_pending": False,
            "qdrant_point_id": None,
            "md_path": "",
        }

    # ── 命中项（模型可见结构，摘要化由 MCP 层做）──────────────────────
    def to_hit(self, src: Any) -> dict:
        p = getattr(src, "payload", None)
        if p is None:
            p = src
        # 向量相似度分——供 sort_key 排序；不进 payload()，因此不会被写回 Qdrant。
        raw_score = getattr(src, "score", None)
        return {
            "id": p.get("id") or getattr(src, "id", ""),
            "report_type": p.get("report_type", ""),
            "tags": p.get("tags", []),
            "stage": p.get("stage", ""),
            "kind": p.get("kind", ""),
            "result": p.get("result", ""),
            "confidence": p.get("confidence", 0),
            "confirmed_projects": p.get("confirmed_projects", 0),
            "language": p.get("language", ""),
            "page_roles": p.get("page_roles", []),
            "applicable_when": p.get("applicable_when", ""),
            "positive_lessons": p.get("positive_lessons", []),
            "negative_lessons": p.get("negative_lessons", []),
            "final_recipe": p.get("final_recipe", ""),
            "pitfalls": p.get("pitfalls", []),
            "used_experience_ids": [],
            "_score": float(raw_score) if raw_score is not None else 0.0,
        }

    # ── 检索：report_type / tags / stage / kind 四维**硬过滤** ──────────
    def build_filter(self, query: dict) -> list:
        from qdrant_client import models
        must = []
        if query.get("report_type"):
            must.append(models.FieldCondition(
                key="report_type",
                match=models.MatchValue(value=_norm(str(query["report_type"])))))
        tags = sorted({_norm(t) for t in (query.get("tags") or []) if str(t).strip()})
        if tags:
            must.append(models.FieldCondition(key="tags_norm",
                                              match=models.MatchAny(any=tags)))
        if query.get("stage"):
            must.append(models.FieldCondition(key="stage",
                                              match=models.MatchValue(
                                                  value=str(query["stage"]).upper())))
        if query.get("kind"):
            must.append(models.FieldCondition(key="kind",
                                              match=models.MatchValue(
                                                  value=str(query["kind"]).lower())))
        return must

    def local_score(self, rec: dict, query: dict) -> float:
        score = 0.0
        rt = query.get("report_type")
        if rt and _norm(rt) == _norm(rec.get("report_type", "")):
            score += 3.0
        qtags = {_norm(t) for t in (query.get("tags") or [])}
        if qtags:
            score += len(qtags & {_norm(t) for t in (rec.get("tags") or [])}) * 1.0
        if query.get("stage") and str(query["stage"]).upper() == rec.get("stage"):
            score += 1.5
        if query.get("kind") and str(query["kind"]).lower() == rec.get("kind"):
            score += 1.5
        words = [w for w in re.split(r"[\s,，;；/]+", (query.get("text") or "").lower())
                 if len(w) > 1]
        if words:
            blob = " ".join([
                rec.get("report_type", ""), " ".join(rec.get("tags") or []),
                " ".join(rec.get("page_roles") or []),
                rec.get("applicable_when", ""), " ".join(rec.get("pitfalls") or []),
                rec.get("final_recipe", ""),
                " ".join(rec.get("positive_lessons") or []),
                " ".join(rec.get("negative_lessons") or []),
            ]).lower()
            score += sum(1 for w in words if w in blob) * 1.0
        return score

    def sort_key(self, hit: dict, query: dict) -> tuple:
        """排序**含向量相似度分**（论文池把它丢了，同类经验只剩置信度可比）。"""
        sim = float(hit.get("_score") or 0.0)
        rt = query.get("report_type")
        type_hit = bool(rt) and _norm(rt) == _norm(hit.get("report_type", "") or "")
        return (sim, type_hit, float(hit.get("confidence") or 0))

    def project_key(self, rec: dict) -> str:
        return ((rec.get("provenance") or {}).get("report_project") or "").strip()

    # ── 去重策略：与论文池同为「强化」──────────────────────────────────
    def merge_duplicate(self, old: dict, new: dict) -> dict:
        def union(a, b):
            out, seen = [], set()
            for x in list(a or []) + list(b or []):
                k = (json.dumps(x, ensure_ascii=False, sort_keys=True)
                     if isinstance(x, (dict, list)) else str(x))
                if k not in seen:
                    seen.add(k)
                    out.append(x)
            return out

        merged = dict(old)
        for field in ("positive_lessons", "negative_lessons", "pitfalls", "attempts",
                      "tags", "page_roles", "tools_used", "used_experience_ids"):
            merged[field] = union(old.get(field), new.get(field))
        merged["confidence"] = round(
            min(CONFIDENCE_MAX, max(float(old.get("confidence") or 0),
                                    float(new.get("confidence") or 0)) + CONFIDENCE_STEP), 1)

        # confirmed_projects：按汇报项目去重累加（机械事实，可审计）
        po = (old.get("provenance") or {}).get("report_project")
        pn = (new.get("provenance") or {}).get("report_project")
        merged["confirmed_projects"] = int(old.get("confirmed_projects") or 0) + (
            1 if pn and pn != po else 0)

        if len(new.get("applicable_when") or "") > len(old.get("applicable_when") or ""):
            merged["applicable_when"] = new["applicable_when"]
        if not merged.get("final_recipe") and new.get("final_recipe"):
            merged["final_recipe"] = new["final_recipe"]
        if merged.get("result") == "FAIL" and new.get("result") == "SUCCESS":
            merged["result"] = "PARTIAL_SUCCESS"
        merged["used_count"] = int(old.get("used_count") or 0)
        merged["updated_at"] = now_iso()
        prov = dict(old.get("provenance") or {})
        if pn and pn != po:
            prov["reproduced_in"] = sorted(set(list(prov.get("reproduced_in") or []) + [str(pn)]))
            prov["seed"] = bool(prov.get("seed")) and bool(
                (new.get("provenance") or {}).get("seed"))
        merged["provenance"] = prov
        merged["feature_hash"] = old.get("feature_hash") or new.get("feature_hash")
        return merged

    def extra_stats(self, active: dict[str, dict]) -> dict:
        def tally(key):
            out: dict[str, int] = {}
            for r in active.values():
                v = r.get(key, "?") or "?"
                out[str(v)] = out.get(str(v), 0) + 1
            return out

        seeds = sum(1 for r in active.values() if (r.get("provenance") or {}).get("seed"))
        return {
            "by_report_type": dict(sorted(tally("report_type").items(), key=lambda kv: -kv[1])),
            "by_kind": tally("kind"),
            "by_stage": tally("stage"),
            "by_language": tally("language"),
            "seed_count": seeds,
            "earned_count": len(active) - seeds,
        }


_ADAPTER = ReportPPTAdapter()
store = ExperienceStore(_ADAPTER)

# ---------------------------------------------------------------------------
# 对外 API（与 paper / reverse 的 memory_store 同形，字段不同）
# ---------------------------------------------------------------------------


def readiness() -> dict:
    return store.readiness()


def write_readiness() -> dict:
    return store.write_readiness()


def probe_and_write_readiness() -> dict:
    """启动探活：走 HTTP 版，不 import qdrant_client（省 ~40MB 常驻）。"""
    return store.write_readiness_http()


def qdrant_endpoint() -> tuple[str | None, str | None]:
    return store.endpoint()


def qdrant_error() -> str:
    return store.error()


def qdrant_client():
    return store.client()


def is_readonly() -> bool:
    return store.is_readonly()


def search_experiences(*, report_type: str | None = None, tags: list[str] | None = None,
                       stage: str | None = None, kind: str | None = None,
                       features: str = "", query: str = "", top_k: int = 5) -> dict:
    q = {
        "report_type": report_type or "",
        "tags": tags or [],
        "stage": stage or "",
        "kind": kind or "",
        "text": (query or features or "").strip(),
    }
    return store.search(q, top_k=top_k)


def save_experience(fields: dict) -> dict:
    return store.save(fields)


def feedback_experience(experience_id: str, outcome: str) -> dict:
    return store.feedback(experience_id, outcome)


def stats() -> dict:
    return store.stats()


def cleanup(dry_run: bool = True, max_age_days: int | None = None) -> dict:
    return store.cleanup(dry_run=dry_run, max_age_days=max_age_days)


def sync_local_to_qdrant() -> dict:
    return store.sync_local_to_qdrant()


def purge_below_threshold(dry_run: bool = True, threshold: float | None = None) -> dict:
    return store.purge_below_threshold(dry_run=dry_run, threshold=threshold)


# ---------------------------------------------------------------------------
# 命令行自检（开发/排障，不走 MCP）
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    import argparse
    p = argparse.ArgumentParser(prog="memory_store", description="文献汇报 PPT 经验库自检")
    p.add_argument("cmd", choices=["stats", "readiness", "search", "save", "feedback",
                                   "cleanup", "sync", "purge", "hash"])
    p.add_argument("--type", dest="report_type", default="")
    p.add_argument("--tags", default="")
    p.add_argument("--stage", default="")
    p.add_argument("--kind", default="")
    p.add_argument("--features", default="")
    p.add_argument("--id", default="")
    p.add_argument("--outcome", default="success")
    p.add_argument("--confidence", type=float, default=None)
    p.add_argument("--result", default="SUCCESS")
    p.add_argument("--applicable-when", default="")
    p.add_argument("--top-k", type=int, default=5)
    p.add_argument("--apply", action="store_true", help="purge/cleanup: 真正执行")
    args = p.parse_args(argv)
    try:
        if args.cmd == "stats":
            print(json.dumps(stats(), ensure_ascii=False, indent=2))
        elif args.cmd == "readiness":
            print(json.dumps(write_readiness(), ensure_ascii=False, indent=2))
        elif args.cmd == "hash":
            print(_ADAPTER.feature_hash({
                "report_type": args.report_type, "tags": [t for t in args.tags.split(",") if t],
                "stage": args.stage, "kind": args.kind}))
        elif args.cmd == "search":
            print(json.dumps(search_experiences(
                report_type=args.report_type or None,
                tags=[t for t in args.tags.split(",") if t] or None,
                stage=args.stage or None, kind=args.kind or None,
                features=args.features, top_k=args.top_k), ensure_ascii=False, indent=2))
        elif args.cmd == "save":
            if args.confidence is None:
                print("错误: save 必须显式传 --confidence", file=sys.stderr)
                return 1
            print(json.dumps(save_experience({
                "report_type": args.report_type,
                "tags": [t for t in args.tags.split(",") if t],
                "stage": args.stage, "kind": args.kind or "narrative",
                "result": args.result, "confidence": args.confidence,
                "applicable_when": args.applicable_when,
                "pitfalls": ["自检用例"], "final_recipe": "自检用最终做法",
                "positive_lessons": ["自检通过"], "negative_lessons": [],
            }), ensure_ascii=False, indent=2))
        elif args.cmd == "feedback":
            print(json.dumps(feedback_experience(args.id, args.outcome),
                             ensure_ascii=False, indent=2))
        elif args.cmd == "cleanup":
            print(json.dumps(cleanup(dry_run=not args.apply), ensure_ascii=False, indent=2))
        elif args.cmd == "sync":
            print(json.dumps(sync_local_to_qdrant(), ensure_ascii=False, indent=2))
        elif args.cmd == "purge":
            print(json.dumps(purge_below_threshold(dry_run=not args.apply),
                             ensure_ascii=False, indent=2))
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"错误: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
