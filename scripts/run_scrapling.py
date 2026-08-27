"""用 Scrapling 抓取单页，按 --format 转目标格式存到本地（dsh 的 crawl_fetch 工具经子进程调用）。

真实 API 核对（Scrapling v0.4.x）：
- StealthyFetcher.fetch 是 classmethod，支持 headless / network_idle。
- 返回的 Response 继承 Selector，没有 ``css_first`` —— 取首个匹配用 ``page.css(sel).first``。
- 没有 ``save_html`` —— 保存 HTML 需自己写文件：``page.html_content``（inner HTML）。

行为：按 `--format` 逗号分隔的多格式派生并落盘（同一份渲染 HTML 分别转换）：
html / md（默认）/ skeleton，一次抓取可产出多个文件，**不生成 .json**；
仅通过 stdout 打一行单行 JSON `{"savedTo","status","preview","title","format","outputs"}` 供插件解析。
"""
import argparse
import json
import sys
from pathlib import Path

from scrapling.fetchers import StealthyFetcher

# 确保可 import 同目录共享模块（脚本可能被任意 cwd 调用）
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crawl_common import (
    DEFAULT_FORMAT,
    html_to_format,
    parse_formats,
    resolve_outputs,
    write_output,
)


def main():
    # Windows 下子进程 stdout 默认 GBK，遇非 GBK 字符（如零宽空格 \u200b）会抛
    # UnicodeEncodeError；强制 UTF-8，与 dsh 侧 encoding='utf-8' 读取一致。
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--selector', default=None)
    ap.add_argument('--format', default=DEFAULT_FORMAT,
                    help='输出格式，逗号分隔可多选，如 html,md,skeleton（默认 md）')
    ap.add_argument('--auto-name', action='store_true')
    ap.add_argument('--proxy', default=None,
                    help='代理地址，如 http://ip:port')
    a = ap.parse_args()
    try:
        # Scrapling StealthyFetcher 不直接支持 proxy 参数，这里仅作为标记
        # 实际代理需要通过环境变量或浏览器配置实现
        page = StealthyFetcher.fetch(a.url, headless=True, network_idle=True)

        if a.selector:
            node = page.css(a.selector).first
            text = node.text if node is not None else ""
        else:
            text = page.get_all_text()

        title = page.css('title').first.text if page.css('title').first is not None else 'untitled'

        # 指定了 selector 时，只转换命中部分（否则转换整页渲染 HTML）
        html_chunk = page.html_content
        if a.selector:
            node = page.css(a.selector).first
            if node is not None:
                html_chunk = node.html

        # 一次抓取，按请求的多格式分别派生落盘
        formats = parse_formats(a.format)
        out_map = resolve_outputs(a.out, a.url, title, formats, a.auto_name)
        outputs = []
        for fmt in formats:
            content = html_to_format(html_chunk, fmt)
            write_output(out_map[fmt], content)
            outputs.append({'format': fmt, 'path': out_map[fmt]})

        result = {
            'savedTo': outputs[0]['path'],
            'status': page.status,
            'preview': (text or '')[:2000],
            'title': title,
            'format': a.format,
            'outputs': outputs,
        }
    except Exception as e:
        result = {'status': 0, 'savedTo': '', 'preview': f'ERROR: {e}',
                  'title': '', 'format': a.format, 'outputs': []}
    print(json.dumps(result, ensure_ascii=False))  # 仅 stdout，不落盘 JSON


if __name__ == '__main__':
    main()