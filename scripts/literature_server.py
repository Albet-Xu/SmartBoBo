# -*- coding: utf-8 -*-
"""literature —— 本地 MCP server，为论文写作模式提供文献检索与引用核验工具。

模型可见工具（serverName=literature-empirical → mcp__literature-empirical__literature_*）：
- literature_search(query, ...)      —— 多源检索（OpenAlex + arXiv），合并去重后落本地库
- literature_by_title(title)         —— 按标题找候选，用来**先拿到真 ID 再取详情**（不许猜 ID）
- literature_get(key)                —— 从本地库取一条完整记录
- literature_resolve(identifier)     —— 用 DOI / arXiv id 联网解析出真实记录
- literature_lookup(query)           —— **只查本地库**（离线可用，不联网）
- citation_verify(keys)              —— 核验稿子里的 `[@key]` 是否真实可查证
- literature_stats()                 —— 库统计与 `db_path`

实现单一来源：`scripts/literature_common.py`（白名单归一化、去重、SQLite 库、引用核验）。

检索类工具（search / by_title / lookup）都有 `detail="full" | "digest"`：digest 丢掉每条记录的
`abstract` / `tldr`（25 条 × 1900 字符的摘要正好压在 50KB 溢出裁剪线上），要摘要就用
`literature_get(key)` 单取，其余细节直接查 SQLite 库（`literature_stats` 里的 `db_path`）。

**降级契约（最重要的安全规则）**：联网失败时本 server **只**返回本地库能查到的内容，并在
`sources[].error` 与 `degraded` 里如实说明「本次只能查本地库」。**绝不改由模型记忆作答**——
编造引用是学术写作最严重的问题，宁可返回空。
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
from mcp.server.fastmcp import FastMCP  # noqa: E402

import literature_common as lit  # noqa: E402

# httpx 默认给每条请求打 INFO 日志，而 MCP 子进程的 stderr 会进宿主后端日志——
# 检索一次刷十几行请求日志没有价值，只留告警。
logging.getLogger("httpx").setLevel(logging.WARNING)

mcp = FastMCP("literature")

_client: httpx.Client | None = None
_store: lit.LiteratureStore | None = None


def _http() -> httpx.Client:
    """惰性建立并复用 HTTP 客户端（复用连接，尊重网络层的代理环境变量）。"""
    global _client
    if _client is None:
        _client = httpx.Client(follow_redirects=True, timeout=30.0)
    return _client


def _db() -> lit.LiteratureStore:
    global _store
    if _store is None:
        _store = lit.LiteratureStore(lit.data_dir() / "library.db")
    return _store


def _contact_email() -> str | None:
    return str(os.environ.get("LITERATURE_CONTACT_EMAIL") or "").strip() or None


def _persist(merged: dict) -> dict:
    """把检索结果落进本地库并补齐引用键。

    `merged["records"]` 保持为 `Record` 对象（库里存的是完整记录）；给模型看的那一份由调用方
    用 `lit.shape_records()` 按 `detail` 成形。
    """
    records = lit.assign_keys(merged.get("records") or [], taken=_db().all_keys())
    if records:
        try:
            merged["saved"] = _db().save(records)
        except Exception as error:  # noqa: BLE001 — 落库失败不该吞掉检索结果
            merged["saved"] = {"error": f"{type(error).__name__}: {error}"}
    return merged


def _offline_note(degraded: bool, sources: list[dict]) -> list[str]:
    if not degraded:
        return []
    details = "；".join(f"{item['source']}: {item.get('error', '无返回')}" for item in sources)
    return [
        "【联网失败】本次只能查本地库，未从外部源取到任何新文献。",
        f"各源错误：{details or '无'}",
        "**不得改由模型记忆作答**：不要凭印象补文献或引用。可先用 literature_lookup 查本地已有条目，"
        "或让用户检查网络/代理后重试。",
    ]


def _is_digest(detail: str) -> bool:
    return str(detail or "full").strip().lower() == "digest"


def _digest_next(count: int) -> str:
    """digest 版的下一步指引：摘要在 literature_get，其余细节在本地库里。"""
    return (f"以上 {count} 条是摘要版（无 abstract/tldr）。要读摘要就对真正会引用的那几条调 "
            "literature_get(key)；其余字段（卷期页、found_in、外部标识）直接查本地库，"
            "别为省事再检索一遍。")


@mcp.tool()
def literature_search(
    query: str,
    limit: int = 10,
    year_from: int | None = None,
    year_to: int | None = None,
    log_dir: str = "",
    detail: str = "full",
    abstract_chars: int = 0,
) -> dict:
    """按关键词检索真实文献（OpenAlex + arXiv 并行），合并去重后存入本地库。

    用于 S1 选题与定位阶段的文献检索。返回的每条记录都带一个 `key`——这就是正文里
    `[@key]` 要用的引用键；同时带 DOI / arXiv id 等外部标识，供 `citation_verify` 核验。
    **先按 `detail="digest"` 查**（只回标题/作者/年份/期刊/被引数，检索阶段够判取舍），
    拿到确实要引用的那几个 key 再用 `literature_get(key)` 单取摘要——25 条记录的摘要加起来
    正好顶在上下文溢出线上，一次回整包不划算。

    **只返回白名单字段**（标题、作者前 6 位、年份、期刊、DOI/arXiv、被引数、摘要截断版等），
    不会把上游的引用列表整包吐回来——那是上下文爆炸的主要来源。

    Args:
        query: 检索词（自然语言或关键词组合，如 "ESG rating cost of debt"）
        limit: 返回条数上限（1-25，默认 10）
        year_from: 起始年份（含）
        year_to: 结束年份（含）
        log_dir: 论文项目的 `01-文献/` 绝对路径。给了就把本次检索**机械地**追加进
            `search-log.jsonl`（检索式、参数、各源成败、命中键）。综述与质性研究模式的
            检索**必须留档**——它是「这篇综述到底检索过没有」的唯一凭证。**别手写这个文件。**
        detail: full（默认，完整白名单记录）/ digest（去掉每条 abstract 与 tldr，回摘要版）。
        abstract_chars: 只在 full 下生效：0（默认）沿用入库时截断的摘要；>0 表示再截到该字符数。

    Returns:
        `records`（白名单记录）、`sources`（每个源的成败与条数）、`degraded`（是否全部源失败）、
        `notes`（降级说明）、`search_log`（留档路径，传了 `log_dir` 才有）、`next`（digest 才给）。
        `degraded=true` 时**只能依赖本地库，不许凭记忆补文献**。
    """
    limit = max(1, min(int(limit or 10), lit.SEARCH_LIMIT_MAX))
    merged = lit.search(_http(), query=query, limit=limit, year_from=year_from,
                        year_to=year_to, contact_email=_contact_email())
    merged = _persist(merged)
    merged["records"] = lit.shape_records(merged.get("records") or [], detail=detail,
                                          abstract_chars=abstract_chars)
    merged["notes"] = _offline_note(merged.get("degraded", False), merged.get("sources") or [])
    merged["count"] = len(merged.get("records") or [])
    logged = lit.append_search_log(log_dir, {
        "tool": "literature_search",
        "query": query,
        "limit": limit,
        "year_from": year_from,
        "year_to": year_to,
        "sources": merged.get("sources") or [],
        "count": merged["count"],
        "degraded": merged.get("degraded", False),
        "keys": [record["key"] for record in merged.get("records") or []],
    })
    if logged:
        merged["search_log"] = logged
    if _is_digest(detail):
        merged["next"] = _digest_next(merged["count"])
    return merged


@mcp.tool()
def literature_by_title(title: str, limit: int = 5, detail: str = "full",
                        abstract_chars: int = 0) -> dict:
    """按标题找候选文献，先确认「这篇是不是它」，再去取详情。

    **绝对不要凭标题猜 DOI 或 arXiv 号**——猜错会把引用指向另一篇论文。本工具的用法是：
    拿候选、人工或按年份/期刊比对确认、记下它的 `key`，之后一律用 `key` 或 `literature_get`
    取详情。命中多条时不要随便挑第一条。`detail="digest"` 时同样只回标题级字段（无摘要），
    确认是哪一篇够用。

    Args:
        title: 文献标题（可只给前几个词）
        limit: 候选条数上限（1-25，默认 5）
        detail: full（默认）/ digest（去 abstract 与 tldr）。
        abstract_chars: 只在 full 下生效：0 沿用入库摘要，>0 再截到该字符数。
    """
    limit = max(1, min(int(limit or 5), lit.SEARCH_LIMIT_MAX))
    merged = lit.search(_http(), query=title, limit=limit, contact_email=_contact_email())
    merged = _persist(merged)

    local = _db().lookup(title, limit=limit)
    merged["local_matches"] = lit.shape_records(local, detail=detail, abstract_chars=abstract_chars)
    merged["records"] = lit.shape_records(merged.get("records") or [], detail=detail,
                                          abstract_chars=abstract_chars)
    merged["notes"] = _offline_note(merged.get("degraded", False), merged.get("sources") or [])
    if merged.get("degraded") and local:
        merged["notes"].append(
            f"本地库里有 {len(local)} 条标题相近的记录（见 local_matches），可直接用其中的 key。"
        )
    if _is_digest(detail):
        merged["next"] = _digest_next(len(merged.get("records") or []) + len(merged["local_matches"]))
    return merged


@mcp.tool()
def literature_get(key: str) -> dict:
    """按 `key`（或 DOI / arXiv id）从本地库取一条完整记录。

    用于写作阶段核对某条引用的真实信息（作者、年份、期刊）。取不到时如实返回 `found=false`
    并给出下一步——**不要因此改成凭记忆写引用**。

    Args:
        key: `literature_search` 返回的 key，或 DOI / arXiv id
    """
    record = _db().get(key)
    if record is None:
        return {
            "found": False, "key": key,
            "hint": "本地库没有这条记录。先用 literature_by_title 找到真实文献拿到 key，"
                    "或用 literature_resolve 按 DOI/arXiv id 解析；仍找不到就删掉这条引用。",
        }
    return {"found": True, "record": record.to_dict()}


@mcp.tool()
def literature_resolve(identifier: str) -> dict:
    """用 DOI 或 arXiv id 联网解析出真实记录（「给定标识 → 拿到真文献」）。

    与 `literature_by_title` 配合使用：先用标题找到候选、确认无误拿到标识，再用本工具
    解析并入库。标识格式：`10.xxxx/yyyy`（DOI）、`2401.01234`（arXiv id），也可带
    `doi:` / `arxiv:` 前缀。

    Args:
        identifier: DOI 或 arXiv id
    """
    try:
        records = lit.resolve_identifier(_http(), identifier)
    except lit.SourceError as error:
        return {
            "found": False, "identifier": identifier, "error": str(error),
            "notes": ["**联网解析失败，不得凭记忆补全这条文献的信息。**"],
        }
    if not records:
        return {"found": False, "identifier": identifier,
                "notes": ["上游没有返回这条标识对应的记录——请核对标识是否抄错。"]}
    records = lit.assign_keys(records, taken=_db().all_keys())
    _db().save(records)
    return {"found": True, "record": records[0].to_dict()}


@mcp.tool()
def literature_lookup(query: str, limit: int = 10, detail: str = "full",
                      abstract_chars: int = 0) -> dict:
    """**只查本地库**，不联网（离线可用）。

    用途：① 联网不可用时确认「我手头到底有哪些文献」；② 写作阶段查已入库条目的 key。
    查不到就说查不到——本地没有不等于这篇文献不存在，也不等于可以凭记忆写。
    列清单时用 `detail="digest"`（无摘要），要某条的摘要再 `literature_get(key)`。

    Args:
        query: 检索词（标题/作者/DOI 片段）；留空则返回最近入库的记录
        limit: 返回条数上限（1-25，默认 10）
        detail: full（默认）/ digest（去 abstract 与 tldr）。
        abstract_chars: 只在 full 下生效：0 沿用入库摘要，>0 再截到该字符数。
    """
    limit = max(1, min(int(limit or 10), lit.LOOKUP_LIMIT_MAX))
    records = _db().lookup(query, limit=limit)
    result = {
        "records": lit.shape_records(records, detail=detail, abstract_chars=abstract_chars),
        "count": len(records),
        "db_path": str(_db().db_path),
        "notes": [] if records else [
            "本地库没有匹配记录。这不代表文献不存在——它只是还没被检索入库；"
            "请用 literature_search 联网检索，**不要凭记忆直接写引用**。"
        ],
    }
    if _is_digest(detail):
        result["next"] = _digest_next(len(records))
    return result


@mcp.tool()
def citation_verify(keys: list[str]) -> dict:
    """核验稿件里的引用键：每个 `[@key]` 是否真实、可被第三方查证。

    这是**成文前的硬闸门**。三种状态：

    - `verified`：在本地库，且有 DOI / arXiv / OpenAlex 等外部标识——可查证；
    - `unverifiable`：在库但没有任何外部标识，第三方无法核实，**不许写进正文**；
    - `missing`：不在库。多半是作者名/年份记错，或这条引用根本不存在。

    `ok=false` 时必须先处理掉：补检索引、换可核验来源，或删掉这句引用。

    Args:
        keys: 要核验的引用键列表（不带 `[@]` 包裹，如 ["zhang2024esg", "li2023did"]）
    """
    cleaned = [str(key).strip().strip("[]@") for key in (keys or []) if str(key).strip()]
    if not cleaned:
        return {"ok": True, "results": [], "summary": {"verified": 0, "unverifiable": 0, "missing": 0},
                "notes": ["未提供任何 key。"]}
    report = _db().verify(cleaned)
    if not report["ok"]:
        report["notes"] = [
            "存在未通过核验的引用。请逐条处理：补检索入库、换成可核验的来源，或删掉该引用；"
            "**禁止凭记忆补文献信息**。"
        ]
    return report


@mcp.tool()
def literature_references(keys: list[str], out_dir: str, style: str = "gbt7714") -> dict:
    """把稿件用到的引用导出为项目侧台账、BibTeX 与参考文献列表（**不许手写这三份**）。

    产出三个文件到 `out_dir`：
    - `references.jsonl` —— 引用的完整记录 + `status`。**这是成文闸门要读的台账**：
      写稿件前必须先有它，且正文里每个 `[@key]` 都必须在里面且 `status=verified`。
    - `refs.bib` —— BibTeX 条目，供外部引用管理器使用。
    - `references.md` —— 按所选样式渲染好的参考文献列表，直接贴进稿件的参考文献节。

    **缺字段的条目不会被编造补齐**：上游没给卷期页就省略（绝不写空括号或占位符）。
    样式渲染是**省掉手抄的起点，不是期刊合规的保证**——姓名缩写与类型标识各期刊要求有差异，
    投稿前请按目标期刊的细则核对。

    调用后会返回 `missing`（库里查不到的键）与 `unverifiable`（没有外部标识、无法核实）。
    **这两类都不许出现在正文里。**

    Args:
        keys: 稿件里用到的全部引用键（如 ["zhang2024esg", "li2023did"]）
        out_dir: 输出目录，通常填论文项目的 `01-文献/` 绝对路径
        style: 引用样式，`gbt7714`（中文稿，默认）或 `apa`（英文稿）
    """
    if not str(out_dir or "").strip():
        return {"ok": False, "error": "out_dir 不能为空：请填论文项目的 01-文献/ 绝对路径"}
    return lit.export_references(_db(), keys or [], str(out_dir).strip(), style=str(style or "gbt7714"))


@mcp.tool()
def literature_stats() -> dict:
    """查看本地文献库统计：条数、可核验比例、年份分布、库文件路径。

    用于确认文献层是否正常工作，以及在写作前检查「已入库的文献够不够支撑综述」。
    """
    stats = _db().stats()
    stats["network"] = {
        "contact_email_set": _contact_email() is not None,
        "data_dir_override": bool(str(os.environ.get("LITERATURE_DATA_DIR") or "").strip()),
    }
    stats["notes"] = [
        "本地库只保存检索到过的文献；未检索的自然不在库里。"
        "`verifiable_ratio` 偏低说明库里混进了没有外部标识的条目，写作前值得清理。"
    ]
    return stats


def main() -> int:
    print(f"[literature] 启动，本地库 {lit.data_dir() / 'library.db'}", file=sys.stderr)
    mcp.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
