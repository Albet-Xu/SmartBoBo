# -*- coding: utf-8 -*-
"""用长驻 Camoufox 服务 + Scrapling 解析方式抓取单页（dsh 的 crawl_fetch 工具经子进程调用）。

架构收敛后（见 tool-acquisition 采集引擎统一到 camoufox 的改造）：
本脚本**不再自己拉起 patchright/Chromium**，而是连接 dsh 插件常驻的 browser_server
（--server 127.0.0.1:端口）拿到**渲染后的完整文档**，再按 --format 派生落盘
html / md（默认）/ skeleton，一次抓取产出多文件，不生成 .json。

Scrapling 的 StealthyFetcher 自带 patchright 抗检测栈，与 camoufox(Firefox) 内核不兼容，
无法把底层浏览器直接换成 camoufox；因此引擎语义收敛为"解析/输出选项"，与另两家共用同一套
lxml selector 切片与转换落盘逻辑。selector 命中则只转换该子树。与 run_camoufox.py /
run_crawl4ai.py 共用 crawl_common。
"""
import argparse
import json
import sys
from pathlib import Path

# 确保可 import 同目录共享模块（脚本可能被任意 cwd 调用）
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crawl_common import (
    DEFAULT_FORMAT,
    ServerUnreachable,
    build_crawl_result,
    crawl_via_server,
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
    ap.add_argument('--selector', default=None,
                    help='CSS selector，命中则只转换该子树，否则转换整页完整文档')
    ap.add_argument('--format', default=DEFAULT_FORMAT,
                    help='输出格式，逗号分隔可多选，如 html,md,skeleton（默认 md）')
    ap.add_argument('--auto-name', action='store_true',
                    help='用 站点_标题_时间戳.<各格式扩展名> 命名')
    ap.add_argument('--server', required=True,
                    help='长驻浏览器服务地址，如 127.0.0.1:端口')
    a = ap.parse_args()

    try:
        rendered = crawl_via_server(a.server, a.url)
    except ServerUnreachable:
        result = {'savedTo': '', 'status': 0, 'preview': f'ERROR: 浏览器服务不可达({a.server})',
                  'title': '', 'format': a.format, 'outputs': []}
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(2)

    if rendered.get('error'):
        result = {'savedTo': '', 'status': 0, 'preview': rendered['error'],
                  'title': '', 'format': a.format, 'outputs': []}
    else:
        result = build_crawl_result(
            rendered.get('html') or '', rendered.get('title') or 'untitled',
            rendered.get('status') or 0, rendered.get('partial') or False,
            a.url, a.out, a.selector, a.auto_name, a.format,
        )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()