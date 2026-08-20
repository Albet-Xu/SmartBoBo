"""用 Scrapling 抓取单页，把渲染后的完整 HTML 存到本地（dsh 的 crawl_fetch 工具经子进程调用）。

真实 API 核对（Scrapling v0.4.x）：
- StealthyFetcher.fetch 是 classmethod，支持 headless / network_idle。
- 返回的 Response 继承 Selector，没有 ``css_first`` —— 取首个匹配用 ``page.css(sel).first``。
- 没有 ``save_html`` —— 保存 HTML 需自己写文件：``page.html_content``（inner HTML）。

行为：只把 HTML 写到本地（--out 或 auto-name 的 站点_标题_时间戳.html），**不生成 .json**；
仅通过 stdout 打一行单行 JSON 供插件解析。
"""
import argparse
import json
import re
import time
from pathlib import Path
from urllib.parse import urlsplit
from scrapling.fetchers import StealthyFetcher


def safe_name(s: str, maxlen: int = 60) -> str:
    s = re.sub(r'[^\w\u4e00-\u9fff-]+', '_', str(s), flags=re.UNICODE)
    return s.strip('_')[:maxlen] or 'page'


def build_filename(url: str, title: str) -> str:
    host = urlsplit(url).netloc.replace('www.', '')
    host_s = safe_name(host, 40)
    title_s = safe_name(title, 60)
    ts = time.strftime('%Y%m%d-%H%M%S')
    return f"{host_s}_{title_s}_{ts}.html"


def main():
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
    ap.add_argument('--selector', default=None)
    ap.add_argument('--auto-name', action='store_true')
    a = ap.parse_args()
    try:
        page = StealthyFetcher.fetch(a.url, headless=True, network_idle=True)

        if a.selector:
            node = page.css(a.selector).first
            text = node.text if node is not None else ""
        else:
            text = page.get_all_text()

        title = page.css('title').first.text if page.css('title').first is not None else 'untitled'

        if a.auto_name:
            out = str(Path(a.out).parent / build_filename(a.url, title))
        else:
            out = a.out
            if not out.lower().endswith('.html'):
                out = out + '.html'

        Path(out).parent.mkdir(parents=True, exist_ok=True)
        with open(out, 'w', encoding='utf-8') as f:
            f.write(page.html_content)

        result = {'savedTo': out, 'status': page.status, 'preview': (text or '')[:2000], 'title': title}
    except Exception as e:
        result = {'status': 0, 'savedTo': '', 'preview': f'ERROR: {e}', 'title': ''}
    print(json.dumps(result, ensure_ascii=False))  # 仅 stdout，不落盘 JSON


if __name__ == '__main__':
    main()
