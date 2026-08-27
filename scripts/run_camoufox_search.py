"""用 Camoufox（抗检测无头浏览器）在本地搜索引擎上执行搜索，取结果供 dsh 的 web_search 使用。

这是默认的本地搜索通道：`@deepseek-ai/dsh-web-search-camoufox` 的 provider 经子进程调用本脚本，
用自动定位的 BoBo `.venv` Python 执行 `--query/--engine/--max` 参数，解析其 stdout 单行 JSON。

支持的引擎（--engine）：
- baidu（默认）：`https://www.baidu.com/s?wd=<query>`，结果容器 `div[class*="result"]` / `div.c-container`。
- bing：`https://www.bing.com/search?q=<query>`，结果容器 `li.b_algo`。

输出约定（供 provider 解析，不落盘 JSON 文件）：
- 成功：`{"sources":[{"title","url","snippet"}, ...], "truncated": bool}`，
  sources 去重后最多 --max 条；truncated 表示抓到的结果超过 --max 被截断。
- 失败：`{"error": "..."}`，stdout 仍打一行 JSON，方便 provider 报错展示。

注意：
- headless=True 无头运行；排除默认 UBO 扩展（其下载依赖 addons.mozilla.org，失败会拖慢启动）。
- baidu 标题的超链接 href 常为 `www.baidu.com/link?url=` 重定向地址，这里直接取 href 作为 url，
  不额外追重定向（保持简洁与稳定）。
"""
import argparse
import asyncio
import json
import sys
from urllib.parse import quote

from camoufox.async_api import AsyncCamoufox
from camoufox import DefaultAddons

# 每个引擎的：搜索 URL 模板、结果容器选择器、标题/链接、摘要选择器。
ENGINES = {
    'baidu': {
        'url': 'https://www.baidu.com/s?wd={q}',
        'container': 'div[class*="result"], div.c-container',
        'title_sel': 'h3 > a',
        'snippet_sel': 'div.c-abstract, span[class*="content-right_"], div[class*="content"]',
    },
    'bing': {
        'url': 'https://www.bing.com/search?q={q}',
        'container': 'li.b_algo',
        'title_sel': 'h2 > a',
        'snippet_sel': '.b_caption p, p',
    },
}

# 抓完整页后再按需截断，保证 truncated 语义。
async def fetch_sources(page, engine: str, max_results: int) -> tuple[list[dict], bool]:
    spec = ENGINES[engine]
    items = await page.locator(spec['container']).all()
    seen: set[str] = set()
    sources: list[dict] = []
    for item in items:
        a = item.locator(spec['title_sel']).first
        if await a.count() == 0:
            continue
        url = (await a.get_attribute('href') or '').strip()
        if not url:
            continue
        if url in seen:
            continue
        seen.add(url)
        try:
            title = (await a.inner_text() or '').strip()
        except Exception:
            title = ''
        snippet_el = item.locator(spec['snippet_sel']).first
        try:
            snippet = (await snippet_el.inner_text() or '').strip() if await snippet_el.count() > 0 else ''
        except Exception:
            snippet = ''
        sources.append({'url': url, **({'title': title} if title else {}), **({'snippet': snippet} if snippet else {})})
    truncated = len(sources) > max_results
    return sources[:max_results], truncated


async def run(query: str, engine: str, max_results: int) -> dict:
    spec = ENGINES[engine]
    async with AsyncCamoufox(
        headless=True,
        exclude_addons=[DefaultAddons.UBO],
    ) as browser:
        page = await browser.new_page()
        try:
            await page.goto(spec['url'].format(q=quote(query)), wait_until='domcontentloaded', timeout=60_000)
        except Exception:
            # DOMContentLoaded 未触发也继续，用当前页面状态兜底
            pass
        # 给结果渲染时间并滚动触发懒加载
        await page.wait_for_timeout(2500)
        for _ in range(2):
            try:
                await page.mouse.wheel(0, 1200)
                await page.wait_for_timeout(800)
            except Exception:
                break
        sources, truncated = await fetch_sources(page, engine, max_results)
        return {'sources': sources, 'truncated': truncated}


async def main():
    # Windows 下子进程 stdout 默认 GBK，遇非 GBK 字符会抛 UnicodeEncodeError；强制 UTF-8，
    # 与 provider 侧 encoding='utf-8' 读取一致。
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--query', required=True, help='搜索关键词')
    ap.add_argument('--engine', default='baidu', choices=sorted(ENGINES), help='搜索引擎：%s' % sorted(ENGINES))
    ap.add_argument('--max', type=int, default=8, help='最多返回结果条数（默认 8）')
    a = ap.parse_args()
    try:
        result = await run(a.query, a.engine, a.max)
    except Exception as e:
        result = {'error': str(e)}
    # 仅 stdout 打单行 JSON，不落盘 JSON 文件
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())