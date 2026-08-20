"""用 Crawl4AI 抓取单页，把渲染后的内容转为 Markdown 存到本地（dsh 的 crawl_fetch 工具经子进程调用）。

真实 API 核对（Crawl4AI v0.9.x）：
- AsyncWebCrawler 支持 ``async with``（__aenter__ / __aexit__）。
- ``arun(url=...)`` 只传 url 即可，默认 headless。
- ``result.html`` (str) 为渲染后 HTML；``result.status_code`` 为 int。
- ``result.markdown`` (str) 为 Crawl4AI 自带的 Markdown 转换结果。

行为：优先使用 Crawl4AI 自带的 Markdown 转换，如果不可用则使用 html2text 将 HTML 转换为 Markdown，
写到本地（--out 或 auto-name 的 站点_标题_时间戳.md），**不生成 .json**；
仅通过 stdout 打一行单行 JSON 供插件解析。
"""
import argparse
import asyncio
import json
import re
import time
from pathlib import Path
from urllib.parse import urlsplit
from crawl4ai import AsyncWebCrawler
import html2text


def safe_name(s: str, maxlen: int = 60) -> str:
    s = re.sub(r'[^\w\u4e00-\u9fff-]+', '_', str(s), flags=re.UNICODE)
    return s.strip('_')[:maxlen] or 'page'


def build_filename(url: str, title: str) -> str:
    host = urlsplit(url).netloc.replace('www.', '')
    host_s = safe_name(host, 40)
    title_s = safe_name(title, 60)
    ts = time.strftime('%Y%m%d-%H%M%S')
    return f"{host_s}_{title_s}_{ts}.md"


async def run(url: str, out: str, auto_name: bool):
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url)

        html = str(result.html or '')
        title = (result.metadata.get('title') if getattr(result, 'metadata', None) else None) or 'untitled'

        # 优先使用 Crawl4AI 自带的 Markdown 转换
        if hasattr(result, 'markdown') and result.markdown:
            markdown = str(result.markdown)
        else:
            # 如果 Crawl4AI 没有提供 Markdown，使用 html2text 转换
            h = html2text.HTML2Text()
            h.ignore_links = False
            h.ignore_images = False
            h.ignore_emphasis = False
            h.body_width = 0  # 不自动换行
            h.unicode_snob = True  # 使用 Unicode 字符
            h.skip_internal_links = False
            h.inline_links = True
            h.ignore_images = False
            h.images_to_alt = False
            h.single_line_break = False
            markdown = h.handle(html)

        if auto_name:
            out_path = str(Path(out).parent / build_filename(url, title))
        else:
            out_path = out
            if not out_path.lower().endswith('.md'):
                out_path = out_path + '.md'

        # 保存 Markdown 文件
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(markdown)

        result_json = {
            'savedTo': out_path,
            'status': result.status_code or 0,
            'preview': (str(result.markdown or '') or '')[:2000],
            'title': title,
        }
        print(json.dumps(result_json, ensure_ascii=False))  # 仅 stdout，不落盘 JSON


if __name__ == '__main__':
    # Windows 下子进程 stdout 默认 GBK，遇非 GBK 字符（如零宽空格 \u200b）会抛
    # UnicodeEncodeError；强制 UTF-8，与 dsh 侧 encoding='utf-8' 读取一致。
    import sys
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--auto-name', action='store_true')
    a = ap.parse_args()
    asyncio.run(run(a.url, a.out, a.auto_name))
