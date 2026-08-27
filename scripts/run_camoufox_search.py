"""用 Camoufox（抗检测浏览器）在指定搜索引擎检索关键词，返回结构化结果给 dsh 的 web_search。

被 `@deepseek-ai/dsh-web-search-camoufox` 插件经子进程调用（默认采集通道的搜索引擎模式）。
仅通过 stdout 打一行单行 JSON，不落盘任何文件：

    {"sources": [{"title","url","snippet"}], "truncated": bool, "error": str|缺省}

行为：
- headless=True 无头运行；排除默认 UBO 扩展（其下载依赖 addons.mozilla.org，失败会报 manifest 缺失）。
- 默认引擎 baidu（国内可直连，返回干净的真实 URL），可切 bing（其 ck/a 重定向已解码，但 Bing
  对无人值守查询存在反爬投毒——会整页返回无关结果，不推荐在此环境用）。
- 结果数量以 --max 截断，去重后计数即停。
"""
import argparse
import asyncio
import base64
import json
import sys
import urllib.parse
from urllib.parse import parse_qs, urlencode
from camoufox.async_api import AsyncCamoufox
from camoufox import DefaultAddons


def safe_text(text: str) -> str:
    return (text or "").strip()


def clean_bing_url(href: str) -> str:
    """把 Bing 的 `bing.com/ck/a` 重定向解析成真实目标 URL。

    Bing 在部分市场把结果包成 `https://www.bing.com/ck/a?!&&u=<base64url>`，真实地址
    base64url 编码在 `u=` 参数里（前缀 `a1` 是标记）。解码成功返回真实 URL，否则原样返回。
    """
    if "bing.com/ck/a" not in href:
        return href
    encoded = parse_qs(urllib.parse.urlsplit(href).query).get("u", [None])[0]
    if not encoded:
        return href
    payload = encoded[2:] if encoded.startswith("a1") else encoded
    try:
        payload += "=" * (-len(payload) % 4)  # 恢复 base64 填充
        return base64.urlsafe_b64decode(payload).decode("utf-8", errors="replace")
    except Exception:
        return href


async def title_url_of(row, title_sel: str) -> tuple[str, str]:
    """从结果行取标题与链接；标题行不存在时返回空标题、空 URL。"""
    link = row.locator(title_sel).first
    if await link.count() == 0:
        return "", ""
    return safe_text(await link.inner_text()), (await link.get_attribute("href")) or ""


async def snippet_of(row, selectors: list[str]) -> str:
    """按序尝试多家摘要选择器，命中第一个有文本的返回。"""
    for sel in selectors:
        try:
            node = row.locator(sel).first
            if await node.count() > 0:
                text = safe_text(await node.inner_text())
                if text:
                    return text
        except Exception:
            continue
    return ""


async def extract_bing(page, max_results: int) -> list[dict]:
    rows = page.locator("li.b_algo")
    count = await rows.count()
    out: list[dict] = []
    seen: set[str] = set()
    for i in range(count):
        row = rows.nth(i)
        title, href = await title_url_of(row, "h2 a")
        if not title or not href.startswith("http"):
            continue
        url = clean_bing_url(href)
        if url in seen:
            continue
        seen.add(url)
        out.append({"title": title, "url": url, "snippet": await snippet_of(row, ["div.b_caption p"])})
        if len(out) >= max_results:
            break
    return out


async def extract_baidu(page, max_results: int) -> list[dict]:
    rows = page.locator("div#content_left div.c-container")
    count = await rows.count()
    out: list[dict] = []
    seen: set[str] = set()
    for i in range(count):
        row = rows.nth(i)
        title, href = await title_url_of(row, "h3 a")
        if not title:
            continue
        # 百度把真实目标 URL 放在结果容器的 mu 属性；缺失时退回 h3 a 的 href。
        mu = await row.get_attribute("mu")
        url = safe_text(mu) if mu else href
        if not url.startswith("http"):
            continue
        if url in seen:
            continue
        seen.add(url)
        out.append({
            "title": title,
            "url": url,
            "snippet": await snippet_of(row, ["div.c-abstract", "div[class*='content-right']", "span[class*='content-right_']"]),
        })
        if len(out) >= max_results:
            break
    return out


# 各引擎：URL 构造 + 提取函数。默认 baidu（国内直连稳定）；bing 备用（有反爬投毒问题）。
ENGINES = {
    "baidu": {
        "url": lambda q: "https://www.baidu.com/s?" + urlencode({"wd": q}),
        "row": "div#content_left div.c-container",
        "extract": extract_baidu,
    },
    "bing": {
        "url": lambda q: "https://www.bing.com/search?" + urlencode({"q": q, "mkt": "zh-CN", "setlang": "zh-cn", "cc": "cn"}),
        "row": "li.b_algo",
        "extract": extract_bing,
    },
}


async def run(query: str, engine: str, max_results: int) -> dict:
    spec = ENGINES[engine]
    async with AsyncCamoufox(headless=True, exclude_addons=[DefaultAddons.UBO]) as browser:
        page = await browser.new_page()
        try:
            await page.goto(spec["url"](query), wait_until="domcontentloaded", timeout=90_000)
        except Exception:
            # 超时也继续，用当前内容兜底（镜像 run_camoufox 的容错）
            pass
        await page.wait_for_timeout(1500)
        try:
            await page.wait_for_selector(spec["row"], timeout=12_000)
        except Exception:
            pass
        await page.wait_for_timeout(1500)  # 再给结果行内摘要渲染一点时间
        sources = await spec["extract"](page, max_results)
    return {"sources": sources, "truncated": len(sources) >= max_results}


async def main():
    # Windows 子进程 stdout 默认 GBK，遇非 GBK 字符会抛 UnicodeEncodeError；强制 UTF-8，
    # 与 dsh 侧 encoding='utf-8' 读取一致（镜像 run_camoufox）。
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", required=True, help="搜索关键词")
    ap.add_argument("--engine", choices=sorted(ENGINES.keys()), default="baidu")
    ap.add_argument("--max", type=int, default=8, help="返回结果条数上限")
    a = ap.parse_args()
    try:
        result = await run(a.query, a.engine, a.max)
    except Exception as e:
        result = {"sources": [], "truncated": False, "error": str(e)}
    # 仅 stdout 打单行 JSON，不落盘
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())