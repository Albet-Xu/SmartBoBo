# -*- coding: utf-8 -*-
"""
爬虫脚本模板（reverse-crawler 技能提供）— 通用骨架可复用，勿重写。
生成脚本时：
 1. 复制本文件为 <目标>.py，改底部「⛏️ TARGET-CUSTOM 目标定制区」；
 2. 只修改标有 `# ⛏️ TARGET-CUSTOM` 的区域，其余保持不变；
 3. 输出统一为 Markdown，按站点归类保存到当前工作区 data/<站点键>/；
    每次落盘自动维护同目录 manifest.json（url/标题/内容hash/时间），
    支持 `--incremental` 增量采集（只抓新增/内容变化的条目，省时省 token）。
依赖：requests（必装）；需要浏览器渲染时用内置 camoufox（`.venv` 已装，
或 `pip install camoufox`）；可选 html2text（无则用内置简单转换）。
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import requests
except ImportError:  # pragma: no cover
    sys.exit("缺少依赖 requests，请先执行: pip install requests")

# ---------------------------------------------------------------------------
# 风格常量（如需整体风格统一，仅改这里）
# ---------------------------------------------------------------------------
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
OUT_DIR = Path("data")          # 数据根目录：<工作区>/data/<站点键>/，也可用 --output 指定单文件
TIMEOUT = 20
RETRIES = 3
RETRY_BACKOFF = 2.0             # 秒；每次失败翻倍
MANIFEST_NAME = "manifest.json"  # 增量状态源：采集/入库脚本共同维护


# ---------------------------------------------------------------------------
# 通用骨架：命令行参数
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="采集某网站数据并输出为 Markdown（支持增量）")
    p.add_argument("--url", help="目标 URL（缺省用 build_default_url()）")
    p.add_argument("--cookie", default="", help="登录 Cookie（可选）")
    p.add_argument("--headers", default="", help="附加请求头，k=v;k2=v2（可选）")
    p.add_argument("--output", default="", help="输出文件名（仅非增量模式；缺省自动生成）")
    p.add_argument("--timeout", type=int, default=TIMEOUT, help="单次请求超时（秒）")
    p.add_argument("--retries", type=int, default=RETRIES, help="失败重试次数")
    p.add_argument("--delay", type=float, default=0.0, help="每次请求间隔秒数（限速）")
    p.add_argument("--browser", action="store_true", help="强制用内置 camoufox 浏览器渲染")
    p.add_argument("--incremental", action="store_true",
                   help="增量模式：与 data/<站点键>/manifest.json 对比，只处理新增/内容变化的条目")
    p.add_argument("--force", action="store_true", help="增量模式下强制重抓（忽略内容 hash 对比）")
    p.add_argument("--limit", type=int, default=0, help="最多处理前 N 条候选（0=全部）")
    p.add_argument("--manifest", default="", help="manifest 路径（缺省 data/<站点键>/manifest.json）")
    return p


def parse_headers(extra: str) -> dict[str, str]:
    """把 'k=v;k2=v2' 解析成请求头字典。"""
    out: dict[str, str] = {}
    for seg in extra.split(";"):
        seg = seg.strip()
        if not seg:
            continue
        if "=" in seg:
            k, v = seg.split("=", 1)
            out[k.strip()] = v.strip()
    return out


# ---------------------------------------------------------------------------
# 通用骨架：站点键与目录（按网站名归类）
# ---------------------------------------------------------------------------
def _site_key() -> str:
    """站点键 = TARGET-CUSTOM 区 SITE_KEY（域名去 www.，如 news.qq.com）；未填则由 URL 推导。"""
    return globals().get("SITE_KEY") or ""


def site_key(url: str) -> str:
    key = _site_key()
    if key:
        return key
    host = urlparse(url).netloc or urlparse(url).path
    host = host.split("@")[-1].split(":")[0].replace("www.", "").strip()
    return host or "unknown"


def site_data_dir() -> Path:
    """数据目录：<工作区>/data/<站点键>/（不存在时由 save_markdown 自动创建）。"""
    return OUT_DIR / (_site_key() or "unknown")


# ---------------------------------------------------------------------------
# 通用骨架：增量状态（manifest.json）
# ---------------------------------------------------------------------------
def manifest_path(data_dir: Path) -> Path:
    return data_dir / MANIFEST_NAME


def load_manifest(data_dir: Path) -> dict:
    """读取 <站点>/manifest.json；不存在或损坏时返回空 manifest。"""
    p = manifest_path(data_dir)
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 — 损坏则重建
            pass
    return {"site": _site_key(), "updated_at": "", "items": []}


def save_manifest(data_dir: Path, manifest: dict) -> Path:
    manifest["site"] = _site_key() or manifest.get("site", "")
    manifest["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    data_dir.mkdir(parents=True, exist_ok=True)
    p = manifest_path(data_dir)
    p.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def hash_text(text: str) -> str:
    """内容指纹（16 位 sha256）：增量对比"页面内容是否变化"用。"""
    return hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# 通用骨架：请求与会话（重试 + 限速）
# ---------------------------------------------------------------------------
def make_session(args: argparse.Namespace) -> requests.Session:
    s = requests.Session()
    hdrs = {"User-Agent": DEFAULT_UA}
    hdrs.update(parse_headers(args.headers))
    s.headers.update(hdrs)
    if args.cookie:
        s.headers["Cookie"] = args.cookie
    return s


def fetch(session: requests.Session, url: str, args: argparse.Namespace) -> requests.Response:
    """带重试与退避的 GET，返回最终响应；连续失败抛异常。"""
    last: Exception | None = None
    for attempt in range(1, args.retries + 1):
        try:
            resp = session.get(url, timeout=args.timeout)
            resp.raise_for_status()
            if args.delay > 0:
                time.sleep(args.delay)
            return resp
        except Exception as e:  # noqa: BLE001 — 任何网络/HTTP 错误都进入重试
            last = e
            if attempt < args.retries:
                time.sleep(RETRY_BACKOFF ** attempt)
    raise RuntimeError(f"请求 {url} 失败（重试 {args.retries} 次）: {last}")


def render_html(url: str, args: argparse.Namespace) -> str:
    """用内置 camoufox（抗检测 Firefox 内核）渲染页面并返回完整 HTML。

    仅当页面需要 JS 渲染时使用（needs_render 判定 / --browser 强制）。
    必须用 BoBo 的 .venv python 运行（已装 camoufox）；缺库时给出安装命令。
    """
    try:
        from camoufox.sync_api import Camoufox
    except ImportError:  # pragma: no cover
        sys.exit("需要 camoufox 渲染页面：请用 BoBo 的 .venv/Scripts/python.exe 运行，"
                 "或先执行: pip install camoufox")
    with Camoufox(headless=True) as browser:
        page = browser.new_page()
        if args.cookie:
            page.set_extra_http_headers({"Cookie": args.cookie})
        page.goto(url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
        page.wait_for_timeout(1500)   # 等主要 JS 渲染完成（可按站点调整）
        return page.content()


def fetch_html(session: requests.Session, url: str, args: argparse.Namespace) -> str:
    """取页面 HTML：默认 requests；needs_render 判定需要渲染或 --browser 时用 camoufox。"""
    resp = fetch(session, url, args)
    if args.browser or needs_render(url, resp.text):
        return render_html(url, args)
    return resp.text


# ---------------------------------------------------------------------------
# 通用骨架：HTML → Markdown 简单转换（无 html2text 时的降级）
# ---------------------------------------------------------------------------
def _simple_html_to_markdown(text: str) -> str:
    """极简 HTML 转 Markdown：去标签、解析链接/图片/标题/换行。不够精细，仅供兜底。"""

    class _P(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.parts: list[str] = []
            self.skip = 0
            self._pre = False

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            a = dict(attrs)
            if tag in ("script", "style", "noscript", "iframe"):
                self.skip += 1
            elif tag == "pre":
                self._pre = True
            elif tag == "br":
                self.parts.append("\n")
            elif tag == "li":
                self.parts.append("\n- ")
            elif tag in ("p", "h1", "h2", "h3", "h4", "tr"):
                self.parts.append("\n\n")
            elif tag == "a":
                self.parts.append(f"[{a.get('href') or ''}]".join([]) or "")
            elif tag == "img":
                self.parts.append(f"![image]({a.get('src') or ''})")
            elif tag in ("b", "strong"):
                self.parts.append("**")
            elif tag in ("i", "em"):
                self.parts.append("_")
            elif tag in ("h1",):
                self.parts.append("# ")
            elif tag in ("h2",):
                self.parts.append("## ")
            elif tag in ("h3",):
                self.parts.append("### ")
            elif tag == "td":
                self.parts.append(" | ")

        def handle_endtag(self, tag: str) -> None:
            if tag in ("script", "style", "noscript", "iframe"):
                self.skip = max(0, self.skip - 1)
            elif tag == "pre":
                self._pre = False
            elif tag in ("b", "strong", "i", "em"):
                self.parts.append("**" if tag in ("b", "strong") else "_")
            elif tag in ("p", "tr"):
                self.parts.append("\n\n")

        def handle_data(self, data: str) -> None:
            if self.skip:
                return
            if self._pre:
                self.parts.append(data)
            else:
                self.parts.append(html.unescape(re.sub(r"\s+", " ", data)))

    p = _P()
    p.feed(text)
    out = "".join(p.parts)
    # 合并多余空行
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def html_to_markdown(raw: str, prefer_html2text: bool = True) -> str:
    """优先用 html2text（若安装），否则降级到内置简单转换。"""
    if prefer_html2text:
        try:
            import html2text  # type: ignore
            h = html2text.HTML2Text()
            h.body_width = 0
            h.ignore_images = False
            return h.handle(raw).strip()
        except Exception:  # noqa: BLE001 — 缺库或转换失败都走降级
            pass
    return _simple_html_to_markdown(raw)


def extract_title(html_text: str) -> str:
    """从 HTML <title> 提取标题（供命名/汇报；拿不到返回空串）。"""
    m = re.search(r"<title[^>]*>([^<]*)</title>", html_text, re.S | re.I)
    return html.unescape(m.group(1)).strip() if m else ""


# ---------------------------------------------------------------------------
# 通用骨架：文件名与保存
# ---------------------------------------------------------------------------
def safe_name(name: str, limit: int = 60) -> str:
    name = re.sub(r"[\\/:*?\"<>|\s]+", "_", name).strip("_")
    return name[:limit] or "page"


def build_filename(url: str, title: str, ts: str | None = None) -> str:
    host = urlparse(url).netloc.replace("www.", "")
    ts = ts or time.strftime("%Y%m%d-%H%M%S")
    return f"{safe_name(host, 30)}_{safe_name(title, 40)}_{ts}.md"


def save_markdown(markdown_body: str, title: str, url: str,
                  out_dir: Path | None = None, out_file: str = "") -> Path:
    """把 Markdown 保存到 data/<站点键>/ 目录；目录不存在则自动创建。返回保存路径。"""
    out_dir = (out_dir or site_data_dir()).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = out_file or build_filename(url, title)
    path = out_dir / fname
    header = f"# {title}\n\n> 来源: {url}\n\n"
    path.write_text(header + markdown_body, encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# ⛏️ TARGET-CUSTOM —— 目标定制区（生成脚本时只改这里）
# ---------------------------------------------------------------------------
SITE_KEY = ""   # 站点键 = 域名去 www.（如 "news.qq.com"）；留空则从 URL 自动推导


def build_default_url() -> str:
    """目标网站默认采集 URL（逆向后确定的网址/接口）。"""
    return "https://example.com/list"


def needs_render(url: str, html_text: str) -> bool:
    """是否需要浏览器渲染：默认静态页走 requests；空壳/SPA 用 camoufox。
    已知需 JS 渲染的站点：直接 return True（例如内容在 JS 异步加载的列表/详情页）。"""
    if "<body" not in html_text or len(html_text) < 300:
        return True
    return False


def list_candidates(session: requests.Session, args: argparse.Namespace) -> list[tuple[str, str]]:
    """返回候选条目 [(url, 标题), ...]：从列表页/接口分页解析出本次要采集的所有条目。
    --incremental 模式下只处理其中"新增或内容变化"的条目；非增量模式只取第一条作为单文档采集。
    默认：单页采集（[默认 URL, 站点名]）。列表型站点在生成时改写此函数（翻页、取链接）。"""
    return [(args.url or build_default_url(), site_key(args.url or build_default_url()))]


def parse_data(html_text: str, session: requests.Session, args: argparse.Namespace) -> str:
    """把页面 HTML 转成 Markdown 字符串（本次采集的核心解析逻辑）。

    html_text 可能来自 requests（静态页）或 camoufox 渲染（JS 页），
    处理前可先用 extract_title(html_text) 取标题。
    ## 典型做法（按需改写）：
    # 1) 若接口返回 JSON：data = json.loads(html_text)，遍历条目组装 Markdown。
    # 2) 若是 HTML：markdown = html_to_markdown(html_text)，再按需裁剪/提取。
    """
    return html_to_markdown(html_text)


def collect_all(session: requests.Session, args: argparse.Namespace) -> str:
    """（兼容入口）一次性采集单个 URL 并返回 Markdown。自定义翻页逻辑也可在此实现。"""
    url = args.url or build_default_url()
    html_text = fetch_html(session, url, args)
    return parse_data(html_text, session, args)


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def main() -> int:
    args = build_parser().parse_args()
    session = make_session(args)
    data_dir = site_data_dir()
    try:
        if args.incremental:
            manifest = load_manifest(data_dir)
            known = {it["url"]: it for it in manifest["items"]}
            candidates = list_candidates(session, args)
            if args.limit > 0:
                candidates = candidates[: args.limit]
            new_cnt = updated_cnt = skipped_cnt = 0
            for url, title in candidates:
                html_text = fetch_html(session, url, args)
                h = hash_text(html_text)
                prev = known.get(url)
                if prev and prev.get("content_hash") == h and not args.force:
                    skipped_cnt += 1
                    continue
                body = parse_data(html_text, session, args)
                fname = (prev or {}).get("file", "")
                saved = save_markdown(body, title or extract_title(html_text) or site_key(url),
                                      url, data_dir, fname)
                known[url] = {
                    "url": url,
                    "title": title or extract_title(html_text) or site_key(url),
                    "crawled_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "content_hash": h,          # HTML 指纹：本脚本增量对比用
                    "file_hash": hash_text(body),  # 落盘文件指纹：提取脚本增量对比用
                    "file": saved.name,
                }
                if prev:
                    updated_cnt += 1
                else:
                    new_cnt += 1
            manifest["items"] = list(known.values())
            mp = save_manifest(data_dir, manifest)
            print(f"增量采集完成：新增 {new_cnt}，更新 {updated_cnt}，跳过 {skipped_cnt}（未变化）。")
            print(f"manifest: {mp}")
        else:
            url = args.url or build_default_url()
            html_text = fetch_html(session, url, args)
            body = parse_data(html_text, session, args)
            title = extract_title(html_text) or site_key(url)
            saved = save_markdown(body, title, url, data_dir, args.output)
            # 单文档也登记进 manifest，保证后续 --incremental 可识别
            manifest = load_manifest(data_dir)
            known = {it["url"]: it for it in manifest["items"]}
            known[url] = {
                "url": url,
                "title": title,
                "crawled_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "content_hash": hash_text(html_text),
                "file_hash": hash_text(body),
                "file": saved.name,
            }
            manifest["items"] = list(known.values())
            save_manifest(data_dir, manifest)
            print(f"已保存: {saved}")
            print(f"运行: python {Path(__file__).name} --url <目标> [--cookie ...] [--incremental]")
        return 0
    except Exception as e:  # noqa: BLE001 — 顶层兜底，避免静默失败
        print(f"采集失败: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())