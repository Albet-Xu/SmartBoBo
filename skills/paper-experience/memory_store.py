# -*- coding: utf-8 -*-
"""paper-experience/memory_store.py —— 论文写作经验库（字段语义层）。

设计依据：`docs/研究模式调研/03-论文写作模式设计思路（经验沉淀层）.md`
（§4.2 记录 Schema、§5.1 检索键、§5.3 置信度锚点与「强化」去重、§8.1 红线）。

机制（数据目录 / registry / readiness / 向量化 / Qdrant / 检索与沉淀骨架）
全部来自共享模块 `experience-store/experience_store.py`（设计稿 §7.1）；
本文件只提供**论文侧的字段语义**。

与逆向经验库的三处关键差异（设计稿 §4.3）：

1. **检索键**：`domain` → `(scope, method_tags, stage, kind)` 四元组。其中
   `scope` 只参与**排序加权**、不做硬过滤（§5.1：「不要指望 scope 精确命中」），
   召回主力是 `method_tags` + 语义向量。
2. **置信度锚点**：不按「跑通次数」，按「项目复现数」（§5.3）。
3. **去重策略**：同指纹**不替换、走「强化」**（D2）——lessons 取并集、
   `confidence = min(5.0, max(旧,新) + 0.5)`、`confirmed_projects` 累加。

环境变量（沿用 `REVERSE_MEMORY_*` 的命名与回传方式）：
- `PAPER_MEMORY_QDRANT_URL`      直接指定 Qdrant 地址（优先于 DBX 连接）
- `PAPER_MEMORY_QDRANT_API_KEY`  直接指定 API Key（优先于 DBX 连接里的密钥）
- `PAPER_MEMORY_QDRANT_CONN`     指定 DBX 中的 Qdrant 连接名（缺省取第一个 qdrant 连接）
- `PAPER_MEMORY_READONLY`        1 表示只读（不注册写工具）
- `PAPER_MEMORY_EMBEDDING`       0 表示禁用向量化（纯关键词检索）
"""
from __future__ import annotations

import hashlib
import json
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
# 常量（设计稿 §4.4）
# ---------------------------------------------------------------------------

COLLECTION = "paper_experience"
DATA_DIR_NAME = "paper-experience"
EMBED_MODEL = "BAAI/bge-small-zh-v1.5"
DEFAULT_EMBED_DIM = 512
CONFIDENCE_THRESHOLD = 2.0
CONFIDENCE_MAX = 5.0
CONFIDENCE_STEP = 0.5                 # 强化时 confidence = max(旧,新) + 0.5
IN_MEMORY_KINDS = ("method", "data", "tooling", "review", "process")
VALID_STAGES = ("S0", "S1", "S2", "S3", "S4", "S5", "S6")
VALID_RESULTS = ("SUCCESS", "FAIL", "PARTIAL_SUCCESS")


def _norm_scope(s: str) -> str:
    """scope 归一化：小写、去首尾空白、两级 `领域/子领域`（§5.1）。"""
    d = (s or "").strip().lower()
    d = d.replace(" ", "-").replace("／", "/").replace("_", "-")
    while "//" in d:
        d = d.replace("//", "/")
    return d.strip("/") or "unknown"


def _tag_key(t: str) -> str:
    return (t or "").strip().lower()


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class PaperAdapter(Adapter):
    def __init__(self) -> None:
        super().__init__(
            env_prefix="PAPER_MEMORY",
            data_dir_name=DATA_DIR_NAME,
            collection=COLLECTION,
            docs_dir_name="paper-experience",
            threshold=CONFIDENCE_THRESHOLD,
            embed_model=EMBED_MODEL,
            embed_dim=DEFAULT_EMBED_DIM,
            confidence_max=CONFIDENCE_MAX,
            feedback_step=CONFIDENCE_STEP,
            cleanup_max_age_days=90,
            cleanup_confidence_max=2.5,
        )

    # ── 指纹（§4.2）────────────────────────────────────────────────────
    def feature_hash(self, rec: dict) -> str:
        key = "|".join([
            _norm_scope(rec.get("scope", "")),
            ",".join(sorted(_tag_key(t) for t in (rec.get("method_tags") or []))),
            (rec.get("kind") or "").lower(),
            (rec.get("stage") or "").upper(),
        ])
        return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]

    # ── 语义文本（参与向量化；§5.1 召回主力）───────────────────────────
    def semantic_text(self, rec: dict) -> str:
        parts = [
            rec.get("scope", ""),
            " ".join(rec.get("method_tags") or []),
            rec.get("stage", ""),
            rec.get("kind", ""),
            rec.get("applicable_when", ""),
            " ".join(rec.get("pitfalls") or []),
            rec.get("final_recipe", ""),
            " ".join(rec.get("positive_lessons") or []),
            " ".join(rec.get("negative_lessons") or []),
        ]
        return " ".join(x for x in parts if x)[:2000]

    # ── payload（写入 Qdrant 的结构）───────────────────────────────────
    def payload(self, rec: dict) -> dict:
        keep = ("id", "scope", "method_tags", "stage", "kind", "result", "confidence",
                "confirmed_projects", "applicable_when", "pitfalls", "attempts",
                "final_recipe", "positive_lessons", "negative_lessons", "tools_used",
                "used_experience_ids", "provenance", "feature_hash", "created_at",
                "updated_at", "used_count", "md_path")
        out = {k: rec.get(k) for k in keep}
        # Qdrant 的 MatchAny 是**精确匹配**，而方法标签是大小写混写的（`PRISMA` / `DiD`）。
        # 因此额外落一份归一化副本专供过滤，展示用的 method_tags 保持原样。
        out["method_tags_norm"] = sorted({_tag_key(t) for t in (rec.get("method_tags") or [])})
        return out

    def dir_key(self, rec: dict) -> str:
        s = _norm_scope(rec.get("scope", ""))
        return s.replace("/", "-").replace(".", "-") or "unknown"

    # ── MD 渲染 ────────────────────────────────────────────────────────
    def md_content(self, rec: dict) -> str:
        L = [
            "# 论文写作经验日志",
            "",
            f"- ID: {rec['id']}",
            f"- scope（领域/主题键）: {rec['scope']}",
            f"- stage: {rec['stage']}    kind: {rec['kind']}",
            f"- 方法标签: {', '.join(rec.get('method_tags') or []) or '-'}",
            f"- 结果: {rec['result']}",
            f"- 置信度: {rec['confidence']}",
            f"- 跨项目复现数 confirmed_projects: {rec.get('confirmed_projects', 0)}",
            f"- 使用工具: {', '.join(rec.get('tools_used') or []) or '-'}",
            f"- 参考过的历史经验: {', '.join(rec.get('used_experience_ids') or []) or '-'}",
            f"- 时间: {rec.get('created_at', '')}",
        ]
        prov = rec.get("provenance") or {}
        if prov.get("paper_project"):
            L.append(f"- 论文项目: {prov.get('paper_project')}")
        if prov.get("artifacts"):
            L.append(f"- 产物定位: {', '.join(prov.get('artifacts') or [])}")
        if prov.get("seed"):
            L.append("- 来源: **技能种子**（非真实论文项目 earned 经验）")
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

    # ── 记录构造（§4.2）────────────────────────────────────────────────
    def new_record(self, f: dict) -> dict:
        scope = _norm_scope(f.get("scope") or "")
        if scope == "unknown":
            raise ValueError("scope 必填（领域/主题键，如 `corporate-finance/policy-evaluation`）。")
        applicable_when = (f.get("applicable_when") or "").strip()
        if not applicable_when:
            # §8.1 红线 4：没有适用条件不许入库（防负向经验过度泛化）
            raise ValueError(
                "applicable_when（适用条件）必填：请写清「在什么条件下这条经验成立」，"
                "如「处理时点交错、且存在已处理单位作为后期处理组的对照时」。"
                "没有适用条件的经验泛化出去会误导后续课题，故不允许入库。")
        stage = (f.get("stage") or "").upper().strip()
        if stage not in VALID_STAGES:
            raise ValueError(f"stage 必须是 {'/'.join(VALID_STAGES)} 之一，收到 {stage!r}。")
        kind = (f.get("kind") or "method").lower().strip()
        if kind not in IN_MEMORY_KINDS:
            raise ValueError(f"kind 必须是 {'/'.join(IN_MEMORY_KINDS)} 之一，收到 {kind!r}。")
        result = (f.get("result") or "SUCCESS").upper().strip()
        if result not in VALID_RESULTS:
            result = "PARTIAL_SUCCESS"
        try:
            conf = round(float(f.get("confidence") or 0.0), 1)
        except (TypeError, ValueError):
            conf = 0.0
        # provenance 允许两种写法：嵌套 `provenance.paper_project`（MCP 层用它），
        # 或顶层 `paper_project` / `artifacts`（脚本与自检用例的直接调用）。
        prov = dict(f.get("provenance") or {})
        paper_project = prov.get("paper_project") or f.get("paper_project") or None
        artifacts = list(prov.get("artifacts") or f.get("artifacts") or [])
        rec = {
            "id": f.get("id") or __import__("uuid").uuid4().hex,
            "scope": scope,
            "method_tags": [str(t) for t in (f.get("method_tags") or []) if str(t).strip()],
            "stage": stage,
            "kind": kind,
            "result": result,
            "confidence": conf,
            "confirmed_projects": int(f.get("confirmed_projects") or 0),
            "applicable_when": applicable_when,
            "pitfalls": [str(x) for x in (f.get("pitfalls") or [])],
            "attempts": list(f.get("attempts") or []),
            "final_recipe": f.get("final_recipe") or "",
            "positive_lessons": [str(x) for x in (f.get("positive_lessons") or [])],
            "negative_lessons": [str(x) for x in (f.get("negative_lessons") or [])],
            "tools_used": [str(x) for x in (f.get("tools_used") or [])],
            "used_experience_ids": [str(x) for x in (f.get("used_experience_ids") or [])],
            "provenance": {
                "paper_project": paper_project,
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
        return rec

    # ── 命中项（模型可见结构，摘要化）──────────────────────────────────
    def to_hit(self, src: Any) -> dict:
        p = getattr(src, "payload", None)
        if p is None:
            p = src
        return {
            "id": p.get("id") or getattr(src, "id", ""),
            "scope": p.get("scope", ""),
            "method_tags": p.get("method_tags", []),
            "stage": p.get("stage", ""),
            "kind": p.get("kind", ""),
            "result": p.get("result", ""),
            "confidence": p.get("confidence", 0),
            "confirmed_projects": p.get("confirmed_projects", 0),
            "applicable_when": p.get("applicable_when", ""),
            "positive_lessons": p.get("positive_lessons", []),
            "negative_lessons": p.get("negative_lessons", []),
            "final_recipe": p.get("final_recipe", ""),
            "pitfalls": p.get("pitfalls", []),
            "used_experience_ids": [],
        }

    # ── 检索：method_tags / stage / kind 硬过滤；scope 只做排序加权 ───────
    def build_filter(self, query: dict) -> list:
        from qdrant_client import models
        must = []
        # 过滤走归一化字段（MatchAny 精确匹配，方法标签大小写混写，见 payload()）
        tags = sorted({_tag_key(t) for t in (query.get("method_tags") or []) if str(t).strip()})
        if tags:
            must.append(models.FieldCondition(key="method_tags_norm",
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
        sc = query.get("scope")
        if sc and _norm_scope(sc) == _norm_scope(rec.get("scope", "")):
            score += 3.0
        qtags = {_tag_key(t) for t in (query.get("method_tags") or [])}
        if qtags:
            score += len(qtags & {_tag_key(t) for t in (rec.get("method_tags") or [])}) * 1.0
        if query.get("stage") and str(query["stage"]).upper() == rec.get("stage"):
            score += 1.5
        if query.get("kind") and str(query["kind"]).lower() == rec.get("kind"):
            score += 1.5
        words = [w for w in __import__("re").split(r"[\s,，;；/]+",
                                                 (query.get("text") or "").lower()) if len(w) > 1]
        if words:
            blob = " ".join([
                rec.get("scope", ""), " ".join(rec.get("method_tags") or []),
                rec.get("applicable_when", ""), " ".join(rec.get("pitfalls") or []),
                rec.get("final_recipe", ""),
                " ".join(rec.get("positive_lessons") or []),
                " ".join(rec.get("negative_lessons") or []),
            ]).lower()
            score += sum(1 for w in words if w in blob) * 1.0
        return score

    def sort_key(self, hit: dict, query: dict) -> tuple:
        sc = query.get("scope")
        scope_hit = bool(sc) and _norm_scope(sc) == _norm_scope(hit.get("scope", ""))
        return (scope_hit, float(hit.get("confidence") or 0))

    def project_key(self, rec: dict) -> str:
        return ((rec.get("provenance") or {}).get("paper_project") or "").strip()

    # ── 去重策略：D2「强化」，不替换 ────────────────────────────────────
    def merge_duplicate(self, old: dict, new: dict) -> dict:
        def union(a, b):
            out, seen = [], set()
            for x in list(a or []) + list(b or []):
                k = json.dumps(x, ensure_ascii=False, sort_keys=True) if isinstance(x, (dict, list)) else str(x)
                if k not in seen:
                    seen.add(k)
                    out.append(x)
            return out

        merged = dict(old)
        merged["positive_lessons"] = union(old.get("positive_lessons"), new.get("positive_lessons"))
        merged["negative_lessons"] = union(old.get("negative_lessons"), new.get("negative_lessons"))
        merged["pitfalls"] = union(old.get("pitfalls"), new.get("pitfalls"))
        merged["attempts"] = union(old.get("attempts"), new.get("attempts"))
        merged["method_tags"] = union(old.get("method_tags"), new.get("method_tags"))
        merged["tools_used"] = union(old.get("tools_used"), new.get("tools_used"))
        merged["used_experience_ids"] = union(old.get("used_experience_ids"),
                                              new.get("used_experience_ids"))
        merged["confidence"] = round(
            min(CONFIDENCE_MAX, max(float(old.get("confidence") or 0),
                                    float(new.get("confidence") or 0)) + CONFIDENCE_STEP), 1)

        # confirmed_projects：按论文项目去重累加（§5.3 的机械事实，R3 可审计）
        projects = set()
        po = (old.get("provenance") or {}).get("paper_project")
        pn = (new.get("provenance") or {}).get("paper_project")
        if po:
            projects.add(str(po))
        if pn:
            projects.add(str(pn))
        merged["confirmed_projects"] = int(old.get("confirmed_projects") or 0) + (1 if pn and pn != po else 0)

        # applicable_when 取更长的一条（保留更多适用边界信息）
        if len(new.get("applicable_when") or "") > len(old.get("applicable_when") or ""):
            merged["applicable_when"] = new["applicable_when"]
        if not merged.get("final_recipe") and new.get("final_recipe"):
            merged["final_recipe"] = new["final_recipe"]
        if merged.get("result") == "FAIL" and new.get("result") == "SUCCESS":
            merged["result"] = "PARTIAL_SUCCESS"   # 曾失败但已被成功路径覆盖
        merged["used_count"] = int(old.get("used_count") or 0)
        merged["updated_at"] = now_iso()
        # provenance：保留最早的来源，并记下曾在新项目复现
        prov = dict(old.get("provenance") or {})
        if pn and pn != po:
            prov["reproduced_in"] = sorted(set(list(prov.get("reproduced_in") or []) + [str(pn)]))
            prov["seed"] = bool(prov.get("seed")) and bool((new.get("provenance") or {}).get("seed"))
        merged["provenance"] = prov
        merged["feature_hash"] = old.get("feature_hash") or new.get("feature_hash")
        return merged

    def extra_stats(self, active: dict[str, dict]) -> dict:
        by_scope: dict[str, int] = {}
        by_kind: dict[str, int] = {}
        by_stage: dict[str, int] = {}
        seeds = 0
        for r in active.values():
            by_scope[r.get("scope", "?")] = by_scope.get(r.get("scope", "?"), 0) + 1
            by_kind[r.get("kind", "?")] = by_kind.get(r.get("kind", "?"), 0) + 1
            by_stage[r.get("stage", "?")] = by_stage.get(r.get("stage", "?"), 0) + 1
            if (r.get("provenance") or {}).get("seed"):
                seeds += 1
        return {
            "by_scope": dict(sorted(by_scope.items(), key=lambda kv: -kv[1])[:20]),
            "by_kind": by_kind,
            "by_stage": by_stage,
            "seed_count": seeds,
            "earned_count": len(active) - seeds,
        }


_ADAPTER = PaperAdapter()
store = ExperienceStore(_ADAPTER)

# ---------------------------------------------------------------------------
# 对外 API（与 reverse 的 memory_store 同形，字段不同）
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


def search_experiences(*, scope: str | None = None, method_tags: list[str] | None = None,
                       stage: str | None = None, kind: str | None = None,
                       features: str = "", query: str = "", top_k: int = 5) -> dict:
    q = {
        "scope": scope or "",
        "method_tags": method_tags or [],
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
    p = argparse.ArgumentParser(prog="memory_store", description="论文写作经验库自检")
    p.add_argument("cmd", choices=["stats", "readiness", "search", "save", "feedback",
                                   "cleanup", "sync", "purge"])
    p.add_argument("--scope", default="")
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
    p.add_argument("--apply", action="store_true", help="purge: 真正执行删除")
    args = p.parse_args(argv)
    try:
        if args.cmd == "stats":
            print(json.dumps(stats(), ensure_ascii=False, indent=2))
        elif args.cmd == "readiness":
            print(json.dumps(write_readiness(), ensure_ascii=False, indent=2))
        elif args.cmd == "search":
            print(json.dumps(search_experiences(
                scope=args.scope or None,
                method_tags=[t for t in args.tags.split(",") if t] or None,
                stage=args.stage or None, kind=args.kind or None,
                features=args.features, top_k=args.top_k), ensure_ascii=False, indent=2))
        elif args.cmd == "save":
            if args.confidence is None:
                print("错误: save 必须显式传 --confidence", file=sys.stderr)
                return 1
            print(json.dumps(save_experience({
                "scope": args.scope,
                "method_tags": [t for t in args.tags.split(",") if t],
                "stage": args.stage, "kind": args.kind or "method",
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
