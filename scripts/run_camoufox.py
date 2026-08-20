"""用 Camoufox（抗检测浏览器，默认采集通道）抓取单页，把渲染后的完整 HTML 存到本地。

dsh 的 crawl_fetch 工具经子进程调用本脚本。这是本平台默认的采集通道。

行为：
- 用真实浏览器渲染页面（执行 JS），取**渲染后的完整 HTML**（`page.content()`）。
- 把 HTML 整份写入本地文件：文件名优先用 `站点_标题_时间戳.html`（--auto-name 时），
  否则用 --out 指定的路径。**不生成 .json 文件**（原始数据就是 HTML）。
- 仅通过 stdout 打一行单行 JSON `{"savedTo","status","preview"}` 供 dsh 插件解析，
  不落盘 JSON。

注意：
- headless=True 无头运行；排除默认 UBO 扩展（其下载依赖 addons.mozilla.org，
  失败会导致启动校验报 manifest.json 缺失）。
- 渲染等待与正文容器：MSN 这类客户端渲染页，正文是 JS 异步填充的，且顶部常有
  Cookie 弹窗。这里在落地前滚动触发懒加载、并尝试点掉常见同意弹窗，提升成功率。
"""
import argparse
import asyncio
import json
import re
import time
from pathlib import Path
from urllib.parse import urlsplit
from camoufox.async_api import AsyncCamoufox
from camoufox import DefaultAddons

COOKIE_ACCEPT_SELECTORS = [
    "button:has-text('我接受')",
    "button:has-text('接受')",
    "button:has-text('Accept')",
    "button:has-text('同意')",
    "#consent-accept-button",
    "button:has-text('Agree')",
]


def safe_name(s: str, maxlen: int = 60) -> str:
    """把字符串安全化成可用于文件名的片段（保留中文/字母数字/横线/下划线）。"""
    s = re.sub(r'[^\w\u4e00-\u9fff-]+', '_', str(s), flags=re.UNICODE)
    return s.strip('_')[:maxlen] or 'page'


def build_filename(url: str, title: str) -> str:
    host = urlsplit(url).netloc.replace('www.', '')
    host_s = safe_name(host, 40)
    title_s = safe_name(title, 60)
    ts = time.strftime('%Y%m%d-%H%M%S')
    return f"{host_s}_{title_s}_{ts}.html"


async def dismiss_cookie_overlays(page) -> None:
    """尝点击常见的 Cookie/隐私 同意按钮，让正文不被弹窗遮挡。"""
    for sel in COOKIE_ACCEPT_SELECTORS:
        try:
            if await page.locator(sel).count() > 0:
                await page.locator(sel).first.click()
                await page.wait_for_timeout(1500)
                return
        except Exception:
            continue


async def run(url: str, out: str, selector: str | None, auto_name: bool) -> dict:
    async with AsyncCamoufox(
        headless=True,
        exclude_addons=[DefaultAddons.UBO],
    ) as browser:
        page = await browser.new_page()
        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=120_000)
        except Exception:
            # 超时也继续，DOMContentLoaded 未触发时用当前 content 兜底
            pass

        await dismiss_cookie_overlays(page)
        # 给 JS 渲染时间，并滚动触发懒加载
        await page.wait_for_timeout(6000)
        for _ in range(4):
            await page.mouse.wheel(0, 1800)
            await page.wait_for_timeout(1200)

        html = await page.content()
        title = await page.title() or 'untitled'

        # 决定最终输出路径
        if auto_name:
            out = str(Path(out).parent / build_filename(url, title))
        else:
            out = str(out)
            if not out.lower().endswith('.html'):
                out = out + '.html'

        # 仅存 HTML，不生成 JSON
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        with open(out, 'w', encoding='utf-8') as f:
            f.write(html)

        # 取一行文本预览（不落盘，仅回给插件作告知）
        if selector:
            try:
                el = page.locator(selector).first
                text = (await el.inner_text()) if await el.count() > 0 else ''
            except Exception:
                text = ''
        else:
            try:
                text = await page.inner_text('body')
            except Exception:
                text = ''

        return {'savedTo': out, 'status': 1, 'preview': (text or '')[:2000], 'title': title}


async def main():
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
    ap.add_argument('--auto-name', action='store_true', help='用 站点_标题_时间戳.html 命名')
    a = ap.parse_args()
    try:
        result = await run(a.url, a.out, a.selector, a.auto_name)
    except Exception as e:
        result = {'status': 0, 'savedTo': '', 'preview': f'ERROR: {e}', 'title': ''}
    # 仅 stdout 打单行 JSON，不落盘 JSON 文件
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
