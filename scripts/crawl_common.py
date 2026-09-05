# -*- coding: utf-8 -*-
"""采集脚本共享工具：输出格式转换 + 统一命名落盘。

采集脚本（run_camoufox.py）共享本模块，
避免 html2text 配置、文件名生成与落盘逻辑在多处重复漂移。

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


# ── 长驻 Camoufox 服务（browser_server.py）的采集端共享客户核 ──────────────
# 三个引擎脚本不再各自拉起浏览器：都向 dsh 插件常驻的 browser_server 要"渲染后的完整文档"，
# 再在本模块统一做 selector 切片 + html/md/skeleton 派生 + 落盘 + 组装回传 JSON，避免三处漂移。
import json as _json
import socket

# 渲染默认参数（与服务端 browser_server.py 的 DEFAULT_* 保持一致）
RENDER_TIMEOUT_MS = 120_000
RENDER_WAIT_MS = 6_000
RENDER_SCROLL_PASSES = 4
MAX_RESPONSE_BYTES = 64 * 1024 * 1024


class ServerUnreachable(Exception):
    """无法连接长驻浏览器服务（服务未启动/已退出）。区别于"渲染成功但有页面错误"。"""


def crawl_via_server(server: str, url: str, *, timeout_ms: int = RENDER_TIMEOUT_MS,
                     wait_ms: int = RENDER_WAIT_MS, scroll_passes: int = RENDER_SCROLL_PASSES,
                     connect_timeout: float = 30.0) -> dict:
    """请求长驻 camoufox 服务渲染一页，返回 {status,title,html,partial,error}。

    服务不可达时抛 ServerUnreachable（插件据此自动重启服务并重试一次）。
    """
    host, _, port_s = server.rpartition(':')
    if '://' in host:
        host = host.split('://', 1)[1]
    port = int(port_s)
    cmd = {'url': url, 'timeout_ms': timeout_ms, 'wait_ms': wait_ms,
           'scroll_passes': scroll_passes, 'dismiss_cookies': True}
    try:
        with socket.create_connection((host, port), timeout=connect_timeout) as sock:
            sock.sendall((_json.dumps(cmd, ensure_ascii=False) + '\n').encode('utf-8'))
            buf = bytearray()
            while not buf.endswith(b'\n'):
                chunk = sock.recv(65536)
                if not chunk:
                    break
                buf += chunk
                if len(buf) > MAX_RESPONSE_BYTES:
                    break
        return _json.loads(buf.decode('utf-8'))
    except (OSError, socket.timeout, _json.JSONDecodeError) as e:
        raise ServerUnreachable(f'浏览器服务不可达({server}): {e}') from None


def _match_node(el, tag, ids, classes) -> bool:
    """简易 selector 匹配器：仅比对 tag / id 集合 / class 集合（cssselect 不可用时的兜底）。"""
    if tag and el.tag != tag:
        return False
    if ids:
        el_id = el.get('id')
        if el_id not in ids:
            return False
    if classes:
        el_classes = set(el.get('class', '').split()) if el.get('class') else set()
        if not classes.issubset(el_classes):
            return False
    return True


def first_match(tree, selector: str, tag=None, ids=None, classes=None):
    """返回 tree 中命中 selector 的第一个元素；优先 cssselect，失败退回简易匹配。"""
    if not ids and not classes:
        pass
    try:
        nodes = tree.cssselect(selector)
        if nodes:
            return nodes[0]
    except Exception:
        pass
    # 兜底：把 selector 拆成 tag/#id/.class，逐个深搜
    for el in tree.iter():
        if _match_node(el, tag, ids or set(), classes or set()):
            return el
    return None


def narrow_by_selector(full_html: str, selector: str) -> str:
    """取渲染后 HTML 中命中 selector 的第一处作为待转换片段；未命中回退整页完整文档。

    通用切片逻辑（取代旧电脑端浏览器 locator 与 scrapling page.css 的分歧做法）。
    cssselect 可用时走标准 CSS selector；不可用时对 'tag#id.cls' / '#id' / '.cls' 做简易匹配。
    """
    if not selector:
        return full_html or ''
    tree = _lhtml.fromstring(full_html or '')
    tag, ids, classes = None, set(), set()
    for tok in selector.split():
        if tok.startswith('#'):
            ids.add(tok[1:])
        elif tok.startswith('.'):
            classes.add(tok[1:])
        elif tag is None:
            tag = tok
    node = first_match(tree, selector, tag, ids, classes)
    if node is not None:
        return _lhtml.tostring(node, encoding='unicode')
    return full_html or ''


def extract_preview_text(full_html: str, selector: str | None) -> str:
    """从渲染后 HTML 抽一行文本预览（selector 命中则取该子树文本，否则取 body 文本）。"""
    tree = _lhtml.fromstring(full_html or '')
    el = None
    if selector:
        try:
            nodes = tree.cssselect(selector)
            el = nodes[0] if nodes else None
        except Exception:
            el = None
    if el is None:
        el = tree.find('.//body') if tree.find('.//body') is not None else tree
    try:
        return ' '.join((el.text_content() or '').split())[:2000]
    except Exception:
        return ''


def build_crawl_result(html: str, title: str, status, partial: bool, url: str, out: str,
                       selector: str | None, auto_name: bool, fmt_arg: str) -> dict:
    """统一输出流水线：selector 切片 + 多格式派生落盘 + 组装回传 JSON（不落盘 JSON）。

    返回 {"savedTo","status","preview","title","format","outputs"}，供采集脚本单行打到 stdout。
    """
    chunk = narrow_by_selector(html, selector)
    formats = parse_formats(fmt_arg)
    out_map = resolve_outputs(out, url, title, formats, auto_name)
    outputs = []
    for fmt in formats:
        content = html_to_format(chunk, fmt)
        write_output(out_map[fmt], content)
        outputs.append({'format': fmt, 'path': out_map[fmt]})
    return {
        'savedTo': outputs[0]['path'],
        'status': status or 0,
        'preview': extract_preview_text(html, selector),
        'title': title or 'untitled',
        'format': fmt_arg,
        'outputs': outputs,
    }