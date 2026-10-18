# -*- coding: utf-8 -*-
"""literature_common —— 文献层的实现单一来源（被 literature_server.py 引用，可独立测试）。

设计要点（对应 `docs/研究模式调研/01-论文写作功能与四模式实现方案.md` §4.5）：

- **字段白名单**：外部源的返回体一概先过 `normalize_*`，只留白名单字段，作者与摘要截断。
  这是防上下文爆炸的第一道闸——上游一个 `fields=citations` 就能一次吐回 20 万字符。
- **绝不猜 ID**：工具只接受已存在的 id/key；用户给标题时先走 `literature_by_title` 拿候选，
  由模型挑选后再取详情。
- **显式降级**：任一源失败都记进 `sources[].error` 如实回给模型；**全部失败时明确声明
  「本次只能查本地库」，绝不允许改由模型记忆作答**。这是本层最重要的安全规则。
- **本地库是 SQLite 单一文件**（FTS5 全文检索）。刻意**不引入 Qdrant/向量层**：
  文献检索以标题/作者/DOI 等元数据为主，不是语义问题；而 Qdrant 是可选基础设施，
  论文模式不该硬依赖它。需要语义检索时再叠加，本地库这套结构可以直接复用。
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Iterable, Sequence

# ── 白名单与上限（防上下文爆炸）──────────────────────────────────────────────
WHITELIST_FIELDS = (
    "key", "title", "authors", "year", "venue", "volume", "issue", "pages", "doi", "arxiv_id",
    "openalex_id", "s2_id", "url", "citation_count", "is_open_access",
    "fields_of_study", "abstract", "tldr", "found_in",
)
# `detail="digest"` 时保留的字段：摘要与 tldr 是记录里的上下文大头（单条可达 1900 字符），
# 检索阶段"这条是不是我要的"靠标题/作者/年份/期刊/被引数就够了，所以摘要在 digest 里被丢掉。
DIGEST_FIELDS = (
    "key", "title", "authors", "year", "venue", "doi", "arxiv_id",
    "citation_count", "is_open_access", "fields_of_study", "url",
)
AUTHOR_LIMIT = 6
ABSTRACT_LIMIT = 1500
FIELD_OF_STUDY_LIMIT = 5
TLDR_LIMIT = 400
SEARCH_LIMIT_MAX = 25
LOOKUP_LIMIT_MAX = 25

OPENALEX_ENDPOINT = "https://api.openalex.org/works"
ARXIV_ENDPOINT = "http://export.arxiv.org/api/query"
USER_AGENT = "BoBo-Literature/0.1 (+https://example.invalid; local research assistant)"

ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV_NS = "{http://arxiv.org/schemas/atom}"


class SourceError(RuntimeError):
    """某一外部文献源不可用（网络/限流/返回体异常）。由调用方汇总后如实回报。"""


# ── 文本工具 ────────────────────────────────────────────────────────────────
def _text(value: Any) -> str | None:
    """把任意值收成干净的单行字符串；空值返回 None（**不要用空串冒充有值**）。"""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        value = " ".join(str(item) for item in value if item)
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def _truncate(value: str | None, limit: int) -> str | None:
    if value is None or len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def _year(value: Any) -> int | None:
    if isinstance(value, int):
        return value if 1000 < value < 3000 else None
    match = re.search(r"(1[5-9]\d\d|20\d\d|21\d\d)", str(value or ""))
    return int(match.group(1)) if match else None


def surname(name: str) -> str:
    """取姓的 ASCII 形式，用于生成引用键；中文姓名整段转拼音不可行，故退化处理。"""
    cleaned = _text(name) or ""
    # "Zhang, Wei" / "Wei Zhang" / "Zhang Wei"
    if "," in cleaned:
        cleaned = cleaned.split(",", 1)[0]
    else:
        parts = cleaned.split()
        cleaned = parts[-1] if parts else cleaned
    folded = unicodedata.normalize("NFKD", cleaned).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z]", "", folded).lower()


def citation_key(title: str, authors: Sequence[str], year: int | None, taken: Iterable[str] = ()) -> str:
    """生成 `[@key]` 用的引用键：`<姓><年><标题首词>`，与已用键冲突时追加字母。

    键必须稳定且**可读**——它会被写进正文，用 DOI 当键会让稿源没法读。
    """
    taken_set = {str(item) for item in taken}
    first = surname(authors[0]) if authors else "anon"
    year_part = str(year) if year else "nd"
    words = [re.sub(r"[^a-z]", "", word.lower()) for word in re.findall(r"[A-Za-z]+", title or "")]
    topic = next((word for word in words if len(word) > 2 and word not in _STOPWORDS), "")
    base = f"{first}{year_part}{topic}"[:40] or "ref"
    if base not in taken_set:
        return base
    for suffix in "abcdefghijklmnopqrstuvwxyz":
        candidate = f"{base}{suffix}"
        if candidate not in taken_set:
            return candidate
    return f"{base}{len(taken_set)}"


_STOPWORDS = {
    "the", "and", "for", "with", "from", "into", "its", "their", "that", "this",
    "are", "was", "were", "does", "how", "why", "what", "when", "evidence", "study",
    "effect", "effects", "analysis", "research", "paper", "using", "based",
}


# ── 内部记录（存储与返回共用同一种形状）──────────────────────────────────────
@dataclass
class Record:
    """一张文献卡。字段就是白名单，别在这里加"顺手多存点"的字段。"""

    key: str
    title: str
    authors: list[str]
    year: int | None = None
    venue: str | None = None
    # 卷 / 期 / 页：渲染参考文献必需，缺了就只能省略（绝不补占位符）
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    openalex_id: str | None = None
    s2_id: str | None = None
    url: str | None = None
    citation_count: int | None = None
    is_open_access: bool | None = None
    fields_of_study: list[str] | None = None
    abstract: str | None = None
    tldr: str | None = None
    found_in: list[str] | None = None
    verified: bool = False
    saved_at: str | None = None

    def to_dict(self) -> dict:
        data = {field: getattr(self, field) for field in WHITELIST_FIELDS}
        data["authors"] = list(self.authors)
        data["fields_of_study"] = list(self.fields_of_study or [])
        data["found_in"] = list(self.found_in or [])
        return data

    def ids(self) -> dict[str, str]:
        return {
            name: value
            for name, value in (("doi", self.doi), ("arxiv_id", self.arxiv_id),
                                ("openalex_id", self.openalex_id), ("s2_id", self.s2_id))
            if value
        }

    def strong_id(self) -> str | None:
        """可判定同一篇文献的最强标识（拿不到就只能靠标题归一化）。"""
        for name in ("doi", "arxiv_id", "openalex_id", "s2_id"):
            value = getattr(self, name)
            if value:
                return f"{name}:{value}"
        return None


# ── 记录成形（检索阶段的上下文预算） ────────────────────────────────────────
def digest_record(record: "Record | dict") -> dict:
    """把一条记录收成 digest 版：只留 `DIGEST_FIELDS`，**丢掉 abstract 与 tldr**。

    这是「在源头收敛上下文」的那一刀：25 条 × 每条 ≤1900 字符的摘要 ≈ 45KB，正好顶在 dsh 的
    50KB 溢出裁剪线上；检索阶段本来也判不了摘要，要读摘要就用 `literature_get(key)` 单取那几条。
    传入 `Record` 或普通 dict 都可以，非映射输入按空记录处理（不外抛）。
    """
    if hasattr(record, "to_dict"):
        data = record.to_dict()
    else:
        try:
            data = dict(record or {})
        except (TypeError, ValueError):
            data = {}
    shaped: dict = {}
    for field in DIGEST_FIELDS:
        value = data.get(field)
        shaped[field] = list(value) if isinstance(value, list) else value
    return shaped


def cap_text(value: str | None, limit: int) -> str | None:
    """按 `limit` 截断文本；`limit <= 0` 表示不截断（沿用入库时的 `ABSTRACT_LIMIT`）。"""
    if not limit or limit <= 0:
        return value
    return _truncate(value, limit)


def shape_records(records: Sequence["Record | dict"], *, detail: str = "full",
                  abstract_chars: int = 0) -> list[dict]:
    """按调用方要求把记录成形：`full`（默认，今天的行为）/ `digest`（去摘要）。

    `abstract_chars` 只在 `full` 下生效：0 表示沿用入库时已截断的摘要，>0 表示再截短到该长度
    （不丢摘要、只压长度）。
    """
    digest = str(detail or "full").strip().lower() == "digest"
    out: list[dict] = []
    for record in records or []:
        if digest:
            out.append(digest_record(record))
            continue
        if abstract_chars and abstract_chars > 0:
            if isinstance(record, Record):
                data = replace(record, abstract=cap_text(record.abstract, abstract_chars)).to_dict()
            else:
                data = dict(record or {})
                data["abstract"] = cap_text(data.get("abstract"), abstract_chars)
            out.append(data)
            continue
        out.append(record.to_dict() if hasattr(record, "to_dict") else dict(record or {}))
    return out


def _pick(work: dict, *names: str) -> Any:
    for name in names:
        if isinstance(work, dict) and work.get(name) is not None:
            return work[name]
    return None


def normalize_openalex(work: dict) -> Record:
    """OpenAlex work → 白名单记录。上游字段名见 api.openalex.org/works。"""
    ids = work.get("ids") if isinstance(work.get("ids"), dict) else {}
    doi = _text(_pick(work, "doi") or ids.get("doi"))
    if doi:
        doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi).lower()
    authors = [
        _text((item.get("author") or {}).get("display_name"))
        for item in (work.get("authorships") or [])
        if isinstance(item, dict)
    ]
    authors = [name for name in authors if name]
    abstract = _abstract_from_inverted_index(work.get("abstract_inverted_index"))
    venue = _text(((work.get("primary_location") or {}).get("source") or {}).get("display_name"))
    biblio = work.get("biblio") if isinstance(work.get("biblio"), dict) else {}
    first_page = _text(biblio.get("first_page"))
    last_page = _text(biblio.get("last_page"))
    pages = (f"{first_page}-{last_page}" if first_page and last_page and first_page != last_page
             else (first_page or last_page))
    return Record(
        key="",
        title=_text(_pick(work, "title", "display_name")) or "(untitled)",
        authors=authors[:AUTHOR_LIMIT],
        year=_year(_pick(work, "publication_year", "publication_date")),
        venue=venue,
        volume=_text(biblio.get("volume")),
        issue=_text(biblio.get("issue")),
        pages=pages,
        doi=doi,
        openalex_id=_text(_pick(work, "id")),
        url=_text((work.get("primary_location") or {}).get("landing_page_url")) or _text(work.get("id")),
        citation_count=_pick(work, "cited_by_count"),
        is_open_access=_pick(work, "open_access", "is_oa") if isinstance(_pick(work, "open_access"), bool) else (
            (work.get("open_access") or {}).get("is_oa") if isinstance(work.get("open_access"), dict) else None
        ),
        fields_of_study=[
            _text(item.get("display_name"))
            for item in (work.get("topics") or work.get("concepts") or [])[:FIELD_OF_STUDY_LIMIT]
            if isinstance(item, dict) and item.get("display_name")
        ],
        abstract=_truncate(abstract, ABSTRACT_LIMIT),
        found_in=["openalex"],
    )


def _abstract_from_inverted_index(index: Any) -> str | None:
    """OpenAlex 把摘要存成「词 → 位置列表」，这里还原成文本。"""
    if not isinstance(index, dict) or not index:
        return None
    positions: list[tuple[int, str]] = []
    for word, spots in index.items():
        if not isinstance(spots, list):
            continue
        for spot in spots:
            if isinstance(spot, int):
                positions.append((spot, word))
    if not positions:
        return None
    positions.sort()
    return " ".join(word for _, word in positions)


def parse_arxiv_feed(xml_text: str, limit: int = SEARCH_LIMIT_MAX) -> list[Record]:
    """arXiv Atom feed → 白名单记录。用 stdlib 解析，不引入 XML 依赖。"""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as error:
        raise SourceError(f"arXiv 返回体不是合法 XML: {error}") from error

    records: list[Record] = []
    for entry in root.findall(f"{ATOM}entry")[:limit]:
        title = _text(entry.findtext(f"{ATOM}title")) or "(untitled)"
        raw_id = _text(entry.findtext(f"{ATOM}id")) or ""
        arxiv_id = raw_id.rsplit("/", 1)[-1] if raw_id else None
        if arxiv_id:
            arxiv_id = re.sub(r"v\d+$", "", arxiv_id)
        doi = _text(entry.findtext(f"{ARXIV_NS}doi"))
        authors = [
            _text(node.findtext(f"{ATOM}name"))
            for node in entry.findall(f"{ATOM}author")
        ]
        authors = [name for name in authors if name]
        primary = entry.find(f"{ARXIV_NS}primary_category")
        records.append(Record(
            key="",
            title=title,
            authors=authors[:AUTHOR_LIMIT],
            year=_year(entry.findtext(f"{ATOM}published")),
            venue="arXiv",
            doi=doi.lower() if doi else None,
            arxiv_id=arxiv_id,
            url=raw_id or None,
            is_open_access=True,
            fields_of_study=[_text(primary.get("term"))] if primary is not None and primary.get("term") else [],
            abstract=_truncate(_text(entry.findtext(f"{ATOM}summary")), ABSTRACT_LIMIT),
            found_in=["arxiv"],
        ))
    return records


def dedupe(records: Sequence[Record]) -> list[Record]:
    """按强标识（doi > arxiv > openalex > s2）去重，其次按归一化标题。

    同一篇文献从两个源回来时合并成一条，`found_in` 取并集——让模型看见"这个结论有两个源
    都收录了"，而不是看到两条一模一样的条目。
    """
    merged: dict[str, Record] = {}
    by_title: dict[str, str] = {}

    def title_key(record: Record) -> str:
        return re.sub(r"[^a-z0-9]", "", (record.title or "").lower())[:120]

    for record in records:
        strong = record.strong_id()
        slot = strong or by_title.get(title_key(record))
        if slot is None:
            slot = f"title:{title_key(record)}"
        existing = merged.get(slot)
        if existing is None:
            merged[slot] = record
            by_title[title_key(record)] = slot
            continue
        # 合并：补齐空缺字段，来源取并集，引用数取大
        for field in WHITELIST_FIELDS:
            if field in ("key", "title", "authors", "found_in"):
                continue
            if getattr(existing, field) in (None, "", []) and getattr(record, field) not in (None, "", []):
                setattr(existing, field, getattr(record, field))
        if not existing.authors and record.authors:
            existing.authors = record.authors
        if (record.citation_count or 0) > (existing.citation_count or 0):
            existing.citation_count = record.citation_count
        existing.found_in = sorted({*(existing.found_in or []), *(record.found_in or [])})
        by_title.setdefault(title_key(record), slot)
    return list(merged.values())


def filter_by_year(records: Sequence[Record], year_from: int | None, year_to: int | None) -> list[Record]:
    if year_from is None and year_to is None:
        return list(records)
    kept = []
    for record in records:
        if record.year is None:
            # 年份未知的不因为区间过滤被丢掉——如实保留，让模型自己判断
            kept.append(record)
            continue
        if year_from is not None and record.year < year_from:
            continue
        if year_to is not None and record.year > year_to:
            continue
        kept.append(record)
    return kept


def assign_keys(records: Sequence[Record], taken: Iterable[str] = ()) -> list[Record]:
    """给还没有 key 的记录分配引用键（原地），并保证会话内不重复。"""
    used = {str(item) for item in taken}
    for record in records:
        if not record.key:
            record.key = citation_key(record.title, record.authors, record.year, used)
        used.add(record.key)
    return list(records)


# ── 外部源 ──────────────────────────────────────────────────────────────────
def openalex_search(client, query: str, limit: int, year_from: int | None = None,
                    year_to: int | None = None, contact_email: str | None = None) -> list[Record]:
    """按关键词检索 OpenAlex。`client` 需有 `get(url, params=..., timeout=...)`（httpx 形态）。"""
    params: dict[str, Any] = {"search": query, "per-page": max(1, min(limit, 50))}
    if contact_email:
        params["mailto"] = contact_email
    filters = []
    if year_from:
        filters.append(f"from_publication_date:{year_from}-01-01")
    if year_to:
        filters.append(f"to_publication_date:{year_to}-12-31")
    if filters:
        params["filter"] = ",".join(filters)
    try:
        response = client.get(OPENALEX_ENDPOINT, params=params, timeout=30.0,
                              headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        response.raise_for_status()
        payload = response.json()
    except Exception as error:  # noqa: BLE001 — 一律转成 SourceError，由上层如实回报
        raise SourceError(f"{type(error).__name__}: {error}") from error
    if not isinstance(payload, dict):
        raise SourceError("OpenAlex 返回体不是 JSON 对象")
    return [normalize_openalex(work) for work in payload.get("results") or [] if isinstance(work, dict)]


def arxiv_search(client, query: str, limit: int) -> list[Record]:
    """按关键词检索 arXiv（Atom feed）。"""
    params = {
        "search_query": f"all:{query}",
        "start": 0,
        "max_results": max(1, min(limit, 50)),
        "sortBy": "relevance",
    }
    try:
        response = client.get(ARXIV_ENDPOINT, params=params, timeout=30.0,
                              headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
        text = response.text
    except Exception as error:  # noqa: BLE001
        raise SourceError(f"{type(error).__name__}: {error}") from error
    return parse_arxiv_feed(text, limit=limit)


def search(client, query: str, limit: int = 10, year_from: int | None = None,
           year_to: int | None = None, contact_email: str | None = None,
           sources: Sequence[str] = ("openalex", "arxiv")) -> dict:
    """多源检索并合并。**任一源失败都如实上报；全部失败即显式声明只能用本地库。**"""
    records: list[Record] = []
    status: list[dict] = []
    for name in sources:
        try:
            if name == "openalex":
                got = openalex_search(client, query, limit, year_from, year_to, contact_email)
            elif name == "arxiv":
                got = arxiv_search(client, query, limit)
            else:
                raise SourceError(f"未知文献源: {name}")
            status.append({"source": name, "ok": True, "count": len(got)})
            records.extend(got)
        except SourceError as error:
            status.append({"source": name, "ok": False, "error": str(error)})
        except Exception as error:  # noqa: BLE001
            status.append({"source": name, "ok": False, "error": f"{type(error).__name__}: {error}"})

    merged = filter_by_year(dedupe(records), year_from, year_to)
    merged.sort(key=lambda record: (record.year or 0, record.citation_count or 0), reverse=True)
    degraded = all(not item["ok"] for item in status) if status else True
    return {"records": merged[:limit], "sources": status, "degraded": degraded}


# ── 本地库 ──────────────────────────────────────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS works (
  key            TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  authors        TEXT NOT NULL DEFAULT '[]',
  year           INTEGER,
  venue          TEXT,
  doi            TEXT,
  arxiv_id       TEXT,
  openalex_id    TEXT,
  s2_id          TEXT,
  url            TEXT,
  citation_count INTEGER,
  is_open_access INTEGER,
  fields_of_study TEXT NOT NULL DEFAULT '[]',
  abstract       TEXT,
  tldr           TEXT,
  found_in       TEXT NOT NULL DEFAULT '[]',
  saved_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS works_doi  ON works(doi)  WHERE doi  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS works_arx  ON works(arxiv_id) WHERE arxiv_id IS NOT NULL;
CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
  key UNINDEXED, title, abstract, venue, authors, tokenize='unicode61'
);
"""

_TEXT_COLUMNS = ("key", "title", "venue", "doi", "arxiv_id", "openalex_id", "s2_id", "url", "tldr")
_LIST_COLUMNS = ("authors", "fields_of_study", "found_in")

# 建表之后才加的列。**新增白名单字段时在这里加一行，不要改上面的 CREATE TABLE**：
# `CREATE TABLE IF NOT EXISTS` 对已存在的表什么都不做，老库永远拿不到新列。把新增列
# 单独走 ALTER 这条路，也意味着每次全新安装都会真实跑一遍迁移——迁移有 bug 会立刻暴露。
_ADDED_COLUMNS = {
    "volume": "TEXT",
    "issue": "TEXT",
    "pages": "TEXT",
}


def _ensure_columns(con: sqlite3.Connection) -> None:
    """补齐 `_ADDED_COLUMNS` 里缺失的列（幂等）。

    文献库是长生命周期的用户数据，升级绝不能让老库读不出新字段。
    """
    existing = {row[1] for row in con.execute("PRAGMA table_info(works)")}
    for column, definition in _ADDED_COLUMNS.items():
        if column not in existing:
            con.execute(f"ALTER TABLE works ADD COLUMN {column} {definition}")
    con.commit()


def _packaged_data_root() -> Path | None:
    """打包版数据根：向上找「含 resources/runtime 的安装束」，取其同级的 BoBoData。

    与 `reverse-experience/memory_store.py` 同一套推导（安装包布局：
    `<安装目录>/<应用名>/resources/runtime/...`，数据根是安装束上一级的 `BoBoData`）。
    """
    cur = Path(__file__).resolve()
    for _ in range(20):
        if (cur / "resources" / "runtime").is_dir():
            sibling = cur.parent / "BoBoData"
            return sibling if sibling.is_dir() else None
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def _bobo_root(env: dict) -> Path | None:
    """定位 BoBo 根（含 `dbx-runtime` 的目录）：显式 `BOBO_ROOT` 优先，否则从本文件向上找。"""
    explicit = str(env.get("BOBO_ROOT") or "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()
    cur = Path(__file__).resolve()
    for _ in range(15):
        if (cur / "dbx-runtime").is_dir():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def data_dir(env: dict | None = None) -> Path:
    """本地文献库目录：`<数据根>/literature/`（与经验池目录无关；经验池数据现收在 `<数据根>/experience-pool/` 下）。

    解析顺序**与 `reverse-experience/memory_store.py` 保持同一口径**（该处在 v1.4.6 修过
    「静默落到用户主目录导致数据错位」的缺陷，这里不重蹈）：
    `LITERATURE_DATA_DIR` 显式覆盖 > `DSH_HOME` 同级 > 打包版 `BoBoData` > BoBo 根 `bobo-data`。

    **绝不静默落到用户主目录**——定位不到时宁可报错。库写到用户和模型都找不到的角落，
    比直接失败更难排查。
    """
    source = os.environ if env is None else env
    explicit = str(source.get("LITERATURE_DATA_DIR") or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    dsh_home = str(source.get("DSH_HOME") or "").strip()
    if dsh_home:
        base: Path | None = Path(dsh_home).expanduser().parent
    else:
        base = _packaged_data_root()
        if base is None:
            root = _bobo_root(source)
            base = root / "bobo-data" if root else None
    if base is None:
        raise RuntimeError(
            "无法定位 BoBo 数据目录：缺少 DSH_HOME（MCP 子进程环境被清洗且无打包布局可回退）。"
            "请确认桌面壳注入 DSH_HOME，且 agent 预设的 env 转发块已随包。"
        )
    return base / "literature"


class LiteratureStore:
    """本地文献库（SQLite + FTS5）。保存、离线检索、引用核验都在这里。"""

    def __init__(self, db_path: Path | str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._con = sqlite3.connect(str(self.db_path))
        self._con.row_factory = sqlite3.Row
        self._con.executescript(SCHEMA)
        self._con.commit()

    def close(self) -> None:
        self._con.close()

    # ── 写入 ──
    def save(self, records: Sequence[Record]) -> dict:
        """按强标识 upsert；返回新建/更新/跳过的计数与键。"""
        # 迁移放在这里而不是 __init__：读路径对缺列是安全的（SELECT * 缺键取 None），
        # 只有写路径必须先有列，所以就在写入前补。
        _ensure_columns(self._con)
        inserted, updated = [], []
        for record in records:
            if not record.key:
                raise ValueError("保存前必须先分配 key（用 assign_keys）")
            existing = self._find_slot(record)
            if existing is None:
                inserted.append(record.key)
            else:
                updated.append(record.key)
                record.key = existing
            self._upsert(record)
        self._con.commit()
        self._refresh_fts(inserted + updated)
        return {"inserted": inserted, "updated": updated, "total": self.count()}

    def _find_slot(self, record: Record) -> str | None:
        for column, value in (("doi", record.doi), ("arxiv_id", record.arxiv_id),
                              ("openalex_id", record.openalex_id), ("s2_id", record.s2_id)):
            if not value:
                continue
            row = self._con.execute(f"SELECT key FROM works WHERE {column} = ?", (value,)).fetchone()
            if row:
                return str(row["key"])
        row = self._con.execute("SELECT key FROM works WHERE key = ?", (record.key,)).fetchone()
        return str(row["key"]) if row else None

    def _upsert(self, record: Record) -> None:
        payload = record.to_dict()
        payload["saved_at"] = record.saved_at or _now()
        columns = ["key", "title", "authors", "year", "venue", "volume", "issue", "pages",
                   "doi", "arxiv_id", "openalex_id",
                   "s2_id", "url", "citation_count", "is_open_access", "fields_of_study",
                   "abstract", "tldr", "found_in", "saved_at"]
        values = []
        for column in columns:
            value = payload.get(column)
            if column in _LIST_COLUMNS:
                value = json.dumps(value or [], ensure_ascii=False)
            elif column == "is_open_access" and value is not None:
                value = 1 if value else 0
            values.append(value)
        self._con.execute(
            f"INSERT OR REPLACE INTO works ({','.join(columns)}) VALUES ({','.join('?' * len(columns))})",
            values,
        )

    def _refresh_fts(self, keys: Sequence[str]) -> None:
        for key in keys:
            self._con.execute("DELETE FROM works_fts WHERE key = ?", (key,))
            row = self._con.execute("SELECT * FROM works WHERE key = ?", (key,)).fetchone()
            if row is None:
                continue
            self._con.execute(
                "INSERT INTO works_fts (key, title, abstract, venue, authors) VALUES (?,?,?,?,?)",
                (row["key"], row["title"], row["abstract"] or "", row["venue"] or "", row["authors"]),
            )
        self._con.commit()

    # ── 读取 ──
    def get(self, key: str) -> Record | None:
        row = self._con.execute(
            "SELECT * FROM works WHERE key = ? OR doi = ? OR arxiv_id = ? OR openalex_id = ? OR s2_id = ?",
            (key, key, key, key, key),
        ).fetchone()
        return _row_to_record(row) if row else None

    def lookup(self, query: str, limit: int = 10) -> list[Record]:
        """本地库检索：先走 FTS5，查询串不合 FTS 语法或空结果时回退 LIKE。"""
        limit = max(1, min(int(limit or 10), LOOKUP_LIMIT_MAX))
        rows = []
        if query.strip():
            try:
                rows = self._con.execute(
                    "SELECT w.* FROM works_fts f JOIN works w ON w.key = f.key "
                    "WHERE works_fts MATCH ? ORDER BY rank LIMIT ?",
                    (_fts_query(query), limit),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = []
            if not rows:
                like = f"%{query.strip()}%"
                rows = self._con.execute(
                    "SELECT * FROM works WHERE title LIKE ? OR abstract LIKE ? OR authors LIKE ? "
                    "OR doi = ? ORDER BY year DESC, citation_count DESC LIMIT ?",
                    (like, like, like, query.strip(), limit),
                ).fetchall()
        else:
            rows = self._con.execute(
                "SELECT * FROM works ORDER BY saved_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [_row_to_record(row) for row in rows]

    def all_keys(self) -> list[str]:
        return [str(row["key"]) for row in self._con.execute("SELECT key FROM works ORDER BY year DESC")]

    def count(self) -> int:
        return int(self._con.execute("SELECT COUNT(*) AS n FROM works").fetchone()["n"])

    def verify(self, keys: Sequence[str]) -> dict:
        """引用核验：稿子里的每个 `[@key]` 是否在本地库、且这条记录是否可核验。

        三种状态：
        - `verified`   —— 在库，且有 DOI/arXiv/OpenAlex/S2 之一（外部可查证）
        - `unverifiable` —— 在库，但**没有任何外部标识**：这条引用无法被第三方核实，
          不许进正文（这正是防编造引用的核心判据）
        - `missing`    —— 不在库。绝大多数情况是作者名/年份记错了，或这条引用根本不存在
        """
        results = []
        for key in keys:
            record = self.get(key)
            if record is None:
                results.append({
                    "key": key, "status": "missing",
                    "hint": "本地库没有这个键。先用 literature_by_title 找到真实文献再取 key；"
                            "找不到就必须删掉这条引用，不许凭记忆补。",
                })
                continue
            ids = record.ids()
            if ids:
                results.append({
                    "key": key, "status": "verified", "title": record.title,
                    "year": record.year, "ids": ids,
                })
            else:
                results.append({
                    "key": key, "status": "unverifiable", "title": record.title,
                    "hint": "这条记录没有任何外部标识（DOI/arXiv/OpenAlex），第三方无法核实，"
                            "不许写进正文；请补全标识或换成可核验的来源。",
                })
        ok = all(item["status"] == "verified" for item in results)
        return {"ok": ok, "results": results,
                "summary": {status: sum(1 for item in results if item["status"] == status)
                            for status in ("verified", "unverifiable", "missing")}}

    def stats(self) -> dict:
        total = self.count()
        by_year = [
            {"year": row["year"], "count": row["n"]}
            for row in self._con.execute(
                "SELECT year, COUNT(*) AS n FROM works WHERE year IS NOT NULL "
                "GROUP BY year ORDER BY year DESC LIMIT 10"
            )
        ]
        with_ids = int(self._con.execute(
            "SELECT COUNT(*) AS n FROM works WHERE doi IS NOT NULL OR arxiv_id IS NOT NULL "
            "OR openalex_id IS NOT NULL OR s2_id IS NOT NULL"
        ).fetchone()["n"])
        return {"db_path": str(self.db_path), "total": total,
                "with_external_id": with_ids, "verifiable_ratio": (
                    round(with_ids / total, 3) if total else None
                ), "recent_years": by_year}


def _fts_query(query: str) -> str:
    """把自由文本转成安全的 FTS5 查询：只保留词元，全部按前缀匹配。"""
    tokens = re.findall(r"[0-9A-Za-z\u4e00-\u9fff]+", query or "")
    if not tokens:
        return '""'
    return " OR ".join(f'"{token}"*' for token in tokens[:8])


def _row_to_record(row: sqlite3.Row) -> Record:
    data = {column: row[column] for column in row.keys()}
    for column in _LIST_COLUMNS:
        try:
            data[column] = json.loads(data.get(column) or "[]")
        except (TypeError, ValueError):
            data[column] = []
    if data.get("is_open_access") is not None:
        data["is_open_access"] = bool(data["is_open_access"])
    data.pop("saved_at", None)
    return Record(**{field: data.get(field) for field in WHITELIST_FIELDS},
                  verified=True)


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── 按标识解析（「给定 DOI/arXiv id → 拿到真文献」）──────────────────────────
def resolve_identifier(client, identifier: str) -> list[Record]:
    """用 DOI 或 arXiv id 联网解析出真实记录。

    「不许猜 ID」的另一半是「给了 ID 就要能解析」。识别的形态：`10.xxxx/yyyy`、
    `doi:10.xxxx/yyyy`、`2401.01234`、`arxiv:2401.01234`。无法识别时**明确报错**，
    不要含糊地当成关键词去搜——那会把一条明确的标识悄悄变成一次模糊检索。
    """
    raw = str(identifier or "").strip()
    if not raw:
        raise SourceError("标识为空")
    stripped = re.sub(r"^doi:\s*", "", re.sub(r"^https?://(dx\.)?doi\.org/", "", raw, flags=re.I), flags=re.I)
    if re.match(r"^10\.\d{4,9}/\S+$", stripped):
        return [openalex_by_doi(client, stripped)]
    arxiv_id = re.sub(r"^arxiv:\s*", "", raw, flags=re.I).strip()
    if re.match(r"^\d{4}\.\d{4,5}(v\d+)?$", arxiv_id):
        return arxiv_by_id(client, arxiv_id)
    raise SourceError(f"无法识别的标识「{raw}」：只接受 DOI（10.xxxx/yyyy）或 arXiv id（2401.01234）")


def openalex_by_doi(client, doi: str) -> Record:
    """按 DOI 取单篇（OpenAlex 单作品端点）。"""
    url = f"{OPENALEX_ENDPOINT}/https://doi.org/{doi}"
    try:
        response = client.get(url, timeout=30.0,
                              headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        response.raise_for_status()
        payload = response.json()
    except Exception as error:  # noqa: BLE001
        raise SourceError(f"按 DOI 解析失败（{type(error).__name__}: {error}）") from error
    if not isinstance(payload, dict) or not payload.get("id"):
        raise SourceError(f"OpenAlex 没有 DOI {doi} 对应的记录")
    return normalize_openalex(payload)


def arxiv_by_id(client, arxiv_id: str) -> list[Record]:
    """按 arXiv id 取单篇。"""
    params = {"id_list": arxiv_id, "max_results": 1}
    try:
        response = client.get(ARXIV_ENDPOINT, params=params, timeout=30.0,
                              headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
        text = response.text
    except Exception as error:  # noqa: BLE001
        raise SourceError(f"按 arXiv id 解析失败（{type(error).__name__}: {error}）") from error
    records = parse_arxiv_feed(text, limit=1)
    if not records:
        raise SourceError(f"arXiv 没有 id {arxiv_id} 对应的记录")
    return records


# ── 引用台账导出（闸门读的那一份）────────────────────────────────────────────
REFERENCES_FILENAME = "references.jsonl"
BIBTEX_FILENAME = "refs.bib"
RENDERED_FILENAME = "references.md"
SEARCH_LOG_FILENAME = "search-log.jsonl"


def append_search_log(log_dir: Path | str | None, entry: dict) -> str | None:
    """把一次检索追加进项目侧留档 `01-文献/search-log.jsonl`。

    检索留档**必须由工具写**：它是「这篇综述到底检索过没有」的唯一凭证，手写就失去意义。
    与引用台账不同，它不是核验依据（引用有效性由 `citation_verify` 管），所以本函数不做校验，
    只负责如实追加。

    Args:
        log_dir: 项目侧 `01-文献/` 目录；为空返回 None（不写）。
        entry: 本次检索的记录，由调用方给（工具名、查询式、参数、各源成败、命中数、键列表）。

    Returns:
        写入的文件路径；未写则 None。
    """
    target = str(log_dir or "").strip()
    if not target:
        return None
    directory = Path(target)
    directory.mkdir(parents=True, exist_ok=True)
    file = directory / SEARCH_LOG_FILENAME
    with file.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"at": _now(), **entry}, ensure_ascii=False) + "\n")
    return str(file)


# ── 参考文献渲染 ────────────────────────────────────────────────────────────
# 定位：**省掉手抄的起点，不是期刊合规的保证**。姓名缩写形式、文献类型标识、标点各刊
# 要求有差异，投稿前按目标期刊细则核对。缺字段一律省略，绝不补占位符。
REFERENCE_STYLES = ("gbt7714", "apa")
_GB_AUTHOR_LIMIT = 3


def _name_parts(name: str) -> tuple[str, str]:
    """把作者姓名拆成（姓, 名）。启发式：带逗号按逗号前为姓，否则**最后一个词为姓**。

    最后一个词为姓贴合 OpenAlex 等源的 `display_name` 约定（「名 姓」）。

    **已知局限**：arXiv 的作者名常按「姓 名」给出（如 `Han Meimei`），本启发式会拆成
    姓 `Meimei`。罗马化姓名本身有歧义，无法从字符串可靠判断——所以导出的参考文献**必须
    人工核对作者姓名这一项**，别当成终稿直接用。

    拆不出来时姓取整串、名为空（渲染成 `LI` 而不是编造一个缩写）。
    """
    cleaned = _text(name) or ""
    if not cleaned:
        return "", ""
    if "," in cleaned:
        family, _, given = cleaned.partition(",")
        return _text(family) or "", _text(given) or ""
    parts = cleaned.split()
    if len(parts) == 1:
        return parts[0], ""
    return parts[-1], " ".join(parts[:-1])


def _initials(given: str) -> str:
    return " ".join(f"{word[0].upper()}" for word in re.findall(r"[A-Za-z\u4e00-\u9fff]+", given or ""))


def _gbt_authors(authors: Sequence[str]) -> str:
    """GB/T 7714-2015 常被采用的西文姓名形式：姓全大写 + 名首字母（`ZHANG W`）。

    **是近似**：国内期刊对西文姓名并不统一（也有 `ZHANG Wei` 的写法），超过 3 位作者
    按标准加 `等`。
    """
    rendered = []
    for name in authors:
        family, given = _name_parts(name)
        if not family:
            continue
        rendered.append(f"{family.upper()} {_initials(given)}".strip())
    if len(rendered) > _GB_AUTHOR_LIMIT:
        rendered = [*rendered[:_GB_AUTHOR_LIMIT], "等"]
    return ", ".join(rendered)


def _apa_authors(authors: Sequence[str]) -> str:
    """APA 7：`Zhang, W., & Li, L.`；两位及以上最后一位前加 `&`。"""
    rendered = []
    for name in authors:
        family, given = _name_parts(name)
        if not family:
            continue
        initials = _initials(given)
        rendered.append(f"{family}, {initials}." if initials else f"{family}.")
    if not rendered:
        return ""
    if len(rendered) == 1:
        return rendered[0]
    return f"{', '.join(rendered[:-1])}, & {rendered[-1]}"


def _is_preprint(record: Record) -> bool:
    return bool(record.arxiv_id) and (not record.venue or record.venue.lower() == "arxiv")


def _gbt_locator(record: Record) -> str:
    """GB/T 的「刊名, 年, 卷(期): 页」片段，缺什么就少什么。"""
    if _is_preprint(record):
        head = f"arXiv, {record.year}" if record.year else "arXiv"
        return f"{head}. arXiv:{record.arxiv_id}"
    pieces = record.venue or ""
    if record.year:
        pieces = f"{pieces}, {record.year}" if pieces else str(record.year)
    if record.volume:
        locator = str(record.volume)
        if record.issue:
            locator = f"{locator}({record.issue})"
        if record.pages:
            locator = f"{locator}: {record.pages}"
        pieces = f"{pieces}, {locator}" if pieces else locator
    elif record.pages:
        pieces = f"{pieces}, {record.pages}" if pieces else str(record.pages)
    return pieces


def _apa_source(record: Record) -> str:
    """APA 的「刊名, 卷(期), 页」片段。"""
    if _is_preprint(record):
        return "arXiv"
    pieces = record.venue or ""
    if record.volume:
        pieces = f"{pieces}, {record.volume}" if pieces else str(record.volume)
        if record.issue:
            pieces = f"{pieces}({record.issue})"
        if record.pages:
            pieces = f"{pieces}, {record.pages}"
    elif record.pages:
        pieces = f"{pieces}, {record.pages}" if pieces else str(record.pages)
    return pieces


def format_reference(record: Record, style: str = "gbt7714", index: int | None = None) -> str:
    """把一条记录渲染成参考文献条目。

    Args:
        record: 文献记录。
        style: `gbt7714`（中文稿）或 `apa`（英文稿）。
        index: GB/T 用的序号；不给就不带 `[N]` 前缀。

    Raises:
        ValueError: 样式不认识——**不静默回退到默认样式**，那会让人以为出的是想要的格式。
    """
    if style not in REFERENCE_STYLES:
        raise ValueError(f"未知引用样式：{style}（可选 {', '.join(REFERENCE_STYLES)}）")
    return _gbt_reference(record, index) if style == "gbt7714" else _apa_reference(record)


def _gbt_marker(record: Record) -> str:
    """GB/T 7714 的文献类型标识。**没有刊名就不许标 `[J]`**——那是在宣称一个不存在的期刊。"""
    if _is_preprint(record):
        return "[EB/OL]"
    return "[J]" if record.venue else "[Z]"


def _gbt_reference(record: Record, index: int | None) -> str:
    prefix = f"[{index}] " if index else ""
    authors = _gbt_authors(record.authors)
    marker = _gbt_marker(record)
    head = f"{authors}. {record.title}{marker}." if authors else f"{record.title}{marker}."
    text = f"{prefix}{head}"
    locator = _gbt_locator(record)
    if locator:
        text = f"{text} {locator}."
    if record.doi:
        text = f"{text} DOI:{record.doi}."
    return text


def _apa_reference(record: Record) -> str:
    authors = _apa_authors(record.authors)
    year = f"({record.year})." if record.year else "(n.d.)."
    text = f"{authors} {year} {record.title}." if authors else f"{year} {record.title}."
    source = _apa_source(record)
    if source:
        text = f"{text} {source}."
    if _is_preprint(record):
        link = record.url or (f"https://arxiv.org/abs/{record.arxiv_id}" if record.arxiv_id else "")
        if link:
            text = f"{text} {link}"
    elif record.doi:
        text = f"{text} https://doi.org/{record.doi}"
    return text


def format_references(records: Sequence[Record], style: str = "gbt7714") -> str:
    """渲染整个参考文献列表：GB/T 按给定顺序编号；APA 按第一作者姓氏字母序且不编号。"""
    if style not in REFERENCE_STYLES:
        raise ValueError(f"未知引用样式：{style}（可选 {', '.join(REFERENCE_STYLES)}）")
    ordered = list(records)
    if style == "apa":
        ordered.sort(key=lambda item: (
            _name_parts(item.authors[0])[0].lower() if item.authors else "", item.year or 0,
        ))
        return "\n".join(format_reference(item, style) for item in ordered)
    return "\n".join(format_reference(item, style, index=position)
                     for position, item in enumerate(ordered, start=1))


def bibtex_entry(record: Record) -> str:
    """一条 BibTeX 条目。**缺字段就不写**——宁可不写，也不要编一个卷期页出来。"""
    journal_like = bool(record.venue) and record.venue.lower() not in ("arxiv",)
    fields: list[tuple[str, str]] = []
    if record.authors:
        fields.append(("author", " and ".join(record.authors)))
    if record.title:
        fields.append(("title", record.title))
    if journal_like:
        fields.append(("journal", record.venue))
    if record.year:
        fields.append(("year", str(record.year)))
    if record.volume:
        fields.append(("volume", record.volume))
    if record.issue:
        fields.append(("number", record.issue))
    if record.pages:
        fields.append(("pages", record.pages))
    if record.doi:
        fields.append(("doi", record.doi))
    if record.arxiv_id:
        fields.append(("eprint", record.arxiv_id))
        fields.append(("archivePrefix", "arXiv"))
    if record.url:
        fields.append(("url", record.url))
    body = ",\n".join(f"  {name} = {{{value}}}" for name, value in fields)
    kind = "article" if journal_like else "misc"
    return f"@{kind}{{{record.key},\n{body}\n}}"


def export_references(store: "LiteratureStore", keys: Sequence[str], out_dir: Path | str,
                      style: str = "gbt7714") -> dict:
    """把稿件用到的引用导出为项目侧台账 `references.jsonl` + `refs.bib` + `references.md`。

    台账是**闸门读的那一份**：闸门是 JS 插件，读不了 SQLite，所以由本函数把库里的
    事实落成 JSON 行——一条一行，含完整白名单记录与 `status`（与 `citation_verify` 同三态）。

    `out_dir` 通常就是论文项目的 `01-文献/`。目录不存在会创建。
    """
    if style not in REFERENCE_STYLES:
        raise ValueError(f"未知引用样式：{style}（可选 {', '.join(REFERENCE_STYLES)}）")

    cleaned: list[str] = []
    for key in keys or []:
        text = str(key).strip().strip("[]@")
        if text and text not in cleaned:
            cleaned.append(text)

    report = store.verify(cleaned)
    status_of = {item["key"]: item["status"] for item in report["results"]}

    rows: list[dict] = []
    citable: list[Record] = []       # 只有可核验的才进 references.md / refs.bib
    missing: list[str] = []
    unverifiable: list[str] = []
    for key in cleaned:
        record = store.get(key)
        if record is None:
            missing.append(key)
            continue
        status = status_of.get(key, "missing")
        if status == "verified":
            citable.append(record)
        else:
            unverifiable.append(key)
        rows.append({**record.to_dict(), "status": status})

    target = Path(out_dir)
    target.mkdir(parents=True, exist_ok=True)
    ledger = target / REFERENCES_FILENAME
    bibtex = target / BIBTEX_FILENAME
    rendered = target / RENDERED_FILENAME
    ledger.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    entries = [bibtex_entry(record) for record in citable]
    bibtex.write_text(("\n\n".join(entries) + "\n") if entries else "", encoding="utf-8")
    rendered.write_text((format_references(citable, style) + "\n") if citable else "", encoding="utf-8")

    return {
        "ok": report["ok"],
        "style": style,
        "written": {"ledger": str(ledger), "bibtex": str(bibtex), "rendered": str(rendered)},
        "total": len(rows),
        "citable": len(citable),
        "missing": missing,
        "unverifiable": unverifiable,
        "summary": report["summary"],
        "notes": ([
            f"有 {len(missing)} 个引用键在文献库里找不到：{'、'.join(missing)}——"
            "它们是编造引用或键写错的信号，**先处理掉再写正文**。",
        ] if missing else []) + ([
            f"有 {len(unverifiable)} 个引用没有外部标识（DOI/arXiv/OpenAlex），第三方无法核实："
            f"{'、'.join(unverifiable)}——不许进正文，因此**没有写进 references.md 与 refs.bib**；"
            "台账里仍记着它们的状态，正是闸门据此拦下正文里的引用。",
        ] if unverifiable else []) + [
            "台账收录全部查到的条目（含状态）；`references.md` 与 `refs.bib` 只收录可核验的条目。",
            "这三份文件都由本工具落盘；**不要手写**，改引用后重跑覆盖即可。",
            f"当前样式 `{style}` 是省掉手抄的起点，不是期刊合规的保证——投稿前按目标期刊细则核对"
            "姓名缩写、类型标识与卷期页。",
        ],
    }
