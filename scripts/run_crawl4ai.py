"""用 Crawl4AI 抓取单页，按 --format 转目标格式存到本地（dsh 的 crawl_fetch 工具经子进程调用）。

真实 API 核对（Crawl4AI v0.9.x）：
- AsyncWebCrawler 支持 ``async with``（__aenter__ / __aexit__）。
- ``arun(url=...)`` 只传 url 即可，默认 headless。
- ``result.html`` (str) 为渲染后 HTML；``result.status_code`` 为 int。
- ``result.markdown`` (str) 为 Crawl4AI 自带的 Markdown 转换结果。

行为：按 `--format` 逗号分隔的多格式派生并落盘（一次抓取产出多个文件），**不生成 .json**；
仅通过 stdout 打一行单行 JSON `{"savedTo","status","preview","title","format","outputs"}` 供插件解析。
- html：原始渲染 HTML；skeleton：lxml 块级骨架；md：优先用 Crawl4AI 自带 Markdown，
  不可用时回退 html2text。
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

from crawl4ai import AsyncWebCrawler

# 确保可 import 同目录共享模块（脚本可能被任意 cwd 调用）
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crawl_common import (
    DEFAULT_FORMAT,
    html_to_format,
    parse_formats,
    resolve_outputs,
    write_output,
)


async def run(url: str, out: str, auto_name: bool, fmt_arg: str,
              proxy: str | None = None) -> None:
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, proxy=proxy)

        html = str(result.html or '')
        title = (result.metadata.get('title') if getattr(result, 'metadata', None) else None) or 'untitled'

        # 一次抓取，按请求的多格式分别派生落盘
        formats = parse_formats(fmt_arg)
        out_map = resolve_outputs(out, url, title, formats, auto_name)
        outputs = []
        for fmt in formats:
            if fmt == 'md' and getattr(result, 'markdown', None) and result.markdown:
                # 优先使用 Crawl4AI 自带的 Markdown 转换
                content = str(result.markdown)
            else:
                # html / skeleton 或 Crawl4AI 未提供 Markdown 时，走统一转换
                content = html_to_format(html, fmt)
            write_output(out_map[fmt], content)
            outputs.append({'format': fmt, 'path': out_map[fmt]})

        result_json = {
            'savedTo': outputs[0]['path'],
            'status': result.status_code or 0,
            'preview': (str(result.markdown or '') or '')[:2000],
            'title': title,
            'format': fmt_arg,
            'outputs': outputs,
        }
        print(json.dumps(result_json, ensure_ascii=False))  # 仅 stdout，不落盘 JSON


if __name__ == '__main__':
    # Windows 下子进程 stdout 默认 GBK，遇非 GBK 字符（如零宽空格 \u200b）会抛
    # UnicodeEncodeError；强制 UTF-8，与 dsh 侧 encoding='utf-8' 读取一致。
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--format', default=DEFAULT_FORMAT,
                    help='输出格式，逗号分隔可多选，如 html,md,skeleton（默认 md）')
    ap.add_argument('--auto-name', action='store_true')
    ap.add_argument('--proxy', default=None,
                    help='代理地址，如 http://ip:port')
    a = ap.parse_args()
    asyncio.run(run(a.url, a.out, a.auto_name, a.format, proxy=a.proxy))