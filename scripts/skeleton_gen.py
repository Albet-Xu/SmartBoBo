# -*- coding: utf-8 -*-
"""网页块级骨架生成（纯函数模块）。

由项目根 `aaa.py` 的核心逻辑抽取而来，供三个采集脚本（run_camoufox.py /
run_scrapling.py / run_crawl4ai.py）在 `--format skeleton` 时复用解析与拼装，
只保留纯函数，去掉 aaa.py 里的本地文件读取 / URL 抓取 / 落盘等 IO 部分。

输入渲染后的 HTML 字符串，输出"块级骨架"文本：每一个含直接文本的块级容器
占一行，格式为 `CSS路径 -> 合并文本`（如 `div#main.post > section > h1 -> 标题`）。
依赖同 aaa.py：`lxml` + 标准库 `re`（lxml 已在 .venv 环境）。
"""
import re

from lxml import html

# 块级标签：作为骨架分割单元的容器
BLOCK_TAGS = {
    'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
    'li', 'td', 'th', 'blockquote', 'figcaption', 'figure', 'caption',
    'form', 'table', 'tbody', 'tr', 'ul', 'ol', 'dl', 'dt', 'dd',
}

# 噪声标签：骨架生成时整棵剔除，不进入任何块
NOISE_TAGS = {'script', 'style', 'noscript', 'iframe', 'svg', 'meta', 'link', 'template'}


def build_selector(elem):
    """生成单个元素的选择器片段：tag + #id + .class..."""
    tag = elem.tag
    selector = tag
    elem_id = elem.get("id")
    if elem_id:
        selector += f"#{elem_id}"
    cls = elem.get("class")
    if cls:
        if isinstance(cls, list):
            cls_list = cls
        else:
            cls_list = cls.split()
        for c in cls_list:
            if c:
                selector += f".{c}"
    return selector


def get_full_path(elem, root):
    """从根到当前元素的完整 CSS 路径（不含 root 本身）。"""
    parts = []
    cur = elem
    while cur is not None and cur != root:
        parts.append(build_selector(cur))
        cur = cur.getparent()
    parts.reverse()
    return " > ".join(parts)


def extract_direct_text(elem):
    """抽取当前元素不含块级子容器的直接文本内容。"""
    texts = []
    if elem.text and elem.text.strip():
        texts.append(elem.text.strip())
    for child in elem.getchildren():
        if child.tag in BLOCK_TAGS:
            continue
        if child.tag in NOISE_TAGS:
            continue
        child_text = extract_direct_text(child)
        if child_text:
            texts.append(child_text)
    return " ".join(texts)


def has_block_children(elem):
    for child in elem.getchildren():
        if child.tag in BLOCK_TAGS:
            return True
    return False


def is_pure_text_block(elem):
    if elem.tag not in BLOCK_TAGS:
        return False
    return not has_block_children(elem)


def process(elem, root):
    """深度优先遍历，返回 [(CSS路径, 合并文本), ...] 骨架条目。"""
    if not isinstance(elem, html.HtmlElement) or elem.tag is None:
        return []
    if elem.tag in NOISE_TAGS:
        return []

    child_entries = []
    for child in elem.getchildren():
        child_entries.extend(process(child, root))

    if elem.tag not in BLOCK_TAGS:
        return child_entries

    direct_text = extract_direct_text(elem)
    direct_text = re.sub(r'\s+', ' ', direct_text).strip()

    if direct_text:
        path = get_full_path(elem, root)
        return [(path, direct_text)] + child_entries
    else:
        direct_block_children = [ch for ch in elem.getchildren() if ch.tag in BLOCK_TAGS]
        if len(direct_block_children) >= 2 and all(is_pure_text_block(ch) for ch in direct_block_children):
            # 多个纯文本块同级无直接文本时，合并成一个块输出
            merged_text = " ".join([text for _, text in child_entries])
            merged_text = re.sub(r'\s+', ' ', merged_text).strip()
            if merged_text:
                path = get_full_path(elem, root)
                return [(path, merged_text)]
            else:
                return []
        else:
            return child_entries


def clean_skeleton(html_str: str) -> str:
    """把 HTML 字符串转成骨架文本（路径去重、按路径排序）。"""
    tree = html.fromstring(html_str)
    body = tree.find(".//body")
    root = body if body is not None else tree.getroottree().getroot()

    all_entries = process(root, root)

    path_text_map = {}
    for path, text in all_entries:
        path_text_map.setdefault(path, []).append(text)
    for path in path_text_map:
        path_text_map[path] = list(dict.fromkeys(path_text_map[path]))

    lines = []
    for path in sorted(path_text_map.keys()):
        clean_texts = [re.sub(r'\s+', ' ', t) for t in path_text_map[path]]
        combined = "|".join(clean_texts)
        lines.append(f"{path} -> {combined}")

    return "\n".join(lines)


def html_to_skeleton(html_str: str) -> str:
    """对外统一入口：渲染后的 HTML -> 块级骨架文本。"""
    return clean_skeleton(html_str)