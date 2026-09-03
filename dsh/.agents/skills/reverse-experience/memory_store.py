# -*- coding: utf-8 -*-
"""memory_store.py —— 逆向经验记忆库（RAG 记忆增强）核心实现。

属于 `reverse-experience` 技能，作为 reverse-memory MCP server 的单一实现来源
（server 从技能目录 import 本文件；找不到时回退到脚本同目录）。

职责：
- 把 Agent 逆向网页的成功/失败经验沉淀为「本地 MD 日志（人类可读）+ 向量化入 Qdrant」；
- 逆向新站点时按「域名精确 + 标签过滤 + 语义向量」混合检索历史案例，供模型参考；
- 置信度 < 1.8 的日志直接放弃（不留本地文件、不入向量库）；feedback 把置信度打回
  1.8 以下的案例从 Qdrant 移除（归档本地 MD）。

连接与降级：
- Qdrant 连接复用 DBX 已保存的连接（db_type == qdrant），可用环境变量覆盖；
- Qdrant 不可达时 save 只落本地（registry + MD，标记 qdrant_pending），
  search 退化为本地 registry 的「域名/标签/关键词」评分检索；
- 只读模式（REVERSE_MEMORY_READONLY=1）：所有写操作直接拒绝（工作流模式）。

环境变量：
- REVERSE_MEMORY_QDRANT_CONN  指定 DBX 中的 Qdrant 连接名（缺省取第一个 qdrant 连接）
- REVERSE_MEMORY_QDRANT_URL   直接指定 Qdrant 地址（如 http://host:6333），优先于 DBX 连接
- REVERSE_MEMORY_QDRANT_API_KEY 直接指定 API Key（优先于 DBX 连接里的密钥）
- REVERSE_MEMORY_READONLY     1 表示只读（不注册/拒绝写操作）
- REVERSE_MEMORY_EMBEDDING    0 表示禁用向量化（纯关键词检索）
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# 常量与配置
# ---------------------------------------------------------------------------

CONFIDENCE_THRESHOLD = 1.8          # 入库门槛：低于该值直接放弃
CONFIDENCE_STEP = 0.5               # feedback 每次升降的幅度
COLLECTION = "reverse_experience"   # Qdrant 集合名
EMBED_MODEL = "BAAI/bge-small-zh-v1.5"
DEFAULT_EMBED_DIM = 512
RESULTS_DIR_NAME = "reverse-experience"
INDEX_FILENAME = "registry.json"
FEEDBACK_DELTA = {"success": +CONFIDENCE_STEP, "fail": -CONFIDENCE_STEP}

_SKILL_DIR = Path(__file__).resolve().parent

# ── dbx_connector 单一实现来源（用户级技能优先，回退项目技能/脚本目录） ─────────
_DSH_HOME = Path(os.environ["DSH_HOME"]) if os.environ.get("DSH_HOME") else None
_DBX_CONNECTOR_CANDIDATES = (
    *((_DSH_HOME / "skills" / "db-extraction" / "dbx_connector.py",) if _DSH_HOME else ()),
    Path.home() / ".dsh" / "skills" / "db-extraction" / "dbx_connector.py",
    Path(__file__).resolve().parent.parent / "db-extraction" / "dbx_connector.py",
    Path(__file__).resolve().parent.parent.parent / "scripts" / "dbx_connector.py",
)
_dbx = None


def _load_dbx_connector():
    """加载 dbx_connector（惰性，多路径兜底）。"""
    global _dbx
    if _dbx is not None:
        return _dbx
    for cand in _DBX_CONNECTOR_CANDIDATES:
        if cand.is_file():
            import importlib.util

            spec = importlib.util.spec_from_file_location("dbx_connector", cand)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
            _dbx = mod
            return _dbx
    _dbx = False
    return None


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def is_readonly() -> bool:
    return _env("REVERSE_MEMORY_READONLY") == "1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# 路径解析
# ---------------------------------------------------------------------------


def bobo_root() -> Path | None:
    """定位 BoBo 根目录（含 dbx-runtime 的目录）。复用 dbx_connector。"""
    dbx = _load_dbx_connector()
    if dbx:
        try:
            return dbx.find_bobo_root()
        except Exception:
            pass
    if _env("BOBO_ROOT"):
        return Path(_env("BOBO_ROOT")).resolve()
    # 兜底：从本文件所在位置向上找
    cur = Path(__file__).resolve()
    for _ in range(15):
        if (cur / "dbx-runtime").is_dir():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def data_dir() -> Path:
    # DSH_HOME（桌面壳/打包版用户数据根）优先：数据存到 DSH_HOME 同级
    # reverse-experience，开发（bobo-data）与打包（BoBoData）布局一致；
    # 无 DSH_HOME 时回退旧逻辑（BoBo 根 bobo-data / 用户主目录）。
    if _env("DSH_HOME"):
        base = Path(_env("DSH_HOME")).parent
    else:
        root = bobo_root()
        base = root / "bobo-data" if root else Path.home() / "bobo-data"
    d = base / RESULTS_DIR_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _registry_path() -> Path:
    return data_dir() / INDEX_FILENAME


def _load_registry() -> dict[str, dict[str, Any]]:
    p = _registry_path()
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_registry(reg: dict[str, dict[str, Any]]) -> None:
    p = _registry_path()
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(reg, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


# ---------------------------------------------------------------------------
# Qdrant 连接（复用 DBX 保存的连接）
# ---------------------------------------------------------------------------


def qdrant_endpoint() -> tuple[str | None, str | None]:
    """返回 (url, api_key)。env 覆盖 > DBX qdrant 连接 > None。"""
    url = _env("REVERSE_MEMORY_QDRANT_URL") or None
    key = _env("REVERSE_MEMORY_QDRANT_API_KEY") or None
    if url:
        return url, key
    dbx = _load_dbx_connector()
    if not dbx:
        return None, None
    conn_name = _env("REVERSE_MEMORY_QDRANT_CONN") or None
    try:
        root = dbx.find_bobo_root()
        profiles = dbx.load_profiles(bobo_root=root) if root else []
    except Exception:
        return None, None
    for p in profiles:
        if (p.get("db_type") or "").lower() != "qdrant":
            continue
        if conn_name and p.get("name") != conn_name:
            continue
        scheme = "https" if p.get("ssl") else "http"
        host = p.get("host") or "127.0.0.1"
        port = int(p.get("port") or 6333)
        u = f"{scheme}://{host}:{port}"
        k = (p.get("api_key") or p.get("apikey") or p.get("password")
             or p.get("username") or None)
        return u, k or key
    return None, key


_qclient: Any = None


def qdrant_client():
    """惰性创建 Qdrant 客户端；连接失败返回 None（降级本地模式）。"""
    global _qclient
    if _qclient is not None:
        return _qclient
    url, key = qdrant_endpoint()
    if not url:
        return None
    try:
        from qdrant_client import QdrantClient

        c = QdrantClient(url=url, api_key=key or None, timeout=10)
        c.get_collections()  # 连通性探活
        _qclient = c
        return c
    except Exception as e:
        print(f"[memory_store] Qdrant 不可达（降级本地模式）: {e}")
        _qclient = False
        return None


_COLLECTION_READY = False


def _ensure_collection(client) -> bool:
    """确保集合存在（维度取首个向量的实际长度）。"""
    global _COLLECTION_READY
    if _COLLECTION_READY:
        return True
    from qdrant_client import models

    if client.collection_exists(COLLECTION):
        _COLLECTION_READY = True
        return True
    dim = DEFAULT_EMBED_DIM
    client.create_collection(
        COLLECTION,
        vectors_config=models.VectorParams(size=dim, distance=models.Distance.COSINE),
    )
    _COLLECTION_READY = True
    return True


# ---------------------------------------------------------------------------
# 向量化（fastembed + bge-small-zh，惰性加载）
# ---------------------------------------------------------------------------

_embedder: Any = None


def _get_embedder():
    global _embedder
    if _env("REVERSE_MEMORY_EMBEDDING") == "0":
        return None
    if _embedder is None:
        try:
            from fastembed import TextEmbedding

            try:
                _embedder = TextEmbedding(EMBED_MODEL)
            except Exception as e1:
                # 直连 huggingface 失败（常见于国内网络）→ 未显式指定时回退镜像站重试一次
                if not os.environ.get("HF_ENDPOINT"):
                    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
                    _embedder = TextEmbedding(EMBED_MODEL)
                else:
                    raise e1
            print(f"[memory_store] embedding 就绪: {EMBED_MODEL}")
        except Exception as e:
            print(f"[memory_store] embedding 不可用（将退化为关键词检索）: {e}")
            _embedder = False
    return _embedder or None


def embed_text(text: str) -> list[float] | None:
    emb = _get_embedder()
    if emb is None or not text.strip():
        return None
    try:
        vec = next(emb.embed([text[:2000]]))
        return [float(x) for x in vec]
    except Exception as e:
        print(f"[memory_store] 向量化失败: {e}")
        return None


def _semantic_text(rec: dict[str, Any]) -> str:
    """用于向量化的语义文本（聚合最能表达逆向特征的内容）。"""
    parts = [
        rec.get("domain", ""),
        " ".join(rec.get("tags", [])),
        " ".join(rec.get("anti_crawl", [])),
        rec.get("result", ""),
        rec.get("final_solution", ""),
        " ".join(rec.get("positive_lessons", [])),
        " ".join(rec.get("negative_lessons", [])),
    ]
    return " ".join(x for x in parts if x)[:2000]


# ---------------------------------------------------------------------------
# 数据模型与本地落盘
# ---------------------------------------------------------------------------


def _normalize_domain(domain: str) -> str:
    d = domain.strip().lower()
    if "://" in d:
        d = urlparse(d).netloc or d
    d = d.split("/")[0].split(":")[0]
    return d or "unknown"


def _feature_hash(rec: dict[str, Any]) -> str:
    key = "|".join([
        rec.get("domain", ""),
        ",".join(sorted(rec.get("tags", []))),
        ",".join(sorted(rec.get("anti_crawl", []))),
    ])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _record(rec: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    rid = uuid.uuid4().hex
    return {
        "id": rid,
        "domain": _normalize_domain(rec.get("domain", "")),
        "url": rec.get("url", ""),
        "title": rec.get("title", ""),
        "tags": [str(t) for t in (rec.get("tags") or [])],
        "anti_crawl": [str(a) for a in (rec.get("anti_crawl") or [])],
        "attempts": rec.get("attempts") or [],
        "final_solution": rec.get("final_solution", ""),
        "positive_lessons": [str(x) for x in (rec.get("positive_lessons") or [])],
        "negative_lessons": [str(x) for x in (rec.get("negative_lessons") or [])],
        "result": rec.get("result", "SUCCESS"),
        "confidence": round(float(rec.get("confidence") or 0.0), 1),
        "tools_used": [str(t) for t in (rec.get("tools_used") or [])],
        "used_experience_ids": [str(i) for i in (rec.get("used_experience_ids") or [])],
        "feature_hash": "",
        "created_at": now,
        "updated_at": now,
        "used_count": 0,
        "archived": False,
        "qdrant_pending": False,
        "qdrant_point_id": None,
        "md_path": "",
    }


def _sanitize_filename(domain: str) -> str:
    s = re.sub(r'[\\/:*?"<>|]', "_", domain)
    return s or "unknown"


def md_path_for(rec: dict[str, Any]) -> Path:
    ts = rec["created_at"].replace(":", "-").replace("+00:00", "Z")
    return data_dir() / _sanitize_filename(rec["domain"]) / f"{ts}-{rec['id'][:8]}.md"


def _md_content(rec: dict[str, Any]) -> str:
    lines = [
        "# 逆向任务日志",
        f"- ID: {rec['id']}",
        f"- 域名: {rec['domain']}",
        f"- 目标URL: {rec['url']}",
        f"- 时间: {rec['created_at']}",
        f"- 结果: {rec['result']}",
        f"- 置信度: {rec['confidence']} (1-5，入库门槛 {CONFIDENCE_THRESHOLD})",
        f"- 使用工具: {', '.join(rec['tools_used']) or '-'}",
        f"- 任务标签: {', '.join(rec['tags']) or '-'}",
        f"- 识别到的反爬手段: {', '.join(rec['anti_crawl']) or '-'}",
        f"- 参考的历史经验: {', '.join(rec['used_experience_ids']) or '-'}",
        "",
        "## 尝试过的方案",
    ]
    for a in rec["attempts"]:
        mark = "✅" if str(a.get("result", "")).lower() in ("success", "成功", "ok", "有效") else "❌"
        note = a.get("note", "") or ""
        lines.append(f"- {mark} 方案: {a.get('method', '')} → {a.get('result', '')}"
                     + (f"，原因: {note}" if note else ""))
    if not rec["attempts"]:
        lines.append("- （无记录）")
    lines += [
        "",
        f"## 最终可行方案\n\n{rec['final_solution'] or '（未取得可行方案）'}",
        "",
        "## 经验总结（正向）",
    ]
    lines += [f"- {x}" for x in rec["positive_lessons"]] or ["- （无）"]
    lines += ["", "## 教训总结（负向）"]
    lines += [f"- {x}" for x in rec["negative_lessons"]] or ["- （无）"]
    return "\n".join(lines) + "\n"


def _write_md(rec: dict[str, Any]) -> Path:
    p = md_path_for(rec)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_md_content(rec), encoding="utf-8")
    rec["md_path"] = str(p)
    return p


def _update_md_from_registry(reg: dict[str, Any]) -> None:
    """把 registry 中的最新字段（置信度/归档/待同步标记）确定性回写 MD 文件。"""
    p = Path(reg.get("md_path") or "")
    if not p.is_file():
        return
    text = p.read_text(encoding="utf-8")
    text = re.sub(r"^\- 置信度: .*$",
                  f"- 置信度: {reg['confidence']} (1-5，入库门槛 {CONFIDENCE_THRESHOLD})",
                  text, count=1, flags=re.M)
    # 移除旧的标记行（防止重复追加），再按当前状态重建
    lines = [ln for ln in text.splitlines()
             if not (ln.startswith("> 📡") or ln.startswith("> ⚠️"))]
    markers = []
    if reg.get("qdrant_pending"):
        markers.append("> 📡 Qdrant 未同步（服务器不可达，向量同步待恢复）")
    if reg.get("archived"):
        markers.append("> ⚠️ 已归档（置信度低于入库门槛，已从向量库移除，仅供参考）")
    if markers:
        if lines and lines[-1] != "":
            lines.append("")
        lines.extend(markers)
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# 核心操作
# ---------------------------------------------------------------------------


def save_experience(rec_fields: dict[str, Any]) -> dict[str, Any]:
    """沉淀一条逆向经验。置信度 < 门槛直接放弃；否则本地落盘 + 向量化入 Qdrant。"""
    if is_readonly():
        raise RuntimeError("当前为只读模式（工作流模式），不允许写入逆向经验。")
    rec = _record(rec_fields)
    if rec["confidence"] < CONFIDENCE_THRESHOLD:
        return {
            "saved": False,
            "reason": "confidence_below_threshold_discarded",
            "id": None,
            "confidence": rec["confidence"],
            "threshold": CONFIDENCE_THRESHOLD,
        }
    rec["feature_hash"] = _feature_hash(rec)
    _write_md(rec)

    reg = _load_registry()
    reg[rec["id"]] = rec
    _save_registry(reg)

    synced = _sync_to_qdrant(rec, reg)
    _update_md_from_registry(rec)
    return {
        "saved": True,
        "reason": "stored" if synced else "stored_local_qdrant_pending",
        "id": rec["id"],
        "domain": rec["domain"],
        "confidence": rec["confidence"],
        "md_path": rec["md_path"],
        "qdrant_synced": synced,
        "collection": COLLECTION,
    }


def _sync_to_qdrant(rec: dict[str, Any], reg: dict[str, Any]) -> bool:
    """向量化 + 去重 + 入 Qdrant。返回是否同步成功。"""
    client = qdrant_client()
    if client is None:
        rec["qdrant_pending"] = True
        _save_registry(reg)
        return False
    try:
        from qdrant_client import models

        _ensure_collection(client)
        # 同类指纹去重：同域名 + 同特征指纹的旧案例移除（保留本地 MD 历史）
        dup = _query_points(client, domain=rec["domain"], feature_hash=rec["feature_hash"])
        dup_ids = [str(p.id) for p in dup]
        if dup_ids:
            client.delete(COLLECTION, points_selector=models.PointIdsList(points=dup_ids))
            # 旧 registry 记录标记替换
            for rid_key, r in reg.items():
                if r.get("qdrant_point_id") in dup_ids:
                    r["archived"] = True
        vec = embed_text(_semantic_text(rec))
        if vec is None:
            raise RuntimeError("embedding 不可用")
        client.upsert(COLLECTION, points=[models.PointStruct(
            id=rec["id"],
            vector=vec,
            payload=_payload(rec),
        )])
        rec["qdrant_pending"] = False
        rec["qdrant_point_id"] = rec["id"]
        _save_registry(reg)
        return True
    except Exception as e:
        print(f"[memory_store] Qdrant 同步失败（保留本地）: {e}")
        rec["qdrant_pending"] = True
        _save_registry(reg)
        return False


def _payload(rec: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": rec["id"],
        "domain": rec["domain"],
        "url": rec.get("url", ""),
        "title": rec.get("title", ""),
        "tags": rec.get("tags", []),
        "anti_crawl": rec.get("anti_crawl", []),
        "feature_hash": rec.get("feature_hash", ""),
        "result": rec.get("result", ""),
        "confidence": rec.get("confidence"),
        "final_solution": rec.get("final_solution", ""),
        "positive_lessons": rec.get("positive_lessons", []),
        "negative_lessons": rec.get("negative_lessons", []),
        "tools_used": rec.get("tools_used", []),
        "used_count": rec.get("used_count", 0),
        "created_at": rec.get("created_at", ""),
        "updated_at": rec.get("updated_at", ""),
        "md_path": rec.get("md_path", ""),
    }


def _query_points(client, domain: str | None = None, feature_hash: str | None = None,
                  tags: list[str] | None = None, limit: int = 20):
    from qdrant_client import models

    must: list[Any] = []
    if domain:
        must.append(models.FieldCondition(key="domain",
                                          match=models.MatchValue(value=domain)))
    if feature_hash:
        must.append(models.FieldCondition(key="feature_hash",
                                          match=models.MatchValue(value=feature_hash)))
    if tags:
        must.append(models.FieldCondition(key="tags", match=models.MatchAny(any=tags)))
    return client.scroll(COLLECTION,
                         scroll_filter=models.Filter(must=must) if must else None,
                         limit=limit, with_payload=True)[0]


def search_experiences(*, domain: str | None = None, tags: list[str] | None = None,
                       features: str = "", query: str = "", top_k: int = 5) -> dict[str, Any]:
    """混合检索历史逆向经验。返回 {count, items, mode}。"""
    domain = _normalize_domain(domain) if domain else None
    tags = [str(t) for t in (tags or [])]
    text = (query or features or "").strip()
    client = qdrant_client()
    hits: list[dict[str, Any]] = []
    mode = "local"
    if client is not None:
        vec = embed_text(text) if text else None
        if vec is not None:
            mode = "vector"
            hits = _qdrant_search(client, domain, tags, vec, top_k * 3)
    if not hits:
        mode = "local" if client is None or vec is None else "local"
        hits = _local_search(domain, tags, text, top_k * 3)
    # 排序：域名命中优先 > 置信度 > （向量分已由后端给出）
    hits.sort(key=lambda h: (h.get("domain") == domain if domain else True, h["confidence"]),
              reverse=True)
    items = hits[:top_k]
    return {"count": len(items), "mode": mode, "items": items}


def _qdrant_search(client, domain, tags, vec, limit):
    from qdrant_client import models

    def run(dom: str | None) -> list[dict]:
        must = []
        if dom:
            must.append(models.FieldCondition(key="domain",
                                              match=models.MatchValue(value=dom)))
        if tags:
            must.append(models.FieldCondition(key="tags", match=models.MatchAny(any=tags)))
        try:
            res = client.query_points(
                COLLECTION, query=vec,
                query_filter=models.Filter(must=must) if must else None,
                limit=limit, with_payload=True)
            return [_hit_from_point(pt) for pt in res.points]
        except Exception as e:
            print(f"[memory_store] 向量检索失败: {e}")
            return []

    out = run(domain) if domain else []
    if len(out) < limit:
        seen = {h["id"] for h in out}
        for h in run(None):
            if h["id"] not in seen:
                out.append(h)
                seen.add(h["id"])
    return out


def _hit_from_point(pt) -> dict[str, Any]:
    p = pt.payload or {}
    return {
        "id": p.get("id") or pt.id,
        "domain": p.get("domain", ""),
        "url": p.get("url", ""),
        "title": p.get("title", ""),
        "tags": p.get("tags", []),
        "anti_crawl": p.get("anti_crawl", []),
        "result": p.get("result", ""),
        "confidence": p.get("confidence", 0),
        "final_solution": p.get("final_solution", ""),
        "positive_lessons": p.get("positive_lessons", []),
        "negative_lessons": p.get("negative_lessons", []),
        "tools_used": p.get("tools_used", []),
        "used_count": p.get("used_count", 0),
        "created_at": p.get("created_at", ""),
        "md_path": p.get("md_path", ""),
    }


def _local_search(domain: str | None, tags: list[str], text: str,
                  limit: int) -> list[dict[str, Any]]:
    """降级检索：本地 registry 按域名精确 + 标签重合 + 关键词命中评分。"""
    reg = _load_registry()
    words = [w for w in re.split(r"[\s,，;；/]+", text.lower()) if len(w) > 1]
    scored: list[tuple[float, dict[str, Any]]] = []
    for r in reg.values():
        if r.get("archived"):
            continue
        if r["confidence"] < CONFIDENCE_THRESHOLD:
            continue
        score = 0.0
        if domain and r.get("domain") == domain:
            score += 3.0
        if tags:
            overlap = len(set(tags) & set(r.get("tags", [])))
            score += overlap * 1.0
        if words:
            blob = " ".join([
                r.get("domain", ""), r.get("url", ""), r.get("result", ""),
                " ".join(r.get("tags", [])), " ".join(r.get("anti_crawl", [])),
                r.get("final_solution", ""),
                " ".join(r.get("positive_lessons", [])),
                " ".join(r.get("negative_lessons", [])),
            ]).lower()
            score += sum(1 for w in words if w in blob) * 1.0
        if score > 0:
            scored.append((score, _hit_from_registry(r)))
    scored.sort(key=lambda x: (-x[0], -x[1]["confidence"]))
    return [h for _, h in scored[:limit]]


def _hit_from_registry(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r.get("id", ""),
        "domain": r.get("domain", ""),
        "url": r.get("url", ""),
        "title": r.get("title", ""),
        "tags": r.get("tags", []),
        "anti_crawl": r.get("anti_crawl", []),
        "result": r.get("result", ""),
        "confidence": r.get("confidence", 0),
        "final_solution": r.get("final_solution", ""),
        "positive_lessons": r.get("positive_lessons", []),
        "negative_lessons": r.get("negative_lessons", []),
        "tools_used": r.get("tools_used", []),
        "used_count": r.get("used_count", 0),
        "created_at": r.get("created_at", ""),
        "md_path": r.get("md_path", ""),
    }


def feedback_experience(experience_id: str, outcome: str) -> dict[str, Any]:
    """采纳反馈：success +0.5 / fail -0.5；置信度跌破门槛则从 Qdrant 移除并归档。"""
    if is_readonly():
        raise RuntimeError("当前为只读模式（工作流模式），不允许写入。")
    if outcome not in FEEDBACK_DELTA:
        raise ValueError(f"outcome 必须是 {sorted(FEEDBACK_DELTA)} 之一")
    reg = _load_registry()
    rec = reg.get(experience_id)
    if rec is None:
        raise LookupError(f"找不到经验 {experience_id}，无法反馈。")
    rec["confidence"] = round(max(1.0, min(5.0, rec["confidence"] + FEEDBACK_DELTA[outcome])), 1)
    rec["used_count"] = rec.get("used_count", 0) + 1
    rec["updated_at"] = _now()

    action = "updated"
    client = qdrant_client()
    if rec["confidence"] < CONFIDENCE_THRESHOLD:
        # 跌破门槛：无论 Qdrant 是否可达都标记归档（本地检索将不再返回）
        if client is not None and rec.get("qdrant_point_id"):
            from qdrant_client import models

            try:
                client.delete(COLLECTION, points_selector=models.PointIdsList(
                    points=[rec["qdrant_point_id"]]))
            except Exception as e:
                print(f"[memory_store] 移除失败: {e}")
        rec["qdrant_point_id"] = None
        rec["archived"] = True
        action = "removed"
    elif client is not None and rec.get("qdrant_point_id"):
        from qdrant_client import models

        try:
            client.set_payload(COLLECTION,
                               {"confidence": rec["confidence"],
                                "used_count": rec["used_count"],
                                "updated_at": rec["updated_at"]},
                               points=[rec["qdrant_point_id"]])
        except Exception as e:
            print(f"[memory_store] payload 更新失败: {e}")
    _save_registry(reg)
    _update_md_from_registry(rec)
    return {
        "experience_id": experience_id,
        "action": action,
        "confidence": rec["confidence"],
        "used_count": rec["used_count"],
        "archived": rec.get("archived", False),
        "threshold": CONFIDENCE_THRESHOLD,
    }


def sync_local_to_qdrant() -> dict[str, Any]:
    """把本地 registry 中未归档的经验同步/补同步到当前 Qdrant（换服务器/断连恢复用）。

    幂等：point id = 经验 id，重复 upsert 直接覆盖；本地已归档的若上游仍存在则移除。
    返回 {synced, removed_upstream, qdrant_reachable}。
    """
    if is_readonly():
        raise RuntimeError("当前为只读模式，不允许同步。")
    reg = _load_registry()
    client = qdrant_client()
    if client is None:
        return {"synced": 0, "removed_upstream": 0, "qdrant_reachable": False,
                "pending": sum(1 for r in reg.values() if not r.get("archived"))}
    from qdrant_client import models

    _ensure_collection(client)
    upstream = {str(pt.id) for pt in _query_points(client, limit=1000)}
    synced = removed = 0
    for rid, rec in reg.items():
        if rec.get("archived"):
            pid = rec.get("qdrant_point_id")
            if pid and pid in upstream:
                try:
                    client.delete(COLLECTION, points_selector=models.PointIdsList(points=[pid]))
                    removed += 1
                except Exception as e:
                    print(f"[memory_store] 上游清理失败 {rid}: {e}")
            continue
        vec = embed_text(_semantic_text(rec))
        if vec is None:
            continue
        try:
            client.upsert(COLLECTION, points=[models.PointStruct(
                id=rid, vector=vec, payload=_payload(rec))])
            rec["qdrant_pending"] = False
            rec["qdrant_point_id"] = rid
            synced += 1
        except Exception as e:
            print(f"[memory_store] 同步失败 {rid}: {e}")
    _save_registry(reg)
    return {"synced": synced, "removed_upstream": removed, "qdrant_reachable": True}


def stats() -> dict[str, Any]:
    reg = _load_registry()
    client = qdrant_client()
    qdrant_ok = client is not None
    by_result: dict[str, int] = {}
    by_tag: dict[str, int] = {}
    store_count = sum(1 for r in reg.values() if not r.get("archived"))
    for r in reg.values():
        if r.get("archived"):
            continue
        by_result[r.get("result", "?")] = by_result.get(r.get("result", "?"), 0) + 1
        for t in r.get("tags", []):
            by_tag[t] = by_tag.get(t, 0) + 1
    qdrant_count = None
    if client is not None:
        try:
            qdrant_count = client.count(COLLECTION, exact=True).count
        except Exception:
            qdrant_count = None
    return {
        "readonly": is_readonly(),
        "qdrant_reachable": qdrant_ok,
        "qdrant_url": qdrant_endpoint()[0] or "",
        "collection": COLLECTION,
        "threshold": CONFIDENCE_THRESHOLD,
        "local_active_count": store_count,
        "local_archived_count": len(reg) - store_count,
        "qdrant_point_count": qdrant_count,
        "by_result": by_result,
        "by_tag": dict(sorted(by_tag.items(), key=lambda kv: -kv[1])[:20]),
    }


def cleanup(dry_run: bool = True, max_age_days: int = 90) -> dict[str, Any]:
    """冷归档：长时间未被复用且置信度不高的案例，从 Qdrant 移除并归档本地。"""
    if is_readonly() and not dry_run:
        raise RuntimeError("当前为只读模式，不允许清理。")
    reg = _load_registry()
    now = time.time()
    candidates: list[str] = []
    for rid, r in reg.items():
        if r.get("archived") or r.get("used_count", 0) > 0 or r.get("confidence", 0) >= 2.5:
            continue
        if r.get("qdrant_pending"):
            continue
        try:
            age = now - datetime.fromisoformat(r.get("created_at", "")).timestamp()
        except Exception:
            age = float("inf")
        if age >= max_age_days * 86400:
            candidates.append(rid)
    if not dry_run and candidates:
        client = qdrant_client()
        if client is not None:
            from qdrant_client import models

            try:
                client.delete(COLLECTION, points_selector=models.PointIdsList(
                    points=[reg[rid]["qdrant_point_id"] for rid in candidates
                            if reg[rid].get("qdrant_point_id")]))
            except Exception as e:
                print(f"[memory_store] 清理删除失败: {e}")
        for rid in candidates:
            reg[rid]["archived"] = True
            reg[rid]["updated_at"] = _now()
            _update_md_from_registry(reg[rid])
        _save_registry(reg)
    return {"dry_run": dry_run, "candidates": candidates, "count": len(candidates)}


# ---------------------------------------------------------------------------
# 命令行自检（供开发/排障，不走 MCP）
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    import argparse

    p = argparse.ArgumentParser(prog="memory_store", description="逆向经验记忆库自检")
    p.add_argument("cmd", choices=["stats", "save", "search", "feedback", "cleanup", "sync"])
    p.add_argument("--domain", default="")
    p.add_argument("--tags", default="")
    p.add_argument("--features", default="")
    p.add_argument("--id", default="")
    p.add_argument("--outcome", default="success")
    p.add_argument("--confidence", type=float, default=2.0)
    p.add_argument("--result", default="SUCCESS")
    p.add_argument("--top-k", type=int, default=5)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)
    try:
        if args.cmd == "stats":
            print(json.dumps(stats(), ensure_ascii=False, indent=2))
        elif args.cmd == "save":
            r = save_experience({
                "domain": args.domain, "tags": [t for t in args.tags.split(",") if t],
                "anti_crawl": ["自检用例"],
                "attempts": [{"method": "自检方案", "result": "success"}],
                "final_solution": "自检用最终方案",
                "positive_lessons": ["自检通过"],
                "negative_lessons": [],
                "result": args.result, "confidence": args.confidence,
            })
            print(json.dumps(r, ensure_ascii=False, indent=2))
        elif args.cmd == "search":
            r = search_experiences(domain=args.domain or None,
                                   tags=[t for t in args.tags.split(",") if t] or None,
                                   features=args.features, top_k=args.top_k)
            print(json.dumps(r, ensure_ascii=False, indent=2))
        elif args.cmd == "feedback":
            print(json.dumps(feedback_experience(args.id, args.outcome), ensure_ascii=False, indent=2))
        elif args.cmd == "cleanup":
            print(json.dumps(cleanup(dry_run=args.dry_run), ensure_ascii=False, indent=2))
        elif args.cmd == "sync":
            print(json.dumps(sync_local_to_qdrant(), ensure_ascii=False, indent=2))
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"错误: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())