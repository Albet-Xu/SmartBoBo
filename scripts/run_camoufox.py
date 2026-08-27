"""用 Camoufox（抗检测浏览器，默认采集通道）抓取单页，按 --format 转目标格式存到本地。

dsh 的 crawl_fetch 工具经子进程调用本脚本。这是本平台默认的采集通道。

行为：
- 用真实浏览器渲染页面（执行 JS），取**渲染后的完整 HTML**（`page.content()`）。
- 按 `--format` 逗号分隔的多格式派生并落盘（同一份渲染 HTML 分别转换）：
  html（原样）/ md（html2text 转 Markdown，默认）/ skeleton（lxml 块级骨架），
  扩展名分别 .html / .md / .skeleton.txt。一次抓取可产出多个文件。
- 文件名：auto-name 时用共享模块拼 `站点_标题_时间戳<各格式扩展名>`，否则用 --out。
  **不生成 .json 文件**。
- 仅通过 stdout 打一行单行 JSON `{"savedTo","status","preview","title","format","outputs"}`
  供 dsh 插件解析，不落盘 JSON（outputs 为 [{format,path}, ...]）。

注意：
- headless=True 无头运行；排除默认 UBO 扩展（其下载依赖 addons.mozilla.org，
  失败会导致启动校验报 manifest.json 缺失）。
- 渲染等待与正文容器：MSN 这类客户端渲染页，正文是 JS 异步填充的，且顶部常有
  Cookie 弹窗。这里在落地前滚动触发懒加载、并尝试点掉常见同意弹窗，提升成功率。
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

from camoufox.async_api import AsyncCamoufox
from camoufox import DefaultAddons

# 确保可 import 同目录共享模块（脚本可能被任意 cwd 调用）
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crawl_common import (
    DEFAULT_FORMAT,
    html_to_format,
    parse_formats,
    resolve_outputs,
    write_output,
)

COOKIE_ACCEPT_SELECTORS = [
    "button:has-text('我接受')",
    "button:has-text('接受')",
    "button:has-text('Accept')",
    "button:has-text('同意')",
    "#consent-accept-button",
    "button:has-text('Agree')",
]


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


async def run(url: str, out: str, selector: str | None, auto_name: bool, fmt_arg: str,
              proxy: str | None = None) -> dict:
    async with AsyncCamoufox(
        headless=True,
        exclude_addons=[DefaultAddons.UBO],
        proxy={'server': proxy} if proxy else None,
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

        full_html = await page.content()
        title = await page.title() or 'untitled'

        # 指定了 selector 时，只转换命中部分（否则转换整页渲染 HTML）
        html_chunk = full_html
        if selector:
            try:
                el = page.locator(selector).first
                if await el.count() > 0:
                    html_chunk = await el.inner_html()
            except Exception:
                pass

        # 一次抓取，按请求的多格式分别派生落盘
        formats = parse_formats(fmt_arg)
        out_map = resolve_outputs(out, url, title, formats, auto_name)
        outputs = []
        for fmt in formats:
            content = html_to_format(html_chunk, fmt)
            write_output(out_map[fmt], content)
            outputs.append({'format': fmt, 'path': out_map[fmt]})

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

        return {
            'savedTo': outputs[0]['path'],
            'status': 1,
            'preview': (text or '')[:2000],
            'title': title,
            'format': fmt_arg,
            'outputs': outputs,
        }


async def main():
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
    ap.add_argument('--auto-name', action='store_true',
                    help='用 站点_标题_时间戳.<各格式扩展名> 命名')
    ap.add_argument('--proxy', default=None,
                    help='代理地址，如 http://ip:port 或 socks5://ip:port')
    a = ap.parse_args()
    try:
        result = await run(a.url, a.out, a.selector, a.auto_name, a.format, proxy=a.proxy)
    except Exception as e:
        result = {'status': 0, 'savedTo': '', 'preview': f'ERROR: {e}',
                  'title': '', 'format': a.format, 'outputs': []}
    # 仅 stdout 打单行 JSON，不落盘 JSON 文件
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())