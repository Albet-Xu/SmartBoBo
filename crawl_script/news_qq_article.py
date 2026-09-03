# -*- coding: utf-8 -*-
"""
腾讯新闻文章页采集脚本（news.qq.com /rain/a/ 系列）——由逆向模式生成。

逆向结论（来自逆向经验库）：
  news.qq.com 的 /rain/a/ 文章页为 SSR 直出，标题/meta/正文都随首屏 HTML 返回，
  无需调用数据接口或还原签名；PC UA + Referer 即可 200。

依赖：requests（若未安装，先执行: pip install requests）
用法：python news_qq_article.py [--url ...] [--output 文件名.md]
"""
from __future__ import annotations

import argparse
import re
import sys
import time
from html import unescape
from pathlib import Path

import requests

DEFAULT_URL = "https://news.qq.com/rain/a/20260902A0A6SY00"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
OUT_DIR = Path(__file__).resolve().parent.parent / "data"   # 项目根 data/
TIMEOUT = 20
RETRIES = 3


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="采集腾讯新闻文章页并输出 Markdown")
    p.add_argument("--url", default=DEFAULT_URL, help="目标文章 URL")
    p.add_argument("--output", default="", help="输出文件名（缺省自动生成）")
    return p


def fetch(url: str) -> str:
    last_err: Exception | None = None
    for i in range(RETRIES):
        try:
            r = requests.get(url, headers={
                "User-Agent": UA,
                "Referer": "https://news.qq.com/",
                "Accept-Language": "zh-CN,zh;q=0.9",
            }, timeout=TIMEOUT)
            r.raise_for_status()
            return r.text
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"请求失败（重试 {RETRIES} 次）：{last_err}")


def extract_title(html: str) -> str:
    m = re.search(r"<title>([^<]*)</title>", html)
    return unescape(m.group(1)).strip() if m else ""


def extract_article(html: str) -> str:
    """提取 article-content 正文节点文本（HTMLParser 按 div 深度计数，兼容嵌套）。"""
    from html.parser import HTMLParser

    class ArticleText(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.in_article = False
            self.depth = 0
            self.parts: list[str] = []

        def handle_starttag(self, tag, attrs):
            if not self.in_article:
                if tag == "div" and "article-content" in dict(attrs).get("class", "").split():
                    self.in_article = True
                    self.depth = 1
                return
            if tag == "div":
                self.depth += 1

        def handle_endtag(self, tag):
            if not self.in_article:
                return
            if tag == "div":
                self.depth -= 1
                if self.depth <= 0:
                    self.in_article = False

        def handle_data(self, data):
            if self.in_article:
                self.parts.append(data)

    p = ArticleText()
    p.feed(html)
    text = "".join(p.parts)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines:
        return "\n\n".join(lines)
    m2 = re.search(r'<meta name="description" content="([^"]*)"', html)
    return unescape(m2.group(1)) if m2 else ""


def main() -> int:
    args = build_parser().parse_args()
    html = fetch(args.url)
    title = extract_title(html)
    body = extract_article(html)
    fname = args.output or f"news_qq_{int(time.time())}.md"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / fname
    out.write_text(f"# {title}\n\n来源：{args.url}\n\n"
                   f"---\n\n{body}\n", encoding="utf-8")
    print(f"已保存: {out}（正文 {len(body)} 字符）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())