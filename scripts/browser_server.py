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
  请求  {"url": str, "timeout_ms": int, "wait_ms": int, "scroll_passes": int, "dismiss_cookies": bool}   # 渲染（旧格式，向后兼容）
  请求  {"op": "render", ...同上} / {"op": "ping"} / {"op": "debug_navigate"|"debug_evaluate"|"debug_network"|
         "debug_cookies"|"debug_websocket"|"debug_close", ...}   # 调试分析（逆向用，见下方各 handler）
  应答  {"status": int, "title": str, "html": str, "partial": bool, "error": str|null}   # render
        或各 op 对应的结构化 JSON；debug_* 操作在同一长驻上下文内维护一个"会话页"（导航后保持打开，
        供 evaluate / 网络 / cookie / ws 连续分析，debug_close 关闭）。

启动方式（由 dsh 插件 tool-acquisition / 调试 MCP 按会话拉起并常驻）：
  python browser_server.py [--proxy http://ip:port] [--profile-dir <dir>] [--port <端口>]
端口约定：预留派生端口（BOBO_ROOT 的 crc32 推导）以复用同一浏览器实例；未指定/被占用时回退随机端口。
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


# ── 逆向调试分析（debug_* ops）──────────────────────────────────────────────
# 会话页状态：debug_navigate 后保持页面与监听器存活，供 evaluate/网络/cookie/ws 连续分析；
# debug_close 关闭。同一长驻上下文内一次只维护一个会话页。
_session = {
    'page': None,        # 当前会话页（Playwright Page）
    'network': [],       # 捕获的网络条目（含 body 样本）
    'console': [],       # console/pageerror 条目
    'ws': [],            # websocket 连接与消息
    'body_limit': 50 * 1024,
    'capture_ws': True,
}

_NETWORK_CAP = 500          # 每条会话最多记录的网络条目数
_WS_MSG_CAP_PER_CONN = 200  # 每条 websocket 连接最多记录的消息数


def _serializable(value):
    """把 evaluate 返回值转成可 JSON 序列化的形式（主世界执行，逆向抠签名/参数用）。"""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        out = []
        for item in value[:200]:
            try:
                out.append(_serializable(item))
            except Exception:
                out.append(repr(item)[:500])
        return out
    if isinstance(value, dict):
        out = {}
        for k, v in list(value.items())[:200]:
            try:
                out[str(k)] = _serializable(v)
            except Exception:
                out[str(k)] = repr(v)[:500]
        return out
    return repr(value)[:2000]


async def _close_session():
    """关闭会话页并清空捕获状态（幂等）。"""
    global _session
    page = _session.get('page')
    _session.update({'page': None, 'network': [], 'console': [], 'ws': []})
    if page is not None:
        try:
            await page.close()
        except Exception:
            pass


async def _setup_session_listeners(page, body_limit_kb: int, capture_ws: bool):
    """为会话页挂上网络/console/pageerror/websocket 监听，数据累积到 _session。"""
    _session['page'] = page
    _session['network'] = []
    _session['console'] = []
    _session['ws'] = []
    _session['body_limit'] = int(body_limit_kb or 50) * 1024
    _session['capture_ws'] = bool(capture_ws)

    async def _on_console(msg):
        try:
            loc = msg.location()
            _session['console'].append({
                'type': msg.type, 'text': msg.text[:2000],
                'url': loc.get('url', ''), 'line': loc.get('lineNumber'),
            })
        except Exception:
            pass

    page.on('console', _on_console)

    async def _on_pageerror(err):
        _session['console'].append({'type': 'pageerror', 'text': str(err)[:2000]})

    page.on('pageerror', _on_pageerror)

    def _on_request(req):
        if len(_session['network']) >= _NETWORK_CAP:
            return
        try:
            _session['network'].append({
                'id': len(_session['network']) + 1,
                'url': req.url, 'method': req.method, 'resourceType': req.resource_type,
                'requestHeaders': dict(req.headers),
                'requestBody': (req.post_data or '')[: _session['body_limit']],
                'status': None, 'responseHeaders': None, 'responseBody': '',
                'error': None,
            })
        except Exception:
            pass

    page.on('request', _on_request)

    async def _on_response(resp):
        entries = _session['network']
        if not entries:
            return
        entry = entries[-1] if len(entries) == 1 else None
        # 按 request 幂等关联：以最后一个未填 status 的请求为准（串行页面内请求顺序稳定）
        if entry is not None and entry.get('status') is None and entry.get('url') == resp.request.url:
            pass
        else:
            for e in entries:
                if e.get('status') is None and e.get('url') == resp.request.url:
                    entry = e
                    break
        if entry is None:
            return
        try:
            entry['status'] = resp.status
            headers = dict(resp.headers)
            entry['responseHeaders'] = headers
            ctype = (headers.get('content-type') or '').lower()
            # 只对文本/JSON 类响应取 body 样本，控制内存
            if any(t in ctype for t in ('json', 'text', 'xml', 'javascript')):
                try:
                    entry['responseBody'] = (await resp.text())[: _session['body_limit']]
                except Exception:
                    entry['responseBody'] = (
                        (await resp.body())[:1024].hex() or '<binary>'
                    )
        except Exception:
            pass

    page.on('response', _on_response)

    async def _on_ws(ws):
        if not _session['capture_ws']:
            return
        conn = {'url': ws.url, 'messages': []}
        _session['ws'].append(conn)

        def _on_frame(kind: str):
            def handler(payload):
                if len(conn['messages']) >= _WS_MSG_CAP_PER_CONN:
                    return
                raw = payload.payload if hasattr(payload, 'payload') else payload
                if isinstance(raw, bytes):
                    text = raw.decode('utf-8', 'replace')
                else:
                    text = str(raw)
                conn['messages'].append({'dir': kind, 'text': text[:4000]})
            return handler

        ws.on('framereceived', _on_frame('recv'))
        ws.on('framesent', _on_frame('send'))


async def debug_navigate(req: dict, proxy_cfg: dict | None, profile_dir: str) -> dict:
    """导航到目标页并保持会话：捕获网络/console/ws，返回页面摘要；随后可用 evaluate 等继续。"""
    url = req.get('url', '')
    timeout_ms = int(req.get('timeout_ms', DEFAULT_TIMEOUT_MS))
    wait_ms = int(req.get('wait_ms', DEFAULT_WAIT_MS))
    dismiss = bool(req.get('dismiss_cookies', DISMISS_COOKIES))
    body_limit_kb = int(req.get('body_limit_kb', 50))
    capture_ws = bool(req.get('capture_websocket', True))
    if not url:
        return {'ok': False, 'error': '缺少 url'}

    context = await ensure_context(proxy_cfg, profile_dir)
    await _close_session()
    page = await context.new_page()
    await _setup_session_listeners(page, body_limit_kb, capture_ws)
    status = 0
    try:
        try:
            resp = await page.goto(url, wait_until='domcontentloaded', timeout=timeout_ms)
            if resp is not None:
                status = resp.status or 0
        except Exception:
            pass
        if dismiss:
            await dismiss_cookie_overlays(page)
        await page.wait_for_timeout(wait_ms)
        title = (await page.title()) or 'untitled'
        return {
            'ok': True, 'status': status, 'title': title, 'url': page.url,
            'network_count': len(_session['network']),
            'console_count': len(_session['console']),
            'ws_count': len(_session['ws']),
            'hint': '会话已保持：可用 debug_evaluate / debug_network / debug_cookies / debug_websocket 继续',
        }
    except Exception as e:
        return {'ok': False, 'status': status, 'error': f'导航失败: {e}'}


async def debug_evaluate(req: dict) -> dict:
    """在主世界执行 JavaScript（可调用页面自身函数），返回 JSON 化结果。"""
    expression = req.get('expression', '')
    if not expression:
        return {'ok': False, 'error': '缺少 expression'}
    page = _session.get('page')
    if page is None:
        return {'ok': False, 'error': '无会话页，先调用 debug_navigate'}
    try:
        value = await page.evaluate(expression)
        return {'ok': True, 'result': _serializable(value)}
    except Exception as e:
        return {'ok': False, 'error': f'执行失败: {e}'}


async def debug_network(req: dict) -> dict:
    """返回当前会话捕获到的网络条目（可传 patterns 过滤 URL）。"""
    patterns = req.get('patterns')
    entries = _session.get('network', [])
    if patterns:
        import re as _re
        try:
            rx = [_re.compile(p) for p in patterns]
            entries = [e for e in entries if any(r.search(e.get('url', '')) for r in rx)]
        except Exception:
            pass
    return {'ok': True, 'entries': entries[:500]}


async def debug_cookies(req: dict) -> dict:
    """返回长驻上下文的 cookies（可传 urls 限定；不传取当前会话页所属域）。"""
    context = _browser_context
    if context is None:
        return {'ok': False, 'error': '浏览器上下文未初始化'}
    urls = req.get('urls')
    if not urls:
        page = _session.get('page')
        urls = [page.url] if page is not None else None
    try:
        cookies = await context.cookies(urls) if urls else await context.cookies()
        return {'ok': True, 'cookies': [
            {k: c.get(k) for k in ('name', 'value', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite')}
            for c in cookies
        ]}
    except Exception as e:
        return {'ok': False, 'error': f'读取 cookie 失败: {e}'}


async def debug_websocket(req: dict) -> dict:
    """返回当前会话捕获到的 websocket 连接与消息分组。"""
    return {'ok': True, 'connections': _session.get('ws', [])}


async def handle_conn(reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                      proxy_cfg: dict | None, profile_dir: str) -> None:
    """单连接：读一行 JSON 指令 -> 串行处理 -> 回一行 JSON 应答 -> 关闭。"""
    try:
        raw = await reader.readline()
        req = json.loads(raw.decode('utf-8') or '{}')
    except Exception as e:
        raw = None
        req = {}
        err_pre = f'指令解析失败: {e}'
    else:
        err_pre = None

    op = req.get('op') if isinstance(req, dict) and req.get('op') else ('render' if isinstance(req, dict) and 'url' in req else None)
    try:
        if req and isinstance(req, dict):
            if op == 'ping':
                result = {'ok': True, 'pong': True}
            elif op == 'render':
                result = await render(req, proxy_cfg, profile_dir)
            elif op == 'debug_navigate':
                result = await debug_navigate(req, proxy_cfg, profile_dir)
            elif op == 'debug_evaluate':
                result = await debug_evaluate(req)
            elif op == 'debug_network':
                result = await debug_network(req)
            elif op == 'debug_cookies':
                result = await debug_cookies(req)
            elif op == 'debug_websocket':
                result = await debug_websocket(req)
            elif op == 'debug_close':
                await _close_session()
                result = {'ok': True, 'closed': True}
            else:
                raise ValueError(f'未知 op: {op}')
            if err_pre is not None:
                result['error'] = err_pre
        else:
            result = {'status': 0, 'title': '', 'html': '', 'partial': False,
                      'error': err_pre or '指令格式非法'}
    except Exception as e:
        result = {'error': f'处理失败: {e}'}
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
    ap.add_argument('--port', type=int, default=0,
                    help='监听端口（缺省随机；dsh 插件按 BOBO_ROOT 派生端口传入以复用同一浏览器实例）')
    a = ap.parse_args()

    proxy_cfg = parse_proxy(a.proxy)
    profile_dir = a.profile_dir or str(Path(tempfile.gettempdir()) / 'bobo_camoufox_profile')

    server = await asyncio.start_server(
        lambda r, w: handle_conn(r, w, proxy_cfg, profile_dir),
        '127.0.0.1', a.port,
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