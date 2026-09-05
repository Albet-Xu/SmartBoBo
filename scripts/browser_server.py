# -*- coding: utf-8 -*-
"""长驻 Camoufox 浏览器服务：采集端（run_camoufox.py）唯一依赖的浏览器实例。

背景：原先三个采集脚本（run_camoufox.py / run_scrapling.py / run_crawl4ai.py）各自拉起自己的浏览器，
进程结束浏览器即销毁，无法满足"会话内常驻复用"。本服务把 Camoufox 提出来单独跑成一个长驻进程：

- 用 ``AsyncCamoufox(persistent_context=True)`` 持有一个常驻 BrowserContext（同一上下文跨请求复用，
  Cookie/会话状态在会话内延续），供采集端排队复用；
- 监听本机回环 TCP（默认 127.0.0.1），每个连接读取一行 JSON 指令，渲染完回一行 JSON 应答后关闭；
  一次只处理一个请求（服务端串行），天然实现"排队复用同一个 browser context"；
- 代理在服务启动时注入一次（Proxy 由插件按会话启用状态传入），后续采集共用该退出代理；
- 渲染逻辑与旧 run_camoufox.py 保持一致：DOMContentLoaded 后点掉常见 Cookie 弹窗、等待 JS、
  滚动触发懒加载，取**渲染后的完整文档**（含 doctype/body）；超时也拿当前 content() 兜底。

协议（一行 JSON，跨进程 UTF-8）：
  请求  {"url": str, "timeout_ms": int, "wait_ms": int, "scroll_passes": int, "dismiss_cookies": bool}
  应答  {"status": int, "title": str, "html": str, "partial": bool, "error": str|null}

启动方式（由 dsh 插件 tool-acquisition 按会话拉起并常驻）：
  python browser_server.py [--proxy http://ip:port] [--profile-dir <dir>]
首行 stdout 输出 ``READY <端口>``，插件据此拿到连接端点。服务一直运行直到被进程终止，
由插件按会话结束/自动重启时以进程树方式（Windows 用 taskkill /T）关闭，避免 firefox 残留。
"""
import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

from camoufox import DefaultAddons
from camoufox.async_api import AsyncCamoufox

# 常见 Cookie/隐私同意按钮，渲染前尝试点掉，避免正文被弹窗遮挡（沿用旧 run_camoufox.py 清单）
COOKIE_ACCEPT_SELECTORS = [
    "button:has-text('我接受')",
    "button:has-text('接受')",
    "button:has-text('Accept')",
    "button:has-text('同意')",
    "#consent-accept-button",
    "button:has-text('Agree')",
]

# 单请求渲染参数（客户端可覆盖）
DEFAULT_TIMEOUT_MS = 120_000
DEFAULT_WAIT_MS = 6_000
DEFAULT_SCROLL_PASSES = 4
DISMISS_COOKIES = True

# 全局浏览器状态（长驻进程存活期间只初始化一次）
_camo = None            # AsyncCamoufox 上下文管理器对象（持引用防 GC，退出时关闭）
_browser_context = None  # 常驻 BrowserContext（跨请求复用）
_browser_lock = asyncio.Lock()


def parse_proxy(proxy_str: str | None) -> dict | None:
    """把 ``http://user:pass@ip:port`` / ``socks5://ip:port`` 转成 camoufox 接受的字典。

    camoufox proxy 为 Playwright 格式 ``{"server":..., "username":..., "password":...}``。
    无用户名密码时只给 server；为空返回 None。
    """
    if not proxy_str:
        return None
    rest = proxy_str.split('://', 1)[1] if '://' in proxy_str else proxy_str
    server = proxy_str if '://' in proxy_str else f'http://{proxy_str}'
    if '@' in rest:
        creds, host = rest.rsplit('@', 1)
        user, _, pwd = creds.partition(':')
        return {'server': f'{proxy_str.split("://", 1)[0]}://{host}', 'username': user, 'password': pwd}
    return {'server': server}


async def ensure_context(proxy_cfg: dict | None, profile_dir: str):
    """惰性初始化常驻浏览器上下文；之后跨请求复用同一实例。"""
    global _camo, _browser_context
    async with _browser_lock:
        if _browser_context is not None:
            return _browser_context
        Path(profile_dir).mkdir(parents=True, exist_ok=True)
        _camo = AsyncCamoufox(
            headless=True,
            persistent_context=True,
            user_data_dir=profile_dir,
            exclude_addons=[DefaultAddons.UBO],
            proxy=proxy_cfg,
        )
        _browser_context = await _camo.__aenter__()
        return _browser_context


async def shutdown():
    """关闭浏览器并让进程退出。幂等。由进程被终止/捕获中断时调用。"""
    global _camo
    if _camo is not None:
        try:
            await _camo.__aexit__(None, None, None)
        except Exception:
            pass
        _camo = None


async def dismiss_cookie_overlays(page) -> None:
    """尝点击常见的 Cookie/隐私同意按钮，让正文不被弹窗遮挡。"""
    for sel in COOKIE_ACCEPT_SELECTORS:
        try:
            if await page.locator(sel).count() > 0:
                await page.locator(sel).first.click()
                await page.wait_for_timeout(1500)
                return
        except Exception:
            continue


async def render(req: dict, proxy_cfg: dict | None, profile_dir: str) -> dict:
    """渲染一个 URL，返回渲染后完整文档 + 元信息。超时/出错也尽量拿当前 content() 兜底。"""
    url = req.get('url', '')
    timeout_ms = int(req.get('timeout_ms', DEFAULT_TIMEOUT_MS))
    wait_ms = int(req.get('wait_ms', DEFAULT_WAIT_MS))
    scroll_passes = int(req.get('scroll_passes', DEFAULT_SCROLL_PASSES))
    dismiss = bool(req.get('dismiss_cookies', DISMISS_COOKIES))

    if not url:
        return {'status': 0, 'title': '', 'html': '', 'partial': False, 'error': '缺少 url'}

    context = await ensure_context(proxy_cfg, profile_dir)
    page = await context.new_page()
    status = 0
    partial = False
    try:
        try:
            resp = await page.goto(url, wait_until='domcontentloaded', timeout=timeout_ms)
            if resp is not None:
                status = resp.status or 0
        except Exception:
            # DOMContentLoaded 未触发（超时/跳转异常）也继续，用当前 content 兜底
            partial = True

        if dismiss:
            await dismiss_cookie_overlays(page)

        # 给 JS 渲染时间，并滚动触发懒加载
        await page.wait_for_timeout(wait_ms)
        for _ in range(scroll_passes):
            try:
                await page.mouse.wheel(0, 1800)
                await page.wait_for_timeout(1200)
            except Exception:
                break

        html = await page.content() or ''
        if not html:
            partial = True
        title = (await page.title()) or 'untitled'
        return {'status': status, 'title': title, 'html': html, 'partial': partial, 'error': None}
    except Exception as e:
        return {'status': 0, 'title': '', 'html': '', 'partial': True,
                'error': f'渲染失败: {e}'}
    finally:
        try:
            await page.close()
        except Exception:
            pass


async def handle_conn(reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                      proxy_cfg: dict | None, profile_dir: str) -> None:
    """单连接：读一行 JSON 指令 -> 串行渲染 -> 回一行 JSON 应答 -> 关闭。"""
    try:
        raw = await reader.readline()
        req = json.loads(raw.decode('utf-8') or '{}')
    except Exception as e:
        raw = None
        req = {}
        err_pre = f'指令解析失败: {e}'
    else:
        err_pre = None

    if raw is not None and isinstance(req, dict) and 'url' in req:
        result = await render(req, proxy_cfg, profile_dir)
        if err_pre is not None:
            result['error'] = err_pre
    else:
        result = {'status': 0, 'title': '', 'html': '', 'partial': False,
                  'error': err_pre or '指令格式非法'}
    try:
        writer.write((json.dumps(result, ensure_ascii=False) + '\n').encode('utf-8'))
        await writer.drain()
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


async def main() -> None:
    # Windows 下子进程 stdout 默认 GBK，遇非 ASCII（如零宽空格）会抛 UnicodeEncodeError；
    # 强制 UTF-8 与 dsh 侧 encoding='utf-8' 读取一致。
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument('--proxy', default=None, help='代理地址，如 http://ip:port 或 socks5://user:pass@ip:port')
    ap.add_argument('--profile-dir', default=None,
                    help='Camoufox 持久化 profile 目录（缺省用临时目录；若指定则在自动重启后保留 Cookie）')
    a = ap.parse_args()

    proxy_cfg = parse_proxy(a.proxy)
    profile_dir = a.profile_dir or str(Path(tempfile.gettempdir()) / 'bobo_camoufox_profile')

    server = await asyncio.start_server(
        lambda r, w: handle_conn(r, w, proxy_cfg, profile_dir),
        '127.0.0.1', 0,
    )
    port = server.sockets[0].getsockname()[1]
    # 首行 stdout 报活，插件据此拿到连接端点
    print(f'READY {port}', flush=True)

    # 长驻：一直 serve 直到进程被终止（插件按会话以进程树方式关闭本服务）。
    # 不依赖 stdin EOF 作为关闭信号（后台/无注入 stdin 时会立即 EOF，导致服务误退出）。
    server_task = asyncio.create_task(server.serve_forever())
    try:
        await server_task
    except (asyncio.CancelledError, KeyboardInterrupt, SystemExit):
        server_task.cancel()
    finally:
        server.close()
        await server.wait_closed()
        await shutdown()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        asyncio.run(shutdown())