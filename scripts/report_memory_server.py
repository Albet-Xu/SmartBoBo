# -*- coding: utf-8 -*-
"""report-memory —— 本地 MCP server：文献汇报 PPT 经验库（RAG 记忆增强）。

模型可见工具（serverName=`report-memory` → `mcp__report-memory__report_experience_*`）：
- `report_experience_search`     —— 混合检索历史汇报经验（类型硬过滤 + 标签 + 语义向量）
- `report_experience_save`       —— 沉淀一条经验（置信度**严格大于** 2.0 才入库；`applicable_when` 必填）
- `report_experience_get`        —— 按 id 取单条完整详情（含 attempts；配合摘要化返回用）
- `report_experience_feedback`   —— 采纳反馈：成功 +0.5 / 失败 −0.5
- `report_experience_stats`      —— 库统计与 Qdrant 状态
- `report_experience_cleanup`    —— 冷归档未复用的旧经验（默认 dry-run）
- `report_experience_sync`       —— 把本地未同步经验重新推送到当前 Qdrant

只读模式（`REPORT_MEMORY_READONLY=1`）时只注册 search / get / stats 三个读工具。

上下文预算纪律：检索默认 `top_k=3`，且**返回摘要版**（lessons 截断、不含 attempts 明细），
需要明细时用 `report_experience_get` 二次取。

启动时后台探活一次 Qdrant，把就绪状态写进 `readiness.json`——汇报模式的
经验闸门据此判断是否启用（readiness 未就绪时闸门整体静默，不阻塞干活）。

核心实现单一来源：技能目录 `report-experience/memory_store.py`
（`$DSH_HOME/skills` > `$BOBO_ROOT/skills` > `$BOBO_ROOT/bobo-data/dsh/skills` > 项目 `dsh/.agents/skills` > 脚本同目录）。
"""
from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

# ── 定位 memory_store（技能目录为单一实现来源，多路径兜底）──────────────────
_CANDS = []
_dsh_home = os.environ.get("DSH_HOME")
_bobo_root = os.environ.get("BOBO_ROOT")
if _dsh_home:
    _CANDS.append(Path(_dsh_home) / "skills" / "report-experience")
if _bobo_root:
    _CANDS.append(Path(_bobo_root) / "skills" / "report-experience")
    _CANDS.append(Path(_bobo_root) / "bobo-data" / "dsh" / "skills" / "report-experience")
_CANDS += [
    Path(__file__).resolve().parent.parent / "dsh" / ".agents" / "skills" / "report-experience",
    Path(__file__).resolve().parent,
]
for _c in _CANDS:
    if (_c / "memory_store.py").is_file():
        sys.path.insert(0, str(_c))
        # 共享机制层与技能目录同级，需一并入路径
        _sib = _c.parent / "experience-store"
        if (_sib / "experience_store.py").is_file():
            sys.path.insert(0, str(_sib))
        break
else:  # pragma: no cover
    print("[report-memory] 找不到 report-experience/memory_store.py", file=sys.stderr)
    raise SystemExit(2)

from mcp.server.fastmcp import FastMCP  # noqa: E402
import memory_store as store          # noqa: E402


def _probe_readiness() -> None:
    try:
        store.probe_and_write_readiness()
    except Exception as e:  # noqa: BLE001
        print(f"[report-memory] 就绪探活失败: {e}", file=sys.stderr)


threading.Thread(target=_probe_readiness, daemon=True).start()

READONLY = store.is_readonly()
mcp = FastMCP("report-memory")

if READONLY:
    print("[report-memory] 只读模式——仅注册查询工具", file=sys.stderr)


# ── 摘要化工具（控制上下文预算）────────────────────────────────────────────
_LESSON_MAX = 3
_LESSON_CHARS = 160


def _summary(hit: dict) -> dict:
    def cut(xs):
        out = [str(x)[:_LESSON_CHARS] for x in (xs or [])[:_LESSON_MAX]]
        more = max(0, len(xs or []) - _LESSON_MAX)
        if more:
            out.append(f"…另有 {more} 条（用 report_experience_get 取全量）")
        return out

    return {
        "id": hit.get("id", ""),
        "report_type": hit.get("report_type", ""),
        "tags": hit.get("tags", []),
        "stage": hit.get("stage", ""),
        "kind": hit.get("kind", ""),
        "result": hit.get("result", ""),
        "confidence": hit.get("confidence", 0),
        "confirmed_projects": hit.get("confirmed_projects", 0),
        "language": hit.get("language", ""),
        "page_roles": hit.get("page_roles", []),
        "applicable_when": (hit.get("applicable_when") or "")[:_LESSON_CHARS * 2],
        "positive_lessons": cut(hit.get("positive_lessons")),
        "negative_lessons": cut(hit.get("negative_lessons")),
    }


@mcp.tool()
def report_experience_search(
    report_type: str = "",
    tags: list[str] | None = None,
    stage: str = "",
    kind: str = "",
    features: str = "",
    query: str = "",
    top_k: int = 3,
) -> dict:
    """检索历史文献汇报 PPT 经验（RAG 记忆增强）。

    在**能改变决策**的位置调用：R0 定盘后（叙事骨架与页数取舍）、R3 页策划前（版式与视觉的坑）、
    R5 评分返修后（常见扣分点）。**R4 生成阶段不要查**——那会诱导把经验写进页面正文。

    Args:
        report_type: 汇报类型，**硬过滤**：`single`（单篇精读）/`multi`（多篇对比）/
            `seminar`（组会进展）/`proposal`（开题选题）/`survey`（综述式）。
            组会与开题踩的坑几乎不通用，检索时务必传对。
        tags: 标签，如 ["文字溢出","图表错配","页数超限"]、["对比矩阵","共同结论"]
        stage: 限定阶段 R0–R6（可选，硬过滤）
        kind: 限定类别 narrative/content/visual/review/process/pipeline（可选，硬过滤）
        features: 汇报特征文本（并入语义检索），如「15 页 / 中文 / 2 篇实证论文」
        query: 自由检索词（缺省取 features）
        top_k: 返回条数（默认 3，上限 10）

    返回摘要版（lessons 截断、不含 attempts 明细）；需要某条完整内容时用
    `report_experience_get(id)`。`mode=local` 表示 Qdrant 不可达已降级本地检索，
    **覆盖面会明显小于向量检索**。

    检索结果仅作**待验证假设**，必须结合本次汇报实测确认，禁止直接照搬。
    """
    r = store.search_experiences(
        report_type=report_type or None,
        tags=tags or None,
        stage=stage or None,
        kind=kind or None,
        features=features,
        query=query,
        top_k=max(1, min(int(top_k or 3), 10)),
    )
    return {
        "count": r["count"],
        "mode": r["mode"],
        "items": [_summary(h) for h in r["items"]],
        "note": ("mode=local 表示 Qdrant 不可达、已降级本地检索，覆盖面明显变小；"
                 "结果仅供启发，必须结合本次汇报实测验证，禁止照搬。"),
    }


def report_experience_save(
    report_type: str,
    applicable_when: str,
    stage: str,
    *,
    confidence: float,
    tags: list[str] | None = None,
    kind: str = "narrative",
    result: str = "SUCCESS",
    language: str = "",
    page_roles: list[str] | None = None,
    pitfalls: list[str] | None = None,
    attempts: list[dict] | None = None,
    final_recipe: str = "",
    positive_lessons: list[str] | None = None,
    negative_lessons: list[str] | None = None,
    tools_used: list[str] | None = None,
    used_experience_ids: list[str] | None = None,
    report_project: str = "",
    artifacts: list[str] | None = None,
) -> dict:
    """沉淀一条文献汇报 PPT 经验（自动入库）。

    在 **R5 评分返修后** 与 **R6 交付前**调用（收尾必做）。

    **迁移判据（硬判据，先自问再调用）**：这条经验**换几篇论文、换一个汇报场合之后还成立吗？**
    不成立就不沉淀。本次特有的细节（"阳虎那篇的 Figure 4 是溢出图"）毫无迁移价值，
    收了就是噪音。**候选草稿里的大部分条目本来就该被毙掉**，这是设计意图。

    入库门槛：`confidence` **严格大于 2.0**；等于或低于 2.0 直接放弃、不留任何文件。
    锚点（按「跨汇报复现数」，不按跑通次数）：本次试了一次=2.0（会被丢弃）；
    反复验证或两个独立证据点=2.5；与**公开的演示设计规范**一致=3.0；
    **跨汇报复现过**（≥2 个汇报项目）=3.5–5。
    同指纹再次入库走**强化**（lessons 并集、confidence = max(旧,新)+0.5、confirmed_projects 累加），
    不会产生重复条目。

    Args:
        report_type: 汇报类型，必填：single/multi/seminar/proposal/survey
        applicable_when: **适用条件，必填**——写清「在什么条件下这条经验成立」。
            没有适用条件的经验泛化出去会误导后续汇报，服务端会直接拒绝。
        stage: 挂在哪一步，R0–R6
        confidence: 必填，1–5，须严格大于 2.0
        tags: 标签（推荐写「现象」而不是「结论」，如 `文字溢出`、`图表错配`）
        kind: narrative / content / visual / review / process / pipeline
        result: SUCCESS / FAIL / PARTIAL_SUCCESS
        language: zh / en（缺省不限）
        page_roles: 作用在哪些页角色上，如 ["result","compare"]
        pitfalls: 踩到的具体坑
        attempts: 尝试过的方案 [{"method":…,"result":"success|fail","note":…}]
        final_recipe: 最终可行做法
        positive_lessons / negative_lessons: 经验与教训
        tools_used: 涉及工具
        used_experience_ids: 本次参考过的历史经验 id（供后续反馈）
        report_project: 汇报项目目录名（**审计用**，不填则 confirmed_projects 无法累加）
        artifacts: 产物定位，如 ["04-评审/score.json#visual"]
    """
    return store.save_experience({
        "report_type": report_type,
        "tags": tags or [],
        "stage": stage,
        "kind": kind,
        "result": result,
        "confidence": confidence,
        "language": language,
        "page_roles": page_roles or [],
        "applicable_when": applicable_when,
        "pitfalls": pitfalls or [],
        "attempts": attempts or [],
        "final_recipe": final_recipe,
        "positive_lessons": positive_lessons or [],
        "negative_lessons": negative_lessons or [],
        "tools_used": tools_used or [],
        "used_experience_ids": used_experience_ids or [],
        "provenance": {"report_project": report_project or None,
                       "artifacts": artifacts or [], "seed": False},
    })


@mcp.tool()
def report_experience_get(experience_id: str) -> dict:
    """按 id 取一条经验的**完整详情**（含 attempts 与 pitfalls 明细）。

    摘要化的 `report_experience_search` 只回截断版；确认某条值得细看时，用本工具取全量。

    Args:
        experience_id: search 结果里的 id
    """
    reg = store.store.load_registry() if hasattr(store, "store") else {}
    rec = reg.get(experience_id)
    if rec is None:
        return {"found": False, "id": experience_id,
                "message": "本地 registry 里没有这条（可能尚未同步到本机，或被合并/清理）。"}
    return {"found": True, "record": rec}


@mcp.tool()
def report_experience_stats() -> dict:
    """查看文献汇报经验库统计与 Qdrant 状态（只读）。

    返回：Qdrant 是否可达、集合名、入库门槛、本地活跃/归档条数、Qdrant 点数、
    按 report_type/kind/stage/language 分布，以及 `seed_count`（技能种子条数）与
    `earned_count`（真实汇报项目沉淀条数）——后者是判断这个库"有没有真的长起来"的关键指标。
    """
    return store.stats()


def report_experience_feedback(experience_id: str, outcome: str = "success") -> dict:
    """对采纳过的历史经验做正负反馈（置信度在线打分）。

    参考过某条经验后调用：采纳且成功 → +0.5；采纳后失败 → −0.5
    （跌到门槛 2.0 及以下自动出库并归档）。让靠谱经验越用越靠前。

    **评分返修后必须调**：本轮参考过的每条经验，按它是否真的帮上了忙打 success / fail。
    这是经验池唯一能自我进化的入口——不打分，池子只会越积越多的死档案。

    Args:
        experience_id: 检索返回的 id
        outcome: "success" / "fail"
    """
    return store.feedback_experience(experience_id, outcome)


def report_experience_cleanup(dry_run: bool = True) -> dict:
    """冷归档长期未被复用且置信度不高的旧经验（默认 dry-run 只预览）。

    Args:
        dry_run: True 只列清单；False 实际从 Qdrant 移除并归档本地
    """
    return store.cleanup(dry_run=dry_run)


def report_experience_sync() -> dict:
    """把本地未归档经验重新推送到当前 Qdrant（换服务器/断连恢复后使用）。幂等。"""
    return store.sync_local_to_qdrant()


# 写工具仅在读写实例注册（只读实例只暴露读工具）——双保险：memory_store 内部同样拒绝写
if not READONLY:
    mcp.tool()(report_experience_save)
    mcp.tool()(report_experience_feedback)
    mcp.tool()(report_experience_cleanup)
    mcp.tool()(report_experience_sync)


def main() -> int:
    mcp.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
