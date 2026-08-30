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

# 内联语义标签：在块级文本里用带标记的短格式展开，保留定位/交互信息（而非仅并入纯文本）
INLINE_SEM_TAGS = {'a', 'img', 'input', 'select', 'textarea'}


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


def inline_label(elem):
    """把链接/图片/表单控件格式化为带语义的短片段，嵌入块级文本。
    链接 -> [文本](href)，图片 -> ![alt](src)，表单控件 -> tag name=.. type=..。
    """
    tag = elem.tag
    if tag == 'a':
        href = elem.get('href') or ''
        text = re.sub(r'\s+', ' ', (elem.text_content() or '').strip())
        if not text:
            text = '链接'
        if len(text) > 30:
            text = text[:27] + '...'
        return f"[{text}]({href})" if href else text
    if tag == 'img':
        src = elem.get('src') or ''
        alt = (elem.get('alt') or '').strip() or '图片'
        return f"![{alt}]({src})" if src else alt
    # input / select / textarea：保留可定位与填充的属性
    attrs = []
    for a in ('name', 'type', 'value', 'placeholder'):
        v = elem.get(a)
        if v is not None and str(v):
            attrs.append(f"{a}={v}")
    extra = " " + " ".join(attrs) if attrs else ""
    return f"{tag}{extra}"


def extract_meta(tree):
    """提取 head 的 title/keywords/description，拼成一行元信息；空则返回空串。"""
    head = tree.find("head")
    if head is None:
        return ""
    title = head.find(".//title")
    title_text = (title.text_content().strip() if title is not None else "") or ""

    def meta_content(name):
        el = head.find(f".//meta[@name='{name}']")
        return el.get("content", "").strip() if el is not None else ""

    keywords = meta_content("keywords")
    description = meta_content("description")
    parts = []
    if title_text:
        parts.append(f"title: {title_text}")
    if keywords:
        parts.append(f"keywords: {keywords}")
    if description:
        parts.append(f"description: {description}")
    return " | ".join(parts)


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
        if child.tag in INLINE_SEM_TAGS:
            child_label = inline_label(child)
            if child_label:
                texts.append(child_label)
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


def clean_skeleton(html_str: str, include_meta: bool = False) -> str:
    """把 HTML 字符串转成骨架文本（路径去重、按路径排序）。
    include_meta=True 时，在文件头追加一行 `# meta | title:.. | keywords:.. | description:..`。
    """
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
    if include_meta:
        meta = extract_meta(tree)
        if meta:
            lines.append(f"# meta | {meta}")
    for path in sorted(path_text_map.keys()):
        clean_texts = [re.sub(r'\s+', ' ', t) for t in path_text_map[path]]
        combined = "|".join(clean_texts)
        lines.append(f"{path} -> {combined}")

    return "\n".join(lines)


def html_to_skeleton(html_str: str, include_meta: bool = False) -> str:
    """对外统一入口：渲染后的 HTML -> 块级骨架文本。
    include_meta=True 时附加 head 元信息行（默认关闭，保持行式契约与下游兼容）。
    """
    return clean_skeleton(html_str, include_meta=include_meta)