# -*- coding: utf-8 -*-
"""用长驻 Camoufox 服务抓取单页（dsh 的 crawl_fetch 工具经子进程调用）。

本脚本**不再自己拉起浏览器**：连接 dsh 插件常驻的 browser_server（--server 127.0.0.1:端口），
请求其渲染指定 URL，拿到**渲染后的完整文档**，再按 --format 逗号分隔派生并落盘：
html（原样）/ md（html2text 转 Markdown，默认）/ skeleton（lxml 块级骨架），
扩展名分别 .html / .md / .skeleton.txt。一次抓取可产出多个文件，**不生成 .json**。

仅通过 stdout 打一行单行 JSON {"savedTo","status","preview","title","format","outputs"} 供插件解析。
服务不可达时打该 JSON 并带退出码 2（区别于"渲染成功但有页面错误"），插件据此自动重启服务并重试一次。
```
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