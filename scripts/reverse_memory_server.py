# -*- coding: utf-8 -*-
"""reverse-memory —— 本地 MCP server，为逆向/工作流模式提供「逆向经验记忆库（RAG）」工具。

模型可见工具（serverName=reverse-memory → mcp__reverse-memory__*）：
- reverse_memory_search(domain, tags, features, query, top_k)   —— 混合检索历史逆向经验
- reverse_memory_save(...)                                      —— 沉淀一条逆向经验（置信度>=1.8 才入库）
- reverse_memory_feedback(experience_id, outcome)              —— 采纳反馈：成功+0.5 / 失败-0.5
- reverse_memory_stats()                                        —— 库统计与 Qdrant 状态
- reverse_memory_cleanup(dry_run)                              —— 冷归档未复用的旧案例

只读模式：环境变量 REVERSE_MEMORY_READONLY=1 时（工作流模式预设配置），
不注册 save / feedback / cleanup 三个写工具，模型只能查询。

核心实现单一来源：技能目录 memory_store.py（~/.dsh/skills/reverse-experience/
> 项目 dsh/.agents/skills/reverse-experience/ > scripts/ 同目录 依次回退）。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# ── 导入 memory_store（技能目录为单一实现来源；找不到时回退脚本同目录） ─────────
# 查找顺序：DSH_HOME（桌面壳/打包版用户数据根）> 旧 ~/.dsh > 项目 .agents > 脚本同目录。
_dsh_home = os.environ.get("DSH_HOME")
_SKILL_DIR = Path(_dsh_home) / "skills" / "reverse-experience" if _dsh_home else None
if not _SKILL_DIR or not _SKILL_DIR.is_dir():
    _SKILL_DIR = Path.home() / ".dsh" / "skills" / "reverse-experience"
if not _SKILL_DIR.is_dir():
    _SKILL_DIR = Path(__file__).resolve().parent.parent / "dsh" / ".agents" / "skills" / "reverse-experience"
if not _SKILL_DIR.is_dir():
    _SKILL_DIR = Path(__file__).resolve().parent
if str(_SKILL_DIR) not in sys.path:
    sys.path.insert(0, str(_SKILL_DIR))

from mcp.server.fastmcp import FastMCP  # noqa: E402

import memory_store as store  # noqa: E402

READONLY = store.is_readonly()

mcp = FastMCP("reverse-memory")

if READONLY:
    print("[reverse-memory] 只读模式（工作流）—— 仅注册查询工具", file=sys.stderr)


@mcp.tool()
def reverse_memory_search(
    domain: str = "",
    tags: list[str] | None = None,
    features: str = "",
    query: str = "",
    top_k: int = 5,
) -> dict:
    """从逆向经验库检索相似历史案例（RAG 记忆增强）。

    逆向新站点前先调用本工具：传目标域名（精确优先）、已知的反爬/技术标签
    （如 ["js混淆","obfuscator.io","时间戳签名","cloudflare","wasm加密","行为风控"]）、
    以及观察到的特征文本（如 "webmssdk / X-Bogus / a_bogus / 412"）。

    返回历史案例（含置信度、正向经验、失败教训、最终方案），仅作参考思路，
    必须结合当前站点实测验证，禁止直接照搬。置信度 >= 1.8 才入库，检索只会
    看到高置信案例。Qdrant 不可达时自动降级为本地检索（mode=local）。

    Args:
        domain: 目标域名（如 example.com），精确过滤优先
        tags: 反爬/技术标签，做元数据过滤
        features: 站点特征文本（并入语义检索）
        query: 自由检索词（缺省取 features）
        top_k: 返回条数（默认 5）
    """
    return store.search_experiences(
        domain=domain or None,
        tags=tags or None,
        features=features,
        query=query,
        top_k=max(1, min(top_k, 10)),
    )


def reverse_memory_save(
    domain: str,
    url: str = "",
    title: str = "",
    tags: list[str] | None = None,
    anti_crawl: list[str] | None = None,
    attempts: list[dict] | None = None,
    final_solution: str = "",
    positive_lessons: list[str] | None = None,
    negative_lessons: list[str] | None = None,
    result: str = "SUCCESS",
    confidence: float = 2.0,
    tools_used: list[str] | None = None,
    used_experience_ids: list[str] | None = None,
) -> dict:
    """沉淀一条逆向经验（自动入库）。

    逆向任务结束（成功/失败都要沉淀）后调用。置信度 >= 1.8 才会入库
    （本地 MD 日志 + Qdrant 向量）；< 1.8 直接放弃、不留任何文件。同域名同特征
    指纹的旧案例自动去重替换，避免知识库膨胀。

    Args:
        domain: 目标域名（必填）
        url: 目标网址
        title: 页面/任务标题
        tags: 任务标签，如 ["js混淆","wasm加密","签名参数","行为风控","cloudflare"]
        anti_crawl: 识别到的反爬手段列表
        attempts: 尝试过的方案，[{"method": "方案描述", "result": "success|fail", "note": "原因/结果"}]
        final_solution: 最终可行方案（无则留空）
        positive_lessons: 经验总结（正向），如 "碰到 x 特征优先做 AST 去混淆"
        negative_lessons: 教训总结（负向），如 "不要只改 UA，必须同步处理 TLS 指纹"
        result: SUCCESS / FAIL / PARTIAL_SUCCESS
        confidence: 置信度 1-5（1=偶然结果，5=多次验证可靠），>= 1.8 才入库
        tools_used: 使用过的工具（js-reverse / camoufox / scrapling / AST 等）
        used_experience_ids: 本次参考过的历史经验 ID（用于后续反馈）
    """
    return store.save_experience({
        "domain": domain, "url": url, "title": title,
        "tags": tags or [], "anti_crawl": anti_crawl or [],
        "attempts": attempts or [], "final_solution": final_solution,
        "positive_lessons": positive_lessons or [],
        "negative_lessons": negative_lessons or [],
        "result": result, "confidence": confidence,
        "tools_used": tools_used or [], "used_experience_ids": used_experience_ids or [],
    })


def reverse_memory_feedback(experience_id: str, outcome: str = "success") -> dict:
    """对采纳过的历史经验做正负反馈（置信度在线打分）。

    使用某条检索到的经验后调用：采纳且成功 → 该案例置信度 +0.5；采纳后失败
    → -0.5（跌破 1.8 自动从向量库移除并归档）。让靠谱案例越用越靠前，不靠谱
    案例慢慢下沉。

    Args:
        experience_id: 检索返回的案例 id
        outcome: "success" / "fail"
    """
    return store.feedback_experience(experience_id, outcome)


@mcp.tool()
def reverse_memory_stats() -> dict:
    """查看逆向经验库统计与 Qdrant 状态（只读）。

    返回：Qdrant 是否可达、集合名、入库门槛、本地活跃/归档条数、Qdrant 点数、
    按结果/标签分布。用于确认记忆库是否正常工作。
    """
    return store.stats()


def reverse_memory_cleanup(dry_run: bool = True) -> dict:
    """冷归档长期未被复用且置信度不高的旧案例（默认 dry-run 只预览）。

    Args:
        dry_run: True 只列出待归档案例不执行；False 实际从 Qdrant 移除并归档
    """
    return store.cleanup(dry_run=dry_run)


def reverse_memory_sync() -> dict:
    """把本地未归档的逆向经验重新同步到当前 Qdrant（服务器更换/断连恢复后使用）。

    幂等：以经验 id 为 point id，重复同步只会覆盖不会产生重复。
    """
    return store.sync_local_to_qdrant()


# 写工具仅在读写实例注册（只读实例只暴露 search/stats）——双保险：
# memory_store 内部 is_readonly 同样拒绝写操作。
if not READONLY:
    mcp.tool()(reverse_memory_save)
    mcp.tool()(reverse_memory_feedback)
    mcp.tool()(reverse_memory_cleanup)
    mcp.tool()(reverse_memory_sync)


def main() -> int:
    mcp.run()


if __name__ == "__main__":
    raise SystemExit(main())