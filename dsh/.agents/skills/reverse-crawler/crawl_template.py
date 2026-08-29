# -*- coding: utf-8 -*-
"""
爬虫脚本模板（reverse-crawler 技能提供）— 通用骨架可复用，勿重写。
生成脚本时：
 1. 复制本文件为 <目标>.py，改底部 `__main__` 与「目标定制区」；
 2. 只修改标有 `# ⛏️ TARGET-CUSTOM` 的区域，其余保持不变；
 3. 输出统一为 Markdown，保存到当前工作区 data/ 目录。
依赖：requests（若未安装，先 `pip install requests`）；可选 html2text（无则用内置简单转换）。
"""
from __future__ import annotations

import argparse
import html
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
OUT_DIR = Path("data")          # 相对当前工作区；也可用 --output 指定
TIMEOUT = 20
RETRIES = 3
RETRY_BACKOFF = 2.0             # 秒；每次失败翻倍


# ---------------------------------------------------------------------------
# 通用骨架：命令行参数
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="采集某网站数据并输出为 Markdown")
    p.add_argument("--url", help="目标 URL（缺省用 build_default_url()）")
    p.add_argument("--cookie", default="", help="登录 Cookie（可选）")
    p.add_argument("--headers", default="", help="附加请求头，k=v;k2=v2（可选）")
    p.add_argument("--output", default="", help="输出文件名（缺省自动生成）")
    p.add_argument("--timeout", type=int, default=TIMEOUT, help="单次请求超时（秒）")
    p.add_argument("--retries", type=int, default=RETRIES, help="失败重试次数")
    p.add_argument("--delay", type=float, default=0.0, help="每次请求间隔秒数（限速）")
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
                  out_dir: Path = OUT_DIR, out_file: str = "") -> Path:
    """把 Markdown 保存到 data/ 目录；目录不存在则自动创建。返回保存路径。"""
    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = out_file or build_filename(url, title)
    path = out_dir / fname
    header = f"# {title}\n\n> 来源: {url}\n\n"
    path.write_text(header + markdown_body, encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# ⛏️ TARGET-CUSTOM —— 目标定制区（生成脚本时只改这里）
# ---------------------------------------------------------------------------
def build_default_url() -> str:
    """目标网站默认采集 URL（逆向后确定的网址/接口）。"""
    return "https://example.com/list"


def prepare_request(args: argparse.Namespace) -> dict[str, Any]:
    """构造本网站特有的请求参数：签名、方式、数据、请求头等。"""
    # 逆向要点：在此填写 js-reverse 分析出的接口签名/加密参数、翻页参数等。
    return {
        "url": args.url or build_default_url(),
        "method": "GET",
        "extra": {},      # data / params / json 等
    }


def parse_data(raw: requests.Response, session: requests.Session, args: argparse.Namespace) -> str:
    """把响应转成 Markdown 字符串（本次采集的核心解析逻辑）。"""
    ## 典型做法（按需改写）：
    # 1) 若接口返回 JSON：data = raw.json()，遍历条目组装 Markdown。
    # 2) 若是 HTML：markdown = html_to_markdown(raw.text)，再按需裁剪/提取。
    text = raw.text
    return html_to_markdown(text)


def collect_all(session: requests.Session, args: argparse.Namespace) -> str:
    """一次性（或翻页、循环）采集，返回含全部条目的 Markdown 字符串。"""
    req = prepare_request(args)
    resp = fetch(session, req["method"] == "POST" and req.get("url") or req["url"], args)
    # 若需要 POST / 携带数据，改用：session.request(req["method"], req["url"], timeout=..., **req["extra"])
    return parse_data(resp, session, args)


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def main() -> int:
    args = build_parser().parse_args()
    session = make_session(args)
    try:
        body = collect_all(session, args)
        title = (sys.argv and urlparse(args.url or build_default_url()).netloc) or "page"
        # 可用解析结果里的真实标题覆盖 title，如从 HTML <title> 提取。
        out_file = args.output or ""
        saved = save_markdown(body, title, args.url or build_default_url(),
                              OUT_DIR, out_file)
        print(f"已保存: {saved}")
        print(f"运行: python {Path(__file__).name} --url <目标> [--cookie ...]")
        return 0
    except Exception as e:  # noqa: BLE001 — 顶层兜底，避免静默失败
        print(f"采集失败: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
