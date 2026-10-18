# -*- coding: utf-8 -*-
"""experience_store —— 经验库共享机制层。

设计依据：`docs/研究模式调研/03-论文写作模式设计思路（经验沉淀层）.md` §7.1。

本模块只承载**与字段语义无关**的机制：

- 数据目录解析（DSH_HOME / 打包布局 / bobo 根三级回退，`readiness.json` 与之同目录）
- registry 读写（原子落盘）、本地 MD 落盘
- readiness 就绪快照（供闸门插件判据）
- fastembed 向量化（惰性加载 + HF 镜像回退）
- Qdrant 连接（配置文件 > env > DBX 连接；失败后重试窗口自愈；未配置时不缓存以便自愈）
- `search` / `save` / `feedback` / `cleanup` / `sync` / `stats` 的通用骨架

字段语义（检索键、去重指纹、payload、MD 渲染、**去重策略**）由调用方通过 `Adapter` 提供。
reverse 的替换式去重与 paper 的「强化」式去重（设计稿 D2）因此共用同一套骨架。

两条必须保住的契约（设计稿 §4.4 / R9）：

1. `readiness.json` 的**路径语义**——与 registry 同目录，闸门插件依赖它；
2. `feature_hash` 的**去重语义**——指纹相同视为同一条经验，走 Adapter 的合并策略。
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

READINESS_FILENAME = "readiness.json"
INDEX_FILENAME = "registry.json"
COLLECTION_READY = False          # 仅在单进程内缓存；每进程各自探测
_QCLIENT_RETRY_TTL = 30.0         # 连接失败后的重试窗口（秒）


def env(name: str) -> str:
    return os.environ.get(name, "").strip()


def embed_cache_dir() -> Optional[Path]:
    """向量模型缓存目录：`BOBO_FASTEMBED_CACHE` 优先，否则 `$DSH_HOME/fastembed`。

    启动器会把模型**按需下载**到这个目录（见 docs/打包规范 14 号文档）。
    """
    override = os.environ.get("BOBO_FASTEMBED_CACHE", "").strip()
    if override:
        return Path(override)
    dsh_home = os.environ.get("DSH_HOME", "").strip()
    if dsh_home:
        return Path(dsh_home) / "fastembed"
    return None


def embed_model_present(cache: Optional[Path]) -> bool:
    """本地是否有可直接加载的模型快照（有完整 onnx 权重）。"""
    if cache is None:
        return False
    snapshots = cache / "models--Qdrant--bge-small-zh-v1.5" / "snapshots"
    if not snapshots.is_dir():
        return False
    for path in snapshots.rglob("model_optimized.onnx"):
        try:
            if path.is_file() and path.stat().st_size > 40 * 1024 * 1024:
                return True
        except OSError:
            continue
    return False


def log(msg: str, **_: Any) -> None:
    """诊断输出一律走 stderr。

    stdio MCP server 的 **stdout 是 JSON-RPC 通道**，任何 stray print 都会破坏协议；
    同时 CLI 自检把结果以 JSON 打到 stdout，也需要 stdout 保持纯净。
    """
    print(msg, file=sys.stderr)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_key(v: str, drop_www: bool = False) -> str:
    """通用归一化：小写、去首尾空白、多空白合一。"""
    s = re.sub(r"\s+", " ", (v or "").strip().lower())
    return s


# ---------------------------------------------------------------------------
# Adapter：字段语义的唯一来源
# ---------------------------------------------------------------------------


@dataclass
class Adapter:
    """字段语义适配层。子类实现下列钩子。"""

    env_prefix: str                   # 环境变量前缀，如 "PAPER_MEMORY"
    data_dir_name: str                # bobo-data 下的目录名
    collection: str                   # Qdrant 集合名
    docs_dir_name: str = ""           # ~/.dsh/skills 下的技能目录名（仅文档用）
    threshold: float = 2.0            # 入库门槛：严格大于才入库
    embed_model: str = "BAAI/bge-small-zh-v1.5"
    embed_dim: int = 512
    confidence_max: float = 5.0
    confidence_floor: float = 1.0
    feedback_step: float = 0.5
    cleanup_max_age_days: int = 90
    cleanup_confidence_max: float = 2.5

    # ── 必由子类实现 ────────────────────────────────────────────────────
    def feature_hash(self, rec: dict) -> str:                      # noqa: D102
        raise NotImplementedError

    def semantic_text(self, rec: dict) -> str:                     # noqa: D102
        raise NotImplementedError

    def payload(self, rec: dict) -> dict:                          # noqa: D102
        raise NotImplementedError

    def dir_key(self, rec: dict) -> str:                           # noqa: D102
        raise NotImplementedError

    def md_content(self, rec: dict) -> str:                        # noqa: D102
        raise NotImplementedError

    def new_record(self, fields: dict) -> dict:                    # noqa: D102
        raise NotImplementedError

    def to_hit(self, src: Any) -> dict:                            # noqa: D102
        raise NotImplementedError

    def build_filter(self, query: dict) -> list:                   # noqa: D102
        raise NotImplementedError

    def local_score(self, rec: dict, query: dict) -> float:        # noqa: D102
        raise NotImplementedError

    def sort_key(self, hit: dict, query: dict) -> tuple:           # noqa: D102
        return (hit.get("confidence", 0),)

    # ── 去重策略：默认「替换」，paper 覆写为「强化」（设计稿 D2）────────
    def merge_duplicate(self, old: dict, new: dict) -> dict:
        """指纹命中时的合并。返回**存活**的记录（默认：新的替换旧的）。"""
        return new

    # ── 可选：返回「本次合并对应的项目键」，用于 confirmed_projects 去重计 ──
    def project_key(self, rec: dict) -> str:
        return ""

    # ── 可选：stats 的额外字段（无则返回空字典）──────────────────────────
    def extra_stats(self, active: dict[str, dict]) -> dict:
        return {}

    @property
    def url_var(self) -> str:
        return f"{self.env_prefix}_QDRANT_URL"

    @property
    def key_var(self) -> str:
        return f"{self.env_prefix}_QDRANT_API_KEY"

    @property
    def conn_var(self) -> str:
        return f"{self.env_prefix}_QDRANT_CONN"

    @property
    def readonly_var(self) -> str:
        return f"{self.env_prefix}_READONLY"

    @property
    def embed_var(self) -> str:
        return f"{self.env_prefix}_EMBEDDING"


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


class ExperienceStore:
    """通用经验库。一个 Adapter 一个实例。"""

    def __init__(self, adapter: Adapter):
        self.a = adapter
        self._dbx = None
        self._dbx_loaded = False
        self._qclient: Any = None
        self._qclient_error = ""
        self._qclient_fail_at = 0.0
        self._dbx_read_error = ""
        self._embedder: Any = None
        self._collection_ready = False

    # ── 路径 ────────────────────────────────────────────────────────────
    def bobo_root(self) -> Optional[Path]:
        dbx = self._load_dbx()
        if dbx:
            try:
                return dbx.find_bobo_root()
            except Exception:
                pass
        if env("BOBO_ROOT"):
            return Path(env("BOBO_ROOT")).resolve()
        cur = Path(__file__).resolve()
        for _ in range(15):
            if (cur / "dbx-runtime").is_dir():
                return cur
            if cur.parent == cur:
                break
            cur = cur.parent
        return None

    def _packaged_data_root(self) -> Optional[Path]:
        cur = Path(__file__).resolve()
        for _ in range(20):
            if (cur / "resources" / "runtime").is_dir():
                sib = cur.parent / "BoBoData"
                return sib if sib.is_dir() else None
            if cur.parent == cur:
                break
            cur = cur.parent
        return None

    def data_dir(self) -> Path:
        if env("DSH_HOME"):
            base = Path(env("DSH_HOME")).parent
        else:
            base = self._packaged_data_root()
            if base is None:
                root = self.bobo_root()
                base = (root / "bobo-data") if root else None
        if base is None:
            raise RuntimeError(
                "无法定位 BoBo 数据目录：缺少 DSH_HOME（MCP 子进程环境被清洗且无打包布局可回退）。"
                "请确认桌面壳注入 DSH_HOME，且 agent 预设的 env 转发块已随包。")
        # 三池数据统一收在 <数据根>/experience-pool/ 下；旧布局（<数据根>/<池名>）作回退
        d = base / "experience-pool" / self.a.data_dir_name
        legacy = base / self.a.data_dir_name
        if not d.is_dir() and legacy.is_dir():
            return legacy
        d.mkdir(parents=True, exist_ok=True)
        return d

    def registry_path(self) -> Path:
        return self.data_dir() / INDEX_FILENAME

    def readiness_path(self) -> Path:
        return self.data_dir() / READINESS_FILENAME

    # ── registry ───────────────────────────────────────────────────────
    def load_registry(self) -> dict[str, dict]:
        p = self.registry_path()
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                return {}
        return {}

    def save_registry(self, reg: dict) -> None:
        p = self.registry_path()
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(reg, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(p)

    # ── 只读模式 ───────────────────────────────────────────────────────
    def is_readonly(self) -> bool:
        if env(self.a.readonly_var) == "1":
            return True
        cfg = self.pool_config()
        if "readonly" in cfg:
            return bool(cfg.get("readonly"))
        return False

    # ── dbx_connector（惰性、多路径兜底）────────────────────────────────
    def _load_dbx(self):
        if self._dbx_loaded:
            return self._dbx
        self._dbx_loaded = True
        cands = []
        dsh_home = env("DSH_HOME")
        bobo_root = env("BOBO_ROOT")
        if dsh_home:
            cands.append(Path(dsh_home) / "skills" / "db-extraction" / "dbx_connector.py")
        if bobo_root:
            cands.append(Path(bobo_root) / "skills" / "db-extraction" / "dbx_connector.py")
        if bobo_root:
            cands.append(Path(bobo_root) / "bobo-data" / "dsh" / "skills" / "db-extraction" / "dbx_connector.py")
        cands += [
            Path(__file__).resolve().parent.parent / "db-extraction" / "dbx_connector.py",
            Path(__file__).resolve().parent.parent.parent / "scripts" / "dbx_connector.py",
        ]
        for cand in cands:
            if cand.is_file():
                import importlib.util
                spec = importlib.util.spec_from_file_location("dbx_connector", cand)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)          # type: ignore[union-attr]
                self._dbx = mod
                return self._dbx
        self._dbx = False
        return None

    POOL_CONFIG_FILENAME = "experience-pool.json"

    # ── Qdrant 端点解析：配置文件 > env 覆盖 > DBX qdrant 连接 ───────────
    def pool_config(self) -> dict:
        """读数据根 experience-pool.json（三个经验池共享同一份）；读失败静默当作未配置。"""
        try:
            d = self.data_dir()
            for p in (d.parent / self.POOL_CONFIG_FILENAME,
                      d.parent.parent / self.POOL_CONFIG_FILENAME):
                if p.is_file():
                    cfg = json.loads(p.read_text(encoding="utf-8"))
                    return cfg if isinstance(cfg, dict) else {}
            return {}
        except Exception:
            return {}

    def endpoint(self) -> tuple[Optional[str], Optional[str]]:
        url, key, _ = self.resolve_endpoint()
        return url, key

    def resolve_endpoint(self) -> tuple[Optional[str], Optional[str], str]:
        """返回 (url, api_key, source)；source 仅用于 readiness 诊断展示。"""
        cfg = self.pool_config()
        if cfg.get("enabled", True):
            u = str(cfg.get("url") or "").strip().rstrip("/")
            if u:
                return u, (str(cfg.get("token") or "").strip() or None), "config"
        url = env(self.a.url_var) or None
        key = env(self.a.key_var) or None
        if url:
            return url, key, "env"
        dbx = self._load_dbx()
        if not dbx:
            return None, None, ""
        conn_name = env(self.a.conn_var) or None
        try:
            root = dbx.find_bobo_root()
        except Exception:
            root = None
        profiles: list[dict[str, Any]] = []
        dbx_err = ""
        for kwargs in ([{"bobo_root": root}] if root else []) + [{}]:
            try:
                profiles = dbx.load_profiles(**kwargs)
                dbx_err = ""
            except Exception as e:
                profiles = []
                dbx_err = f"{type(e).__name__}: {e}"
            if profiles:
                break
        if not profiles:
            self._dbx_read_error = dbx_err
            return None, key, "dbx"
        for p in profiles:
            if (p.get("db_type") or "").lower() != "qdrant":
                continue
            if conn_name and p.get("name") != conn_name:
                continue
            scheme = "https" if p.get("ssl") else "http"
            host = p.get("host") or "127.0.0.1"
            port = int(p.get("port") or 6333)
            k = (p.get("api_key") or p.get("apikey") or p.get("password")
                 or p.get("username") or None)
            return f"{scheme}://{host}:{port}", (k or key), "dbx"
        return None, key, "dbx"

    def client(self):
        """惰性建 Qdrant 客户端；不可用返回 None 并记录原因（降级本地，不静默）。"""
        if self._qclient is not None:
            return self._qclient
        if self._qclient_fail_at and time.monotonic() - self._qclient_fail_at < _QCLIENT_RETRY_TTL:
            return None
        url, key = self.endpoint()
        if not url:
            self._qclient_error = (
                f"未找到 Qdrant 连接：数据根 {self.POOL_CONFIG_FILENAME} 未配置 url、"
                f"DBX 里没有 db_type=qdrant 的连接，"
                f"且未设置 {self.a.url_var}")
            if self._dbx_read_error:
                self._qclient_error += f"。DBX 连接库读取异常：{self._dbx_read_error}"
            return None
        try:
            from qdrant_client import QdrantClient
            c = QdrantClient(url=url, api_key=key or None, timeout=10)
            c.get_collections()
            self._qclient = c
            self._qclient_error = ""
            self._qclient_fail_at = 0.0
            return c
        except Exception as e:
            log(f"[experience_store] Qdrant 不可达（降级本地模式）: {e}")
            self._qclient_fail_at = time.monotonic()
            self._qclient_error = f"Qdrant 不可达 {url}: {e}"
            return None

    def error(self) -> str:
        return self._qclient_error

    def ensure_collection(self, client) -> None:
        if self._collection_ready or client.collection_exists(self.a.collection):
            self._collection_ready = True
            return
        from qdrant_client import models
        client.create_collection(
            self.a.collection,
            vectors_config=models.VectorParams(size=self.a.embed_dim,
                                               distance=models.Distance.COSINE))
        self._collection_ready = True

    # ── 向量化 ─────────────────────────────────────────────────────────
    def embed(self, text: str) -> Optional[list[float]]:
        if env(self.a.embed_var) == "0" or not (text or "").strip():
            return None
        if self._embedder is None:
            cache = embed_cache_dir()
            if not embed_model_present(cache):
                # 模型还没下好（启动器在后台按需下载）→ 立刻退化，绝不联网 HF：
                # 离线机器上那条路会先重试 3+9+27 秒，再撞 60s 工具超时。
                log("[experience_store] 向量模型未就绪（按需下载中），本次退化为关键词检索")
                self._embedder = False
            else:
                try:
                    os.environ.setdefault("HF_HUB_OFFLINE", "1")
                    from fastembed import TextEmbedding
                    self._embedder = TextEmbedding(
                        self.a.embed_model, cache_dir=str(cache), local_files_only=True)
                    log(f"[experience_store] embedding 就绪（本地缓存）: {self.a.embed_model}")
                except Exception as e:
                    log(f"[experience_store] embedding 加载失败（退化为关键词检索）: {e}")
                    self._embedder = False
        emb = self._embedder or None
        if emb is None:
            return None
        try:
            return [float(x) for x in next(emb.embed([text[:2000]]))]
        except Exception as e:
            log(f"[experience_store] 向量化失败: {e}")
            return None

    # ── readiness ──────────────────────────────────────────────────────
    def probe_readiness_http(self) -> dict:
        """启动期探活：只用 stdlib HTTP 判断 Qdrant 可达性，**不 import qdrant_client**。

        为什么单独做一个：MCP 服务在启动时会探活一次并把结果写 `readiness.json`
        （经验闸门据此判断是否启用）。走 `client()` 那条路会 `import qdrant_client`，
        实测常驻内存 +106MB/进程；而启动只需要"通不通"，一个 `GET /collections`
        就够。真正用到向量检索时（工具调用）才走 `client()` 惰性建客户端。

        @returns readiness 字典（字段与 {@link readiness} 一致）。
        """
        url, key, source = self.resolve_endpoint()
        reachable = False
        error = ""
        if not url:
            error = (
                f"未找到 Qdrant 连接：数据根 {self.POOL_CONFIG_FILENAME} 未配置 url、"
                f"DBX 里没有 db_type=qdrant 的连接，且未设置 {self.a.url_var}"
            )
            if self._dbx_read_error:
                error += f"。DBX 连接库读取异常：{self._dbx_read_error}"
        else:
            try:
                req = urllib.request.Request(f"{url}/collections", method="GET")
                if key:
                    req.add_header("api-key", key)
                with urllib.request.urlopen(req, timeout=4) as resp:  # noqa: S310 —— 只连本仓配置的地址
                    reachable = 200 <= int(getattr(resp, "status", 0)) < 300
            except Exception as exc:  # noqa: BLE001
                error = f"{type(exc).__name__}: {exc}"
        return {
            "ready": reachable,
            "qdrant_configured": bool(url),
            "qdrant_reachable": reachable,
            "qdrant_url": url or "",
            "qdrant_source": source,
            "error": error or self.error(),
            "readonly": self.is_readonly(),
            "threshold": self.a.threshold,
            "collection": self.a.collection,
            "checked_at": now_iso(),
        }

    def write_readiness_http(self) -> dict:
        """写 readiness（HTTP 探活版）：原子替换，失败不抛。"""
        state = self.probe_readiness_http()
        try:
            p = self.readiness_path()
            tmp = p.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(p)
        except Exception as e:
            log(f"[experience_store] 写就绪状态失败: {e}", file=sys.stderr)
        return state

    def readiness(self) -> dict:
        url, _, source = self.resolve_endpoint()
        c = self.client()
        return {
            "ready": c is not None,
            "qdrant_configured": bool(url),
            "qdrant_reachable": c is not None,
            "qdrant_url": url or "",
            "qdrant_source": source,
            "error": self.error(),
            "readonly": self.is_readonly(),
            "threshold": self.a.threshold,
            "collection": self.a.collection,
            "checked_at": now_iso(),
        }

    def write_readiness(self) -> dict:
        state = self.readiness()
        try:
            p = self.readiness_path()
            tmp = p.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(p)
        except Exception as e:
            log(f"[experience_store] 写就绪状态失败: {e}", file=sys.stderr)
        return state

    # ── MD 落盘 ────────────────────────────────────────────────────────
    def md_path_for(self, rec: dict) -> Path:
        ts = rec["created_at"].replace(":", "-").replace("+00:00", "Z")
        return self.data_dir() / self.a.dir_key(rec) / f"{ts}-{rec['id'][:8]}.md"

    def write_md(self, rec: dict) -> Path:
        p = self.md_path_for(rec)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(self.a.md_content(rec), encoding="utf-8")
        rec["md_path"] = str(p)
        return p

    def refresh_md(self, rec: dict) -> None:
        """把 registry 中的最新字段确定性回写 MD（置信度/归档/待同步标记）。"""
        p = Path(rec.get("md_path") or "")
        if not p.is_file():
            return
        text = p.read_text(encoding="utf-8")
        text = re.sub(r"^\- 置信度: .*$", f"- 置信度: {rec.get('confidence')}", text,
                      count=1, flags=re.M)
        lines = [ln for ln in text.splitlines() if not ln.startswith("> 📡")]
        if rec.get("qdrant_pending"):
            if lines and lines[-1] != "":
                lines.append("")
            lines.append("> 📡 Qdrant 未同步（服务器不可达，向量同步待恢复）")
        lines = [ln for ln in lines if not ln.startswith("> ⚠️")]
        if rec.get("archived"):
            if lines and lines[-1] != "":
                lines.append("")
            note = rec.get("archive_reason") or "已归档（未达门槛或已被合并），仅供参考"
            lines.append(f"> ⚠️ {note}")
        p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # ── 检索 ───────────────────────────────────────────────────────────
    def _filter_of(self, query: dict):
        from qdrant_client import models
        must = [models.FieldCondition(key="confidence",
                                      range=models.Range(gt=self.a.threshold))]
        must += self.a.build_filter(query)
        return models.Filter(must=must)

    def _has_conditions(self, query: dict) -> bool:
        return bool(self.a.build_filter(query))

    def _qdrant_hits(self, client, query: dict, vec: Optional[list[float]],
                     limit: int) -> tuple[list[dict], str]:
        """返回 (hits, mode)。有向量走语义检索；**只有结构化过滤条件时走 scroll**。

        为什么需要 scroll 分支：只按标签/阶段过滤（不给检索词）时没有可嵌入的文本，
        若直接退回本地检索，客户端本地 registry 不全时会**静默少给结果**。
        Qdrant 侧 scroll 至少保证看到的是库里的全量候选。
        """
        try:
            if vec is not None:
                res = client.query_points(self.a.collection, query=vec,
                                          query_filter=self._filter_of(query),
                                          limit=limit, with_payload=True)
                return [self.a.to_hit(pt) for pt in res.points], "vector"
            if not self._has_conditions(query):
                return [], "local"
            pts, _ = client.scroll(self.a.collection, scroll_filter=self._filter_of(query),
                                   limit=limit, with_payload=True)
            return [self.a.to_hit(pt) for pt in pts], "filter"
        except Exception as e:
            log(f"[experience_store] 向量检索失败: {e}")
            return [], "local"

    def _local_hits(self, query: dict, limit: int) -> list[dict]:
        reg = self.load_registry()
        scored: list[tuple[float, dict]] = []
        for r in reg.values():
            if r.get("archived") or r.get("merged_into"):
                continue
            if float(r.get("confidence") or 0) <= self.a.threshold:
                continue
            s = self.a.local_score(r, query)
            if s > 0:
                scored.append((s, self.a.to_hit(r)))
        scored.sort(key=lambda x: (-x[0], -x[1].get("confidence", 0)))
        return [h for _, h in scored[:limit]]

    def search(self, query: dict, top_k: int = 5) -> dict:
        """混合检索。query 为 Adapter 可理解的检索字段字典。

        mode 取值：`vector`（语义检索）/ `filter`（仅结构化过滤，Qdrant scroll）/
        `local`（Qdrant 不可达或不可用，降级本地检索——**覆盖面明显更小**）。
        """
        top_k = max(1, min(int(top_k or 5), 10))
        text = (query.get("text") or "").strip()
        client = self.client()
        hits: list[dict] = []
        mode = "local"
        vec = self.embed(text) if text else None
        if client is not None:
            hits, mode = self._qdrant_hits(client, query, vec, top_k * 3)
        if not hits:
            hits = self._local_hits(query, top_k * 3)
            mode = "local"
        hits.sort(key=lambda h: self.a.sort_key(h, query), reverse=True)
        return {"count": len(hits[:top_k]), "mode": mode, "items": hits[:top_k]}

    # ── 沉淀 ───────────────────────────────────────────────────────────
    def _find_by_hash(self, reg: dict, fh: str) -> Optional[dict]:
        for r in reg.values():
            if r.get("feature_hash") == fh and not r.get("archived") and not r.get("merged_into"):
                return r
        return None

    def save(self, fields: dict) -> dict:
        if self.is_readonly():
            raise RuntimeError("当前为只读模式，不允许写入经验。")
        rec = self.a.new_record(fields)
        if float(rec["confidence"]) <= self.a.threshold:
            return {
                "saved": False,
                "reason": "confidence_not_above_threshold_discarded",
                "message": (f"置信度 {rec['confidence']} 未超过入库门槛 {self.a.threshold}，已直接放弃："
                            "不写本地 MD、不入 Qdrant。请按技能里的锚点如实自评。"),
                "id": None,
                "confidence": rec["confidence"],
                "threshold": self.a.threshold,
            }
        rec["feature_hash"] = self.a.feature_hash(rec)
        self.write_md(rec)

        reg = self.load_registry()
        reg[rec["id"]] = rec

        old = self._find_by_hash(reg, rec["feature_hash"])
        reinforced = False
        if old is not None and old.get("id") != rec["id"]:
            merged = self.a.merge_duplicate(old, rec)
            # 被合并掉的那条留档但不可检索（可审计，不污染检索）
            loser = rec if merged.get("id") == old.get("id") else old
            winner = merged
            reg[winner["id"]] = winner
            loser = dict(loser)
            loser["archived"] = True
            loser["merged_into"] = winner["id"]
            loser["archive_reason"] = f"已合并进 {winner['id']}（同指纹经验强化）"
            reg[loser["id"]] = loser
            self.refresh_md(loser)
            rec_to_sync = winner
            reinforced = True
        else:
            rec_to_sync = rec

        self.save_registry(reg)
        synced = self.sync_one(rec_to_sync, reg)
        self.refresh_md(rec_to_sync)
        self.save_registry(reg)
        self.write_readiness()

        out = {
            "saved": True,
            "reason": "stored" if synced else "stored_local_qdrant_pending",
            "id": rec_to_sync["id"],
            "confidence": rec_to_sync["confidence"],
            "md_path": rec_to_sync.get("md_path", ""),
            "qdrant_synced": synced,
            "collection": self.a.collection,
        }
        if reinforced:
            out["reinforced_existing"] = True
            out["superseded_id"] = None if rec_to_sync["id"] == rec["id"] else rec["id"]
            out["message"] = ("同指纹经验已存在：按「强化」策略合并（lessons 取并集、"
                              "confidence = max(旧,新)+0.5、confirmed_projects 累加），未新建重复条目。")
        if not synced:
            out["qdrant_error"] = self.error()
        return out

    def sync_one(self, rec: dict, reg: dict) -> bool:
        client = self.client()
        if client is None:
            rec["qdrant_pending"] = True
            self.save_registry(reg)
            return False
        try:
            from qdrant_client import models
            self.ensure_collection(client)
            vec = self.embed(self.a.semantic_text(rec))
            if vec is None:
                raise RuntimeError("embedding 不可用")
            client.upsert(self.a.collection, points=[models.PointStruct(
                id=rec["id"], vector=vec, payload=self.a.payload(rec))])
            rec["qdrant_pending"] = False
            rec["qdrant_point_id"] = rec["id"]
            self.save_registry(reg)
            return True
        except Exception as e:
            log(f"[experience_store] Qdrant 同步失败（保留本地）: {e}")
            rec["qdrant_pending"] = True
            self.save_registry(reg)
            return False

    # ── 反馈 ───────────────────────────────────────────────────────────
    def feedback(self, experience_id: str, outcome: str) -> dict:
        if self.is_readonly():
            raise RuntimeError("当前为只读模式，不允许写入。")
        if outcome not in ("success", "fail"):
            raise ValueError("outcome 必须是 'success' 或 'fail'")
        delta = self.a.feedback_step if outcome == "success" else -self.a.feedback_step
        reg = self.load_registry()
        rec = reg.get(experience_id)
        if rec is None:
            raise LookupError(f"找不到经验 {experience_id}，无法反馈。")
        rec["confidence"] = round(
            max(self.a.confidence_floor,
                min(self.a.confidence_max, float(rec["confidence"]) + delta)), 1)
        rec["used_count"] = int(rec.get("used_count", 0)) + 1
        rec["updated_at"] = now_iso()

        action = "updated"
        client = self.client()
        if float(rec["confidence"]) <= self.a.threshold:
            if client is not None and rec.get("qdrant_point_id"):
                from qdrant_client import models
                try:
                    client.delete(self.a.collection, points_selector=models.PointIdsList(
                        points=[rec["qdrant_point_id"]]))
                except Exception as e:
                    log(f"[experience_store] 移除失败: {e}")
            rec["qdrant_point_id"] = None
            rec["archived"] = True
            rec["archive_reason"] = "置信度跌破门槛，已出库"
            action = "removed"
        elif client is not None and rec.get("qdrant_point_id"):
            try:
                client.set_payload(self.a.collection,
                                   {"confidence": rec["confidence"],
                                    "used_count": rec["used_count"],
                                    "updated_at": rec["updated_at"]},
                                   points=[rec["qdrant_point_id"]])
            except Exception as e:
                log(f"[experience_store] payload 更新失败: {e}")
        self.save_registry(reg)
        self.refresh_md(rec)
        return {"experience_id": experience_id, "action": action,
                "confidence": rec["confidence"], "used_count": rec["used_count"],
                "archived": rec.get("archived", False), "threshold": self.a.threshold}

    # ── 冷归档 ─────────────────────────────────────────────────────────
    def cleanup(self, dry_run: bool = True, max_age_days: Optional[int] = None) -> dict:
        if self.is_readonly() and not dry_run:
            raise RuntimeError("当前为只读模式，不允许清理。")
        days = self.a.cleanup_max_age_days if max_age_days is None else int(max_age_days)
        reg = self.load_registry()
        now = time.time()
        cands = []
        for rid, r in reg.items():
            if r.get("archived") or r.get("merged_into") or r.get("used_count", 0) > 0:
                continue
            if float(r.get("confidence", 0)) >= self.a.cleanup_confidence_max:
                continue
            if r.get("qdrant_pending"):
                continue
            try:
                age = now - datetime.fromisoformat(r.get("created_at", "")).timestamp()
            except Exception:
                age = float("inf")
            if age >= days * 86400:
                cands.append(rid)
        if not dry_run and cands:
            client = self.client()
            if client is not None:
                from qdrant_client import models
                ids = [reg[r]["qdrant_point_id"] for r in cands if reg[r].get("qdrant_point_id")]
                if ids:
                    try:
                        client.delete(self.a.collection,
                                      points_selector=models.PointIdsList(points=ids))
                    except Exception as e:
                        log(f"[experience_store] 清理删除失败: {e}")
            for r in cands:
                reg[r]["archived"] = True
                reg[r]["archive_reason"] = f"冷归档（{days} 天未复用且置信度偏低）"
                reg[r]["updated_at"] = now_iso()
                self.refresh_md(reg[r])
            self.save_registry(reg)
        return {"dry_run": dry_run, "candidates": cands, "count": len(cands),
                "max_age_days": days}

    # ── 全量补同步 ─────────────────────────────────────────────────────
    def sync_local_to_qdrant(self) -> dict:
        if self.is_readonly():
            raise RuntimeError("当前为只读模式，不允许同步。")
        reg = self.load_registry()
        client = self.client()
        if client is None:
            return {"synced": 0, "qdrant_reachable": False,
                    "pending": sum(1 for r in reg.values()
                                   if not r.get("archived") and not r.get("merged_into"))}
        from qdrant_client import models
        self.ensure_collection(client)
        synced = 0
        for rid, rec in reg.items():
            if rec.get("archived") or rec.get("merged_into"):
                continue
            vec = self.embed(self.a.semantic_text(rec))
            if vec is None:
                continue
            try:
                client.upsert(self.a.collection, points=[models.PointStruct(
                    id=rid, vector=vec, payload=self.a.payload(rec))])
                rec["qdrant_pending"] = False
                rec["qdrant_point_id"] = rid
                synced += 1
            except Exception as e:
                log(f"[experience_store] 同步失败 {rid}: {e}")
        self.save_registry(reg)
        return {"synced": synced, "qdrant_reachable": True}

    # ── 统计 ───────────────────────────────────────────────────────────
    def stats(self) -> dict:
        reg = self.load_registry()
        client = self.client()
        self.write_readiness()
        active = {k: v for k, v in reg.items()
                  if not v.get("archived") and not v.get("merged_into")}
        by_result: dict[str, int] = {}
        for r in active.values():
            by_result[r.get("result", "?")] = by_result.get(r.get("result", "?"), 0) + 1
        qcount = None
        if client is not None:
            try:
                qcount = client.count(self.a.collection, exact=True).count
            except Exception:
                qcount = None
        base = {
            "readonly": self.is_readonly(),
            "qdrant_reachable": client is not None,
            "qdrant_url": self.endpoint()[0] or "",
            "collection": self.a.collection,
            "threshold": self.a.threshold,
            "threshold_rule": f"confidence > {self.a.threshold}",
            "qdrant_error": self.error(),
            "data_dir": str(self.data_dir()),
            "local_active_count": len(active),
            "local_archived_count": len(reg) - len(active),
            "qdrant_point_count": qcount,
            "by_result": by_result,
        }
        base.update(self.a.extra_stats(active))
        return base

    # ── 命令行自检入口（子类可复用）────────────────────────────────────
    def purge_below_threshold(self, dry_run: bool = True,
                              threshold: Optional[float] = None) -> dict:
        """清理存量「未超过入库门槛」的记录（门槛上调后的一次性对齐）。"""
        if self.is_readonly() and not dry_run:
            raise RuntimeError("当前为只读模式，不允许清理。")
        thr = self.a.threshold if threshold is None else float(threshold)
        reg = self.load_registry()
        local = [{"id": rid, "confidence": r.get("confidence"),
                  "md_path": r.get("md_path", ""),
                  "qdrant_point_id": r.get("qdrant_point_id")}
                 for rid, r in reg.items() if float(r.get("confidence") or 0) <= thr]
        out = {"threshold": thr, "dry_run": bool(dry_run), "local_count": len(local),
               "local": local, "qdrant_reachable": self.client() is not None}
        if dry_run:
            return out
        client = self.client()
        if client is not None:
            from qdrant_client import models
            ids = [x["qdrant_point_id"] for x in local if x["qdrant_point_id"]]
            if ids:
                try:
                    client.delete(self.a.collection,
                                  points_selector=models.PointIdsList(points=ids))
                except Exception as e:
                    log(f"[experience_store] 存量删除失败: {e}")
        removed_md = 0
        for x in local:
            p = Path(x["md_path"]) if x["md_path"] else None
            if p and p.is_file():
                try:
                    p.unlink()
                    removed_md += 1
                    try:
                        p.parent.rmdir()
                    except OSError:
                        pass
                except OSError as e:
                    log(f"[experience_store] 删除 MD 失败 {p}: {e}")
            reg.pop(x["id"], None)
        self.save_registry(reg)
        out.update({"purged_local": len(local), "removed_md": removed_md})
        return out
