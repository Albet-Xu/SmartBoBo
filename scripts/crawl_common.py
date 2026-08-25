# -*- coding: utf-8 -*-
"""采集脚本共享工具：输出格式转换 + 统一命名落盘。

三个引擎脚本（run_camoufox.py / run_scrapling.py / run_crawl4ai.py）共用本模块，
避免 html2text 配置、文件名生成与落盘逻辑在三处重复漂移。

`--format` 爬取参数支持逗号分隔的多格式：一次抓取、多个派生产物（同一份渲染 HTML
分别派生）。格式与扩展名：
- html      原始渲染后 HTML，扩展名 .html
- md        html2text 转 Markdown（默认格式），扩展名 .md
- skeleton  块级骨架文本（skeleton_gen.html_to_skeleton），扩展名 .skeleton.txt
"""
import re
import time
from pathlib import Path
from urllib.parse import urlsplit

import html2text
from lxml import html as _lhtml

from skeleton_gen import html_to_skeleton

# 输出格式 -> 默认扩展名
FORMAT_EXT = {
    'html': '.html',
    'md': '.md',
    'skeleton': '.skeleton.txt',
}
# 脚本默认格式：采集助手未指定时输出 Markdown（保持既有行为）
DEFAULT_FORMAT = 'md'


def safe_name(s: str, maxlen: int = 60) -> str:
    """把字符串安全化成可用于文件名的片段（保留中文/字母数字/横线/下划线）。"""
    s = re.sub(r'[^\w\u4e00-\u9fff-]+', '_', str(s), flags=re.UNICODE)
    return s.strip('_')[:maxlen] or 'page'


def parse_formats(format_arg: str) -> list[str]:
    """把 `--format` 参数解析成去重、保序的格式列表。

    逗号分隔；空串或全为未知格式时回退为 [DEFAULT_FORMAT]，保证至少产出一个文件。
    """
    if not format_arg:
        return [DEFAULT_FORMAT]
    fmts = [f.strip().lower() for f in format_arg.split(',') if f.strip().lower() in FORMAT_EXT]
    seen: list[str] = []
    for f in fmts:
        if f not in seen:
            seen.append(f)
    return seen or [DEFAULT_FORMAT]


def build_base_name(url: str, title: str) -> str:
    """生成不含扩展名的文件名基座 `站点_标题_时间戳`；多格式共享同一基座，仅扩展名不同。"""
    host = urlsplit(url).netloc.replace('www.', '')
    host_s = safe_name(host, 40)
    title_s = safe_name(title, 60)
    ts = time.strftime('%Y%m%d-%H%M%S')
    return f"{host_s}_{title_s}_{ts}"


def make_html2text() -> html2text.HTML2Text:
    """构造本项目统一配置的 html2text 实例。"""
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
    return h


def _lxml_markdown(html: str) -> str:
    """兑底：用 lxml 抽取正文文本段落，组装成近似 Markdown。

    用于 html2text 严重丢失正文的页面（如 MSN 把正文放在专有结构里，
    html2text 只留下导航/Cookie 壳）。剔除 script/style/head 等噪声后，
    把 h1-h6（加 #）、p/li/blockquote/figcaption 转成段落，忽略链接/图片等内联结构。
    """
    tree = _lhtml.fromstring(html)
    for tag in ('script', 'style', 'noscript', 'iframe', 'svg', 'template', 'head'):
        for el in tree.iter(tag):
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)
    body = tree.find('.//body') if tree.find('.//body') is not None else tree
    lines = []
    for el in body.iter():
        if el.tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            t = ' '.join(el.text_content().split())
            if t:
                lines.append('#' * int(el.tag[1]) + ' ' + t)
        elif el.tag in ('p', 'li', 'blockquote', 'figcaption'):
            t = ' '.join(el.text_content().split())
            if t:
                lines.append(t)
    if not lines:
        t = ' '.join(body.text_content().split())
        if t:
            lines.append(t)
    joined = '\n\n'.join(lines)
    # 页面正文若不在常规 p/h 元素里（如 MSN 专有结构），段落收集会落空；
    # 此时退回 lxml 全文文本，保证正文能出来（可能夹杂少量导航文本）。
    if len(joined.strip()) < 200:
        t = ' '.join(body.text_content().split())
        if t:
            joined = t
    return joined


def html_to_format(html: str, fmt: str) -> str:
    """把 HTML 字符串转成目标格式的内容（不做落盘）。

    html 直接返回原文；skeleton 走 lxml 块级骨架；md 走 html2text，
    若其严重丢失正文（lxml 兑底可抽出明显更多文本时）改用 lxml 正文段落。
    """
    if fmt == 'html':
        return html
    if fmt == 'skeleton':
        return html_to_skeleton(html)
    if fmt == 'md':
        md = make_html2text().handle(html)
        try:
            alt = _lxml_markdown(html)
        except Exception:
            alt = ''
        # html2text 可能只留下导航/Cookie 壳而把正文章节吞掉；此类页面回退用 lxml 抽取
        if alt and len(alt.strip()) > len(md.strip()) * 2:
            return alt
        return md
    raise ValueError(f"未知输出格式: {fmt}")


def resolve_outputs(out: str, url: str, title: str, fmt_list: list[str], auto_name: bool) -> dict[str, str]:
    """返回 {格式: 落盘路径}。

    - auto_name：`站点_标题_时间戳.<各格式扩展名>`（同一基座、仅扩展名不同）。
    - 否则：以调用方给的路径 out 为基座（先去掉其可能已带的已知格式扩展名），
      再对每个格式追加对应扩展名。
    """
    if auto_name:
        base = str(Path(out).parent / build_base_name(url, title))
    else:
        base = str(out)
        for e in FORMAT_EXT.values():
            if base.lower().endswith(e):
                base = base[:-len(e)]
                break
    return {fmt: base + FORMAT_EXT[fmt] for fmt in fmt_list}


def write_output(out_path: str, content: str) -> None:
    """UTF-8 落盘采集结果（html/md/skeleton 均为文本）。"""
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(content)