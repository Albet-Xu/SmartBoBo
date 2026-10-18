# -*- coding: utf-8 -*-
"""长驻浏览器服务（CloakBrowser 版）：采集端（run_cloak.py）唯一依赖的浏览器实例。

背景：原先采集脚本各自拉起自己的浏览器，进程结束浏览器即销毁，无法满足"会话内常驻复用"。
本服务把浏览器提出来单独跑成一个长驻进程。**本项目唯一浏览器引擎是 CloakBrowser
（cloak/bin/cloakserve，CDP 多路复用服务）**，本服务不再自带浏览器：

- 首次需要浏览器时探测 cloakserve（127.0.0.1:9333），未运行则按需拉起（与 cloak/plugin
  的 service.js 同一套参数：--port/--data-dir/--proxy-server/--headless，无头启动不弹窗，
  画面经 CDP 截图镜像到右栏面板），随后经 ``connect_over_cdp``
  连上共享 BrowserContext（同一上下文跨请求复用，Cookie/会话状态延续，且与 cloak_fetch
  工具、右栏画面共享登录态）；
- 监听本机回环 TCP（默认 127.0.0.1），每个连接读取一行 JSON 指令，渲染完回一行 JSON 应答后关闭；
  一次只处理一个请求（服务端串行），天然实现"排队复用同一个 browser context"；
- 代理在**拉起 cloakserve 时**注入一次（由插件按会话启用状态传入）；cloakserve 已在运行时
  保持其既有代理不重启（共享实例，代理是服务级参数）；
- 渲染逻辑与旧实现一致：DOMContentLoaded 后点掉常见 Cookie 弹窗、等待 JS、滚动触发懒加载，
  取**渲染后的完整文档**（含 doctype/body）；超时也拿当前 content() 兜底。

协议（一行 JSON，跨进程 UTF-8，与迁移到 cloak 前完全一致，调用方零改动）：
  请求  {"url": str, "timeout_ms": int, "wait_ms": int, "scroll_passes": int, "dismiss_cookies": bool}   # 渲染（旧格式，向后兼容）
  请求  {"op": "render", ...同上} / {"op": "ping"} / {"op": "debug_navigate"|"debug_evaluate"|"debug_network"|
         "debug_cookies"|"debug_websocket"|"debug_close", ...}   # 调试分析（逆向用，见下方各 handler）
  应答  {"status": int, "title": str, "html": str, "partial": bool, "error": str|null}   # render
        或各 op 对应的结构化 JSON；debug_* 操作在同一长驻上下文内维护一个"会话页"（导航后保持打开，
        供 evaluate / 网络 / cookie / ws 连续分析，debug_close 关闭）。
  另有 panel_state / screenshot / mouse / key / reload 一组：供网页界面右侧的"内置浏览器画面镜像"
  面板轮询会话页画面并回传鼠标键盘输入（同样作用于会话页，不新建页面；见下方各 handler）。
  再加 panel_pages / panel_select / panel_close 一组：列 / 切 / 关"会话页标签"。会话页被
  target="_blank"、window.open 这类链接弹出的新窗口会自动跟随成当前页，旧页留在后台当标签
  （见下方"会话页标签"一段与 _adopt_popup）。

启动方式（由 dsh 插件 tool-acquisition / 调试 MCP 按会话拉起并常驻）：
  python browser_server.py [--proxy http://ip:port] [--port <端口>]
端口约定：预留派生端口（BOBO_ROOT 的 crc32 推导）以复用同一浏览器实例；未指定/被占用时回退随机端口。
首行 stdout 输出 ``READY <端口>``，插件据此拿到连接端点。服务一直运行直到被进程终止，
由插件按会话结束/自动重启时以进程树方式（Windows 用 taskkill /T）关闭。
cloakserve 是共享服务（脱离本进程树启动），不会随本服务关闭而关闭。
"""
import argparse
import asyncio
import base64
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.async_api import async_playwright

# 常见 Cookie/隐私同意按钮，渲染前尝试点掉，避免正文被弹窗遮挡（沿用旧采集引擎清单）
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

# 全局浏览器状态（长驻进程存活期间只初始化一次，断线时在 ensure_context 里重连）
_playwright = None       # async_playwright() 驱动实例
_browser = None          # connect_over_cdp 返回的 Browser 句柄
_browser_context = None  # 常驻 BrowserContext（跨请求复用）
_browser_lock = asyncio.Lock()


def parse_proxy(proxy_str: str | None) -> str | None:
    """归一化代理地址为 cloakserve ``--proxy-server=`` 接受的 URL；为空返回 None。

    Chrome 系 ``--proxy-server`` 不支持 ``user:pass@`` 内联凭据（会被忽略），因此
    带凭据的代理原样保留交由调用方决策——本项目代理池目前均为 IP:PORT 直连代理。
    """
    if not proxy_str:
        return None
    if '://' in proxy_str:
        return proxy_str
    return f'http://{proxy_str}'


# ── cloakserve（唯一浏览器服务）生命周期 ─────────────────────────────────────
# 与 cloak/plugin/service.js 同参数：--port / --data-dir / --proxy-server / --headless。
# 拉起用 DETACHED_PROCESS 脱离本服务的进程树——本服务被 taskkill /T 关闭时不连带
# 关掉共享的 cloakserve（它归 dsh-cloakbrowser 插件与后续会话复用）。
CLOAKSERVE_PORT = 9333
_CLOAK_ROOT = Path(__file__).resolve().parent.parent / 'cloak'
_CLOAKSERVE_LOG = _CLOAK_ROOT / 'cloakserve.log'
_CLOAKSERVE_READY_TIMEOUT_S = 60.0


def _window_size() -> str:
    """Chrome 窗口尺寸（W,H）：headless 下即页面视口。

    默认与 cloak/plugin/service.js 一致；``CLOAK_WINDOW_SIZE=W,H`` 环境变量可覆盖，
    非法格式回落默认。面板的视口跟随（panel_resize）在其后按需调整。
    """
    value = os.environ.get('CLOAK_WINDOW_SIZE', '')
    if re.fullmatch(r'[0-9]+,[0-9]+', value or ''):
        return value
    return '1920,947'


async def _cloakserve_alive() -> bool:
    """cloakserve 是否在 9333 应答（HTTP /json/version 或 / 均返回 200 视为存活）。"""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection('127.0.0.1', CLOAKSERVE_PORT), timeout=2.0)
    except Exception:
        return False
    try:
        writer.write(b'GET /json/version HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
        await writer.drain()
        head = await asyncio.wait_for(reader.read(64), timeout=2.0)
        return head.startswith(b'HTTP/1.1 200') or head.startswith(b'HTTP/1.0 200')
    except Exception:
        return False
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def ensure_cloakserve(proxy: str | None) -> None:
    """确保 cloakserve 在 9333 运行；未运行则拉起并等待就绪（已有实例不重启、代理不变）。

    拉起失败/超时抛 RuntimeError，render 等 handler 捕获后作为 error 返回给调用方。
    """
    if await _cloakserve_alive():
        return
    script = _CLOAK_ROOT / 'bin' / 'cloakserve'
    if not script.exists():
        raise RuntimeError(f'cloakserve 不存在: {script}（先运行 cloak/ensure.ps1 预铺运行时）')
    data_dir = _CLOAK_ROOT / 'data'
    # --headless：无头启动，不弹独立窗口（画面经 CDP 截图镜像到右栏面板）。
    # 裸 --headless 由 cloakserve CLI 透传给 Chrome（其 build_args 不生成该 flag）。
    # --window-size 同为透传：接管 headless 默认的 764×451 小视口（DEFAULT_VIEWPORT
    # 模拟视口在 headless 下不生效）；CLOAK_WINDOW_SIZE=W,H 可覆盖，与 service.js 一致。
    args = [sys.executable, str(script),
            f'--port={CLOAKSERVE_PORT}', f'--data-dir={data_dir}',
            '--headless', f'--window-size={_window_size()}']
    if proxy:
        args.append(f'--proxy-server={proxy}')
    kwargs: dict = {'cwd': str(_CLOAK_ROOT)}
    if os.name == 'nt':
        # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP：脱离本控制台组，独立成组
        # （taskkill /T 关本服务时不连带杀共享 cloakserve，见 02 §5.6）。
        # CREATE_NO_WINDOW：即使解释器不是 pythonw（GUI 子系统）也绝不为
        # cloakserve 建控制台窗口——用户侧任何宿主环境下都不弹终端。
        kwargs['creationflags'] = 0x00000008 | 0x00000200 | 0x08000000
    else:
        kwargs['start_new_session'] = True
    log = open(_CLOAKSERVE_LOG, 'ab')
    try:
        subprocess.Popen(args, stdin=subprocess.DEVNULL,
                         stdout=log, stderr=log, **kwargs)
    finally:
        log.close()
    deadline = time.monotonic() + _CLOAKSERVE_READY_TIMEOUT_S
    while time.monotonic() < deadline:
        if await _cloakserve_alive():
            return
        await asyncio.sleep(0.4)
    raise RuntimeError(
        f'cloakserve 启动超时（{_CLOAKSERVE_READY_TIMEOUT_S:.0f}s）。'
        f'查看日志: {_CLOAKSERVE_LOG}；预铺运行时: powershell -ExecutionPolicy Bypass -File "{_CLOAK_ROOT / "ensure.ps1"}"')


def _cdp_url() -> str:
    return f'http://127.0.0.1:{CLOAKSERVE_PORT}'


async def ensure_context(proxy: str | None, profile_dir: str | None = None):
    """惰性连上 cloakserve 的共享 BrowserContext；跨请求复用同一连接，断线自动重连。

    - cloakserve 未运行时按需拉起（ensure_cloakserve）；
    - 已连接且存活直接复用；连接已断（cloakserve 重启过）则重连，重建常驻上下文句柄；
    - profile_dir 仅为兼容旧签名保留，不再使用（持久化由 cloakserve 的 --data-dir 承担）。

    拉起/连接失败抛 RuntimeError，render 等 handler 捕获后作为 error 返回。
    """
    global _playwright, _browser, _browser_context
    async with _browser_lock:
        if _browser is not None and _browser.is_connected() and _browser_context is not None:
            return _browser_context
        await ensure_cloakserve(proxy)
        if _playwright is None:
            _playwright = await async_playwright().start()
        if _browser is not None and not _browser.is_connected():
            _browser = None
        if _browser is None:
            _browser = await _playwright.chromium.connect_over_cdp(_cdp_url())
        contexts = _browser.contexts
        _browser_context = contexts[0] if contexts else await _browser.new_context()
        return _browser_context


async def shutdown():
    """断开 CDP 连接并停掉 playwright 驱动。幂等；不关闭共享的 cloakserve 浏览器。

    注意：对 connect_over_cdp 拿到的 browser 调 close() 会向 Chrome 发 Browser.close、
    关掉整个共享实例（其它会话/工具正用着）；这里只断驱动连接。
    """
    global _playwright, _browser, _browser_context
    _browser_context = None
    _browser = None
    if _playwright is not None:
        try:
            await _playwright.stop()
        except Exception:
            pass
        _playwright = None


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


async def render(req: dict, proxy: str | None, profile_dir: str | None = None) -> dict:
    """渲染一个 URL，返回渲染后完整文档 + 元信息。超时/出错也尽量拿当前 content() 兜底。"""
    url = req.get('url', '')
    timeout_ms = int(req.get('timeout_ms', DEFAULT_TIMEOUT_MS))
    wait_ms = int(req.get('wait_ms', DEFAULT_WAIT_MS))
    scroll_passes = int(req.get('scroll_passes', DEFAULT_SCROLL_PASSES))
    dismiss = bool(req.get('dismiss_cookies', DISMISS_COOKIES))

    if not url:
        return {'status': 0, 'title': '', 'html': '', 'partial': False, 'error': '缺少 url'}

    context = await ensure_context(proxy, profile_dir)
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


# ── 会话页标签（弹窗跟随 / 面板标签栏）────────────────────────────────────────
# 服务原本只认一张"会话页"：用户在画面里点 target="_blank" 的链接（如 bilibili 视频卡片），
# 目标页会在同一个 context 里新开一张 page，旧实现完全看不见它——于是"能听到视频声音、
# 画面却一直停在旧页"。现在把"采纳过"的页登记成标签：弹窗自动跟随成当前页，旧页留后台，
# 面板可以列出 / 切换 / 关闭它们。agent 的 debug_navigate 仍是"接管"语义（关旧页、开新页），
# 所以 agent 的连续导航不会堆标签；标签栏攒下来的只有你自己点开的那些弹窗页。
_PAGE_TAB_CAP = 8            # 后台标签上限：一张标签就是一份真实文档，视频站的页很吃内存
_page_tabs = {}              # 标签 id(int) -> Page；插入顺序 = 采纳顺序 = 面板标签栏显示顺序
_page_used = {}              # 标签 id -> 最近一次成为当前页的序号（超上限时按它淘汰最久未用的）
_page_seq = 0                # 标签 id 自增源
_use_seq = 0                 # "成为当前页"的序号自增源
_wired = set()               # 已挂过监听的页：同一页只挂一次，否则同一次请求会记两遍


def _register_page(page) -> int:
    """把一页登记为标签并返回其 id（已登记则原样返回）。"""
    global _page_seq
    for pid, known in _page_tabs.items():
        if known is page:
            return pid
    _page_seq += 1
    _page_tabs[_page_seq] = page
    return _page_seq


def _open_tab_items() -> list:
    """按采纳顺序返回仍存活的标签 (id, Page)；顺手摘掉已关闭的页与它们的监听登记。"""
    items = []
    for pid, page in list(_page_tabs.items()):
        if page.is_closed():
            _page_tabs.pop(pid, None)
            _page_used.pop(pid, None)
            _wired.discard(page)
            continue
        items.append((pid, page))
    return items


def _activate_page(pid: int) -> None:
    """把某个标签设为当前页（会话页）：面板画面与 debug_* 都跟着它走。"""
    global _use_seq
    page = _page_tabs.get(pid)
    if page is None:
        return
    _use_seq += 1
    _page_used[pid] = _use_seq
    _session['page'] = page


def _activate_recent() -> None:
    """当前页没了（被关或被接管）时回落到最近用过的存活标签；一个都没有就置空。"""
    items = _open_tab_items()
    if not items:
        _session['page'] = None
        return
    _activate_page(max(items, key=lambda item: _page_used.get(item[0], 0))[0])


async def _forget_page(page) -> None:
    """关掉一页，并从标签表与监听登记里摘掉它（幂等）。"""
    for pid, known in list(_page_tabs.items()):
        if known is page:
            _page_tabs.pop(pid, None)
            _page_used.pop(pid, None)
            break
    _wired.discard(page)
    if _sc.get('page') is page:
        await _screencast_stop()
    try:
        await page.close()
    except Exception:
        pass


async def _evict_over_cap() -> None:
    """标签超上限时关掉最久未用的非当前页（面板下一次轮询就少一条）。"""
    items = _open_tab_items()
    extra = len(items) - _PAGE_TAB_CAP
    if extra <= 0:
        return
    current = _session.get('page')
    victims = [pid for pid, page in sorted(items, key=lambda item: _page_used.get(item[0], 0))
               if page is not current][:extra]
    for pid in victims:
        page = _page_tabs.get(pid)
        if page is not None:
            await _forget_page(page)


# ── 内置浏览器画面镜像（panel_state / screenshot / mouse / key / reload）──────
# 这组 op 与 debug_* 共用同一个"会话页"（_session['page']），区别在调用方是网页界面右侧栏：
# 它以固定频率拉截图、把鼠标/键盘事件回传，因此**不新建页面、不改会话语义**。
# 标签栏的三个 op（panel_pages / panel_select / panel_close）与跟随弹窗的 _adopt_popup 也走这把锁
# ——它们都在换 _session['page']，不能与截图 / 输入事件交错。
# 画面轮询（单帧几十~几百毫秒）与输入事件一旦交错，会出现"点击落在导航前的旧文档"或"截到半张画面"，
# 故用一把独立锁串行化；不复用 _browser_lock——那把锁管的是浏览器启动，被画面轮询占住会拖慢首次启动。
_page_lock = asyncio.Lock()

_PANEL_QUALITY_DEFAULT = 60   # 轮询帧的 JPEG 质量缺省值：清晰度与带宽的折中
_PANEL_QUALITY_MIN = 10       # 下限：再低会出现明显块效应，页面文字不可读
_PANEL_QUALITY_MAX = 90       # 上限：再高单帧体积成倍增长，按帧轮询不划算
_PANEL_SCALES = ('css', 'device')             # screenshot 的 scale 取值（前端按 CSS 像素映射鼠标坐标）
_PANEL_BUTTONS = ('left', 'right', 'middle')  # mouse 支持的按键
_PANEL_MOUSE_ACTIONS = ('move', 'down', 'up', 'click', 'dblclick', 'wheel', 'contextmenu')
_PANEL_COORD_ACTIONS = ('move', 'click', 'dblclick', 'contextmenu')  # 必须带 x/y 的动作
_PANEL_KEY_ACTIONS = ('press', 'insert')
# 无会话页时的中文错误文案（前端据此提示"先打开一个网址"并重试）；截图类与输入类分开措辞
_PANEL_NO_PAGE = '没有可截图的页面，请先打开一个网址'
_PANEL_NO_PAGE_INPUT = '没有可操作的页面，请先打开一个网址'
_PANEL_NO_TAB = '标签不存在或已关闭'   # 标签栏切/关时传了非法或已关闭的 id

# ── screencast 帧缓存（方案 B）────────────────────────────────────────────────
# CDP Page.startScreencast 只在画面变化时推帧（静止页不推），远比每次轮询
# page.screenshot（真实渲染+JPEG 编码，几十 ms）便宜。帧到达即写入缓存，
# screenshot op 只读缓存：轮询回包不再触发渲染，端到端延迟≈轮询间隔。
# 换页/切标签由 _screencast_ensure 懒重启；帧事件不拿 _page_lock（写两个
# 字段无 await 交错），取帧侧在锁内读——不会拖慢输入转发。
_sc: dict = {
    'page': None,       # screencast 绑定的页
    'cdp': None,        # Playwright CDP session
    'quality': 0,       # 启帧时的 JPEG 质量（quality 变了要重启才能生效）
    'seq': 0,           # 帧序号：每收到一帧 +1，前端据此跳过重复帧
    'jpeg': None,       # 最新帧的 base64 JPEG（None = 还没有首帧）
    'viewport': None,   # 启帧时读一次的 CSS 视口 {width, height, dpr}
}

# ── 视口跟随（方案 C：panel_resize）───────────────────────────────────────────
# 面板容器尺寸变化时前端发 panel_resize，这里把会话页视口改成面板的 CSS 像素
# 尺寸——页面真正 reflow，画面 1:1 无 letterbox。期望视口记住在 _panel_want，
# 换页（navigate/切标签/采纳弹窗）后自动重放，agent 导航也不会掉回默认视口。
# CLOAK_VIEWPORT_FOLLOW=0 整体关闭（agent 采集要锁定渲染尺寸时用）。
_PANEL_WANT: dict | None = None
_VIEWPORT_MIN = (320, 240)
_VIEWPORT_MAX = (2560, 1600)
_VIEWPORT_FOLLOW_OFF = os.environ.get('CLOAK_VIEWPORT_FOLLOW', '1') in ('0', 'false', 'no')


def _clamp_viewport(width, height) -> tuple[int, int] | None:
    """把前端报来的容器尺寸钳进合法范围；非法（非数字/非正）返回 None。"""
    try:
        w, h = int(float(width)), int(float(height))
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    return (max(_VIEWPORT_MIN[0], min(_VIEWPORT_MAX[0], w)),
            max(_VIEWPORT_MIN[1], min(_VIEWPORT_MAX[1], h)))


async def _apply_panel_viewport(page) -> None:
    """把面板期望视口应用到页（幂等；无期望或跟随关闭时 no-op）。

    视口真的变了就作废 screencast 缓存：下一 tick 懒重启推流，且重启前
    jpeg 为空会走实时截图兜底——首帧直接是新尺寸，无糊帧过渡。
    """
    global _sc
    if _PANEL_WANT is None or _VIEWPORT_FOLLOW_OFF:
        return
    want = {'width': _PANEL_WANT['width'], 'height': _PANEL_WANT['height']}
    try:
        current = page.viewport_size or {}
        if (int(current.get('width') or 0) == want['width']
                and int(current.get('height') or 0) == want['height']):
            return
        await page.set_viewport_size(want)
    except Exception:
        return
    if _sc.get('page') is page:
        await _screencast_stop()


async def _screencast_stop() -> None:
    """停掉当前 screencast 并丢弃缓存（幂等）；页已关时 CDP 报错，忽略。"""
    _sc_update = _sc
    cdp = _sc_update.get('cdp')
    _sc_update.update({'page': None, 'cdp': None, 'jpeg': None, 'viewport': None})
    if cdp is None:
        return
    try:
        await cdp.send('Page.stopScreencast')
    except Exception:
        pass
    try:
        await cdp.detach()
    except Exception:
        pass


async def _screencast_ensure(page, quality: int) -> None:
    """确保 page 上有活跃 screencast；绑定页/质量变了先停旧的再启新的。

    启动失败向上抛：调用方回退实时截图（screencast 不可用不应让画面消失）。
    """
    global _sc
    if (_sc.get('page') is page and _sc.get('cdp') is not None
            and _sc.get('quality') == quality):
        return
    await _screencast_stop()
    cdp = await page.context.new_cdp_session(page)

    async def _on_frame(params):
        # 换页后这帧作废：不 ack（旧流随 detach 停止）、不更新缓存。
        if _sc.get('cdp') is not cdp:
            return
        try:
            # 必须及时 ack，否则 Chromium 认为消费不过来会停止推帧（背压）。
            await cdp.send('Page.screencastFrameAck', {'sessionId': params['sessionId']})
        except Exception:
            return
        _sc['jpeg'] = params.get('data') or ''
        _sc['seq'] += 1

    cdp.on('Page.screencastFrame', _on_frame)
    await cdp.send('Page.startScreencast', {
        'format': 'jpeg', 'quality': quality,
        'everyNthFrame': 1, 'maxWidth': 1920, 'maxHeight': 1200,
    })
    viewport = await _panel_viewport(page)
    _sc.update({'page': page, 'cdp': cdp, 'quality': quality,
                'viewport': viewport if viewport.get('width') else None})


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


async def _close_session(all_tabs: bool = False):
    """关闭当前页并清空捕获状态（幂等）；默认把后台标签留着，当前页回落到最近用过的那个。

    `debug_navigate` 用它腾地方（随后立刻建新页）：只关当前页，你自己点开过的标签留着，
    当前页回落到它们而不是留空——一是"旧页留着"的语义，二是避免换页的那几毫秒里面板恰好截到
    "没有页面"，误判成页面已关闭而退出画面循环。
    `debug_close` 走 all_tabs=True：agent 结束会话时连同这次会话的弹出页一起关掉，与它
    "关闭会话页"的原有语义一致，也不留下没人管的孤儿页。
    """
    global _session
    page = _session.get('page')
    _session.update({'page': None, 'network': [], 'console': [], 'ws': []})
    if all_tabs:
        for _, known in _open_tab_items():
            await _forget_page(known)
        return
    if page is not None:
        await _forget_page(page)
    _activate_recent()


def _setup_session_listeners(page, body_limit_kb: int, capture_ws: bool):
    """开始一个新会话：重置捕获缓冲，把该页挂上监听、登记为标签并设为当前页。"""
    _session['network'] = []
    _session['console'] = []
    _session['ws'] = []
    _session['body_limit'] = int(body_limit_kb or 50) * 1024
    _session['capture_ws'] = bool(capture_ws)
    _wire_page(page)
    _activate_page(_register_page(page))


def _wire_page(page) -> None:
    """给一页挂上 console/pageerror/网络/弹窗监听（幂等：同一页只挂一次）。

    监听器写的都是 `_session` 里的捕获缓冲，所以换当前页（跟随弹窗、面板切标签）不必重挂；
    反过来，同一页挂两遍会把同一次请求记两遍，故用 `_wired` 记住挂过的页。

    注：本函数里 `_on_ws` 从未被 `page.on('websocket', …)` 注册过（历史遗留，本次只搬位置、
    未改行为），`debug_websocket` 因此一直返回空列表；补注册会改变 agent 侧可见行为，另议。
    """
    if page in _wired:
        return
    _wired.add(page)

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

    def _on_popup(popup):
        """会话页开了新窗口（`target="_blank"` / `window.open`）：派任务去跟随它。

        回调是同步的（在事件循环里被调用），采纳本身要 await，所以派成任务；
        跟随失败最多让面板晚一步看见那个窗口，绝不影响页面本身。
        """
        asyncio.get_running_loop().create_task(_adopt_popup(popup))

    page.on('popup', _on_popup)


async def _adopt_popup(popup) -> None:
    """把会话页弹出的新窗口采纳为当前页：旧页留在后台当标签，捕获缓冲继续累积。"""
    try:
        async with _page_lock:
            previous = _session.get('page')
            _wire_page(popup)
            _activate_page(_register_page(popup))
            await _align_viewport(popup, previous)
            await _apply_panel_viewport(popup)
        await _evict_over_cap()
    except Exception:
        pass


async def _align_viewport(page, reference) -> None:
    """把新窗口的视口对齐到先前那一页：`window.open` 带 features 的弹窗只有小窗口尺寸。"""
    try:
        want = reference.viewport_size if reference is not None else None
        if not want or reference.is_closed() or page.viewport_size == want:
            return
        await page.set_viewport_size(want)
    except Exception:
        pass


async def debug_navigate(req: dict, proxy: str | None, profile_dir: str | None = None) -> dict:
    """导航到目标页并保持会话：捕获网络/console/ws，返回页面摘要；随后可用 evaluate 等继续。"""
    url = req.get('url', '')
    timeout_ms = int(req.get('timeout_ms', DEFAULT_TIMEOUT_MS))
    wait_ms = int(req.get('wait_ms', DEFAULT_WAIT_MS))
    dismiss = bool(req.get('dismiss_cookies', DISMISS_COOKIES))
    body_limit_kb = int(req.get('body_limit_kb', 50))
    capture_ws = bool(req.get('capture_websocket', True))
    if not url:
        return {'ok': False, 'error': '缺少 url'}

    context = await ensure_context(proxy, profile_dir)
    # 换页顺序固定为「先建新页、后关旧页」：`_session['page']` 全程不置空，中间不存在
    # "无会话页"的一刻。反序（先 _close_session 再 new_page）会把 `_session['page']` 置空，
    # 空窗期面板的 1s 心跳落进去就把它误判成"页面已关闭"并退出画面循环——那正是
    # "换一个网址就打不开"的根因（43 号文档 §2.10，实测空窗约 1.75s）。
    previous = _session.get('page')
    page = await context.new_page()
    _setup_session_listeners(page, body_limit_kb, capture_ws)
    if previous is not None and previous is not page:
        await _forget_page(previous)
    status = 0
    try:
        try:
            resp = await page.goto(url, wait_until='domcontentloaded', timeout=timeout_ms)
            if resp is not None:
                status = resp.status or 0
        except Exception:
            pass
        await _apply_panel_viewport(page)
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


# ── 画面镜像与输入转发（见文件上方 panel 常量注释）────────────────────────────

def _panel_number(value, default: float = 0.0) -> float:
    """把前端传来的数值转成 float；缺省/非法一律用 default（避免字符串坐标直接喂给 playwright 而报错）。"""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _panel_coord(value) -> float | None:
    """解析鼠标坐标（CSS 像素）；缺省/非法返回 None，调用方据此报参数缺失。"""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _panel_error(err: Exception) -> str:
    """把 Playwright 异常压成简短中文原因。

    最常见的一种是 agent 同时调 debug_navigate / debug_close 把会话页关掉，playwright 抛
    "Target page, context or browser has been closed"——这种要回可重试的提示，而不是把英文原文丢给前端。
    """
    text = str(err) or err.__class__.__name__
    if 'closed' in text.lower():
        return '会话页已关闭，请重新打开网址'
    return f'操作失败: {text[:200]}'


async def _panel_viewport(page) -> dict:
    """读取会话页视口（CSS 像素宽高 + 设备像素比），供前端把鼠标坐标与截图尺寸对齐。"""
    info = await page.evaluate(
        '() => ({width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio})'
    ) or {}
    return {
        'width': int(info.get('width') or 0),
        'height': int(info.get('height') or 0),
        'dpr': _panel_number(info.get('dpr'), 1.0),
    }


async def panel_state(req: dict) -> dict:
    """返回会话页的地址/标题/视口，供右侧栏轮询（无会话页时给 has_page=false 而不是报错）。"""
    async with _page_lock:
        page = _session.get('page')
        if page is None:
            return {'ok': True, 'has_page': False, 'url': '', 'title': '', 'viewport': None}
        try:
            url = page.url or ''
        except Exception:
            url = ''
        try:
            title = (await page.title()) or ''
            viewport = await _panel_viewport(page)
        except Exception as e:
            # 页面正处在 goto 中段：读标题/视口撞上"执行上下文已销毁"，但页并没消失。
            # 这里退回去 JS 的字段照常回 ok（标题留空、视口取 viewport_size），
            # 否则面板会把"正在加载"当成一次失败闪错误——只有页真的关了才报错。
            if page.is_closed():
                return {'ok': False, 'error': _panel_error(e)}
            size = page.viewport_size or {}
            return {
                'ok': True, 'has_page': True, 'url': url, 'title': '',
                'viewport': {'width': int(size.get('width') or 0),
                             'height': int(size.get('height') or 0), 'dpr': 1.0},
            }
        return {'ok': True, 'has_page': True, 'url': url, 'title': title, 'viewport': viewport}


async def panel_screenshot(req: dict) -> dict:
    """取最新镜像帧（方案 B：screencast 缓存，不再每帧实时渲染截图）。

    请求在原有 quality/scale 之外可带 ``since``（客户端已见的帧序号）：没有
    更新的帧时回 ``unchanged: true`` 的短包（不带 base64），静止页面轮询近乎
    零开销。screencast 不可用时退回实时 ``page.screenshot``，字段与旧版兼容。
    """
    quality = int(_panel_number(req.get('quality'), _PANEL_QUALITY_DEFAULT))
    quality = max(_PANEL_QUALITY_MIN, min(_PANEL_QUALITY_MAX, quality))
    scale = req.get('scale') or 'css'
    if scale not in _PANEL_SCALES:
        return {'ok': False, 'error': f'不支持的 scale: {scale}（仅支持 css / device）'}
    try:
        since = int(req.get('since') or 0)
    except (TypeError, ValueError):
        since = 0

    async def _live_screenshot(page) -> dict | None:
        """实时截图回退（screencast 挂了/首帧未到）；返回 None 表示页面已关闭。"""
        try:
            raw = await page.screenshot(type='jpeg', quality=quality, scale=scale)
        except Exception as e:
            if page.is_closed():
                return None
            return {'ok': False, 'error': _panel_error(e)}
        try:
            viewport = await _panel_viewport(page)
            url = page.url or ''
            title = (await page.title()) or ''
        except Exception as e:
            if page.is_closed():
                return None
            size = page.viewport_size or {}
            if not size.get('width') or not size.get('height'):
                return {'ok': False, 'error': _panel_error(e)}
            viewport = {'width': int(size['width']), 'height': int(size['height']), 'dpr': 1.0}
            url = ''
            title = ''
        return {
            'ok': True, 'data': base64.b64encode(raw).decode('ascii'), 'format': 'jpeg',
            'seq': _sc['seq'], 'css_width': viewport['width'], 'css_height': viewport['height'],
            'dpr': viewport['dpr'], 'url': url, 'title': title,
        }

    async with _page_lock:
        page = _session.get('page')
        if page is None:
            return {'ok': False, 'error': _PANEL_NO_PAGE}
        try:
            await _screencast_ensure(page, quality)
        except Exception:
            result = await _live_screenshot(page)
            if result is not None:
                return result
            return {'ok': False, 'error': _PANEL_NO_PAGE}

        seq = _sc['seq']
        jpeg = _sc['jpeg']
        # 首帧未到（screencast 刚启动）：实时截一次顶上，下一 tick 就有缓存帧了。
        if jpeg is None:
            result = await _live_screenshot(page)
            if result is not None:
                return result
            return {'ok': False, 'error': _PANEL_NO_PAGE}

        try:
            url = page.url or ''
            title = (await page.title()) or ''
        except Exception as e:
            if page.is_closed():
                return {'ok': False, 'error': _panel_error(e)}
            url, title = '', ''

        if seq <= since:
            # 无新帧（页面静止时 screencast 不推）：短包 + 复用启帧时的视口。
            viewport = _sc.get('viewport') or {}
            return {
                'ok': True, 'unchanged': True, 'seq': seq, 'url': url, 'title': title,
                'css_width': viewport.get('width', 0), 'css_height': viewport.get('height', 0),
                'dpr': viewport.get('dpr', 1.0),
            }
        viewport = _sc.get('viewport') or {}
        if not viewport.get('width'):
            viewport = await _panel_viewport(page)
            _sc['viewport'] = viewport
        return {
            'ok': True, 'data': jpeg, 'format': 'jpeg', 'seq': seq,
            'css_width': viewport['width'], 'css_height': viewport['height'],
            'dpr': viewport['dpr'], 'url': url, 'title': title,
        }


async def panel_mouse(req: dict) -> dict:
    """把画面面板上的鼠标事件转发到会话页（坐标是 CSS 像素，与 screenshot scale=css 对齐）。"""
    action = str(req.get('action') or '')
    if action not in _PANEL_MOUSE_ACTIONS:
        return {'ok': False, 'error': f'未知的鼠标动作: {action}'}
    button = str(req.get('button') or 'left')
    if button not in _PANEL_BUTTONS:
        return {'ok': False, 'error': f'不支持的鼠标按键: {button}'}
    x, y = _panel_coord(req.get('x')), _panel_coord(req.get('y'))
    if action in _PANEL_COORD_ACTIONS and (x is None or y is None):
        return {'ok': False, 'error': '缺少 x/y 坐标'}
    async with _page_lock:
        page = _session.get('page')
        if page is None:
            return {'ok': False, 'error': _PANEL_NO_PAGE_INPUT}
        try:
            if action == 'move':
                await page.mouse.move(x, y)
            elif action == 'down':
                # 拖动时前端会带坐标：先落位再按下；只发按下（不带坐标）也能用
                if x is not None and y is not None:
                    await page.mouse.move(x, y)
                await page.mouse.down(button=button)
            elif action == 'up':
                if x is not None and y is not None:
                    await page.mouse.move(x, y)
                await page.mouse.up(button=button)
            elif action in ('click', 'dblclick'):
                await page.mouse.click(x, y, button=button,
                                       click_count=2 if action == 'dblclick' else 1)
            elif action == 'contextmenu':
                await page.mouse.click(x, y, button='right')
            else:  # wheel：页面内滚动，与光标位置无关，忽略 x/y
                await page.mouse.wheel(_panel_number(req.get('delta_x')),
                                       _panel_number(req.get('delta_y')))
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'error': _panel_error(e)}


async def panel_key(req: dict) -> dict:
    """把画面面板上的键盘事件转发到会话页：press 走按键（支持 "Control+A"），insert 走文本输入。"""
    action = str(req.get('action') or '')
    if action not in _PANEL_KEY_ACTIONS:
        return {'ok': False, 'error': f'未知的键盘动作: {action}'}
    payload = req.get('key') if action == 'press' else req.get('text')
    if payload is None or payload == '':
        return {'ok': False, 'error': '缺少 key' if action == 'press' else '缺少 text'}
    async with _page_lock:
        page = _session.get('page')
        if page is None:
            return {'ok': False, 'error': _PANEL_NO_PAGE_INPUT}
        try:
            if action == 'press':
                # playwright 原生支持 "Control+A"/"Shift+Enter" 这类带修饰键的写法
                await page.keyboard.press(str(payload))
            else:
                # 中文/非 ASCII 只能走 insert_text（press 只接受键名，非 ASCII 会直接报错）
                await page.keyboard.insert_text(str(payload))
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'error': _panel_error(e)}


async def panel_reload(req: dict) -> dict:
    """重新加载会话页，返回加载后的地址与标题（画面面板的刷新按钮）。"""
    async with _page_lock:
        page = _session.get('page')
        if page is None:
            return {'ok': False, 'error': _PANEL_NO_PAGE}
        try:
            await page.reload()
            return {'ok': True, 'url': page.url or '', 'title': (await page.title()) or ''}
        except Exception as e:
            return {'ok': False, 'error': _panel_error(e)}


def _panel_tab_id(value) -> int:
    """解析面板传来的标签 id：非正整数一律当 0（0 不是合法标签，调用方据此报"不存在"）。"""
    try:
        pid = int(value)
    except (TypeError, ValueError):
        return 0
    return pid if pid > 0 else 0


async def _session_facts() -> dict:
    """当前页的 has_page / url / title（标签栏切页、关页的应答复用）。"""
    page = _session.get('page')
    if page is None or page.is_closed():
        return {'has_page': False, 'url': '', 'title': ''}
    try:
        return {'has_page': True, 'url': page.url or '', 'title': (await page.title()) or ''}
    except Exception:
        return {'has_page': True, 'url': '', 'title': ''}


# ── IME 镜像（面板输入法组字实时同步）───────────────────────────────────────
# 本地输入法在面板的透明 textarea 上组字，每个缓冲字符经 CDP Input domain
# 写进会话页（Input.imeSetComposition 显示缓冲、Input.insertText 上屏）——
# 远程输入框里能看到拼音逐字出现，与本地打字体验一致（方案 D / 路线②）。
# 独立缓存一份 cdp session：screencast 的 session 随帧缓存重启，生命周期不同。
_ime: dict = {'page': None, 'cdp': None}


async def _ime_cdp(page):
    """当前页的 IME 命令通道；换页惰性重建（旧 session 随页失效，detach 忽略错误）。"""
    global _ime
    if _ime.get('page') is page and _ime.get('cdp') is not None:
        return _ime['cdp']
    stale = _ime.get('cdp')
    _ime.update({'page': page, 'cdp': None})
    if stale is not None:
        try:
            await stale.detach()
        except Exception:
            pass
    cdp = await page.context.new_cdp_session(page)
    _ime['cdp'] = cdp
    return cdp


async def panel_ime(req: dict) -> dict:
    """把面板输入法的组字链镜像到会话页：compose=缓冲可见，commit=最终文本上屏。

    前端对 compose/commit 串行发送（commit 必须晚于最后一个 compose 抵达）；
    x/y 为可选的页面 CSS 坐标（缓冲光标定位，一般取点击处）。
    """
    global _ime
    action = str(req.get('action') or '')
    if action not in ('compose', 'commit'):
        return {'ok': False, 'error': f'未知的 ime 动作: {action}'}
    text = str(req.get('text') or '')
    x, y = _panel_coord(req.get('x')), _panel_coord(req.get('y'))
    async with _page_lock:
        page = _session.get('page')
        if page is None:
            return {'ok': False, 'error': _PANEL_NO_PAGE_INPUT}
        try:
            cdp = await _ime_cdp(page)
            if action == 'compose':
                params: dict = {
                    'text': text,
                    'selectionStart': len(text),
                    'selectionEnd': len(text),
                }
                if x is not None and y is not None:
                    params['x'], params['y'] = x, y
                await cdp.send('Input.imeSetComposition', params)
            else:
                # insertText 用最终文本替换整个组合区并结束组合（Chromium 语义）。
                await cdp.send('Input.insertText', {'text': text})
            return {'ok': True}
        except Exception as e:
            # 页被换掉时 session 失效：丢弃缓存，下一次调用自动重建。
            _ime.update({'page': None, 'cdp': None})
            return {'ok': False, 'error': _panel_error(e)}


async def panel_resize(req: dict) -> dict:
    """视口跟随：把会话页视口改成面板容器的 CSS 像素尺寸（页面 reflow，画面 1:1）。

    无会话页时只记住期望（pending），开页/换页后由 _apply_panel_viewport 重放。
    CLOAK_VIEWPORT_FOLLOW=0 时为空操作（followed:false）。
    """
    global _PANEL_WANT
    if _VIEWPORT_FOLLOW_OFF:
        return {'ok': True, 'followed': False}
    size = _clamp_viewport(req.get('width'), req.get('height'))
    if size is None:
        return {'ok': False, 'error': '缺少或非法的 width/height'}
    async with _page_lock:
        _PANEL_WANT = {'width': size[0], 'height': size[1]}
        page = _session.get('page')
        if page is None:
            return {'ok': True, 'followed': True, 'pending': True,
                    'width': size[0], 'height': size[1]}
        await _apply_panel_viewport(page)
        try:
            vp = page.viewport_size or {}
        except Exception:
            vp = {}
        return {
            'ok': True, 'followed': True,
            'width': int(vp.get('width') or size[0]),
            'height': int(vp.get('height') or size[1]),
        }


async def panel_pages(req: dict) -> dict:
    """列出会话页标签（面板标签栏）：id / 地址 / 标题 / 是否当前页。

    列表就是"服务采纳过的页"，已关闭的会被顺手摘掉；`active_id` 为 0 表示一个都没有。
    """
    async with _page_lock:
        pages = []
        for pid, page in _open_tab_items():
            try:
                pages.append({
                    'id': pid, 'url': page.url or '', 'title': (await page.title()) or '',
                    'active': page is _session.get('page'),
                })
            except Exception:
                # 单页读不到标题（正在导航等）不该让整条列表失败：它按"无标题"留在列表里。
                pages.append({'id': pid, 'url': '', 'title': '', 'active': page is _session.get('page')})
        active_id = next((p['id'] for p in pages if p['active']), 0)
        return {'ok': True, 'pages': pages, 'active_id': active_id}


async def panel_select(req: dict) -> dict:
    """把某个标签切为当前页（面板点标签栏）；之后 panel_state 与 screenshot 都跟着它。"""
    async with _page_lock:
        pid = _panel_tab_id(req.get('id'))
        if _page_tabs.get(pid) is None:
            return {'ok': False, 'error': _PANEL_NO_TAB}
        _activate_page(pid)
        await _apply_panel_viewport(_page_tabs[pid])
        return {'ok': True, 'id': pid, **await _session_facts()}


async def panel_close(req: dict) -> dict:
    """关掉一个标签；关的正是当前页时，当前页回落到最近用过的存活标签。"""
    async with _page_lock:
        pid = _panel_tab_id(req.get('id'))
        page = _page_tabs.get(pid)
        if page is None:
            return {'ok': False, 'error': _PANEL_NO_TAB}
        was_active = page is _session.get('page')
        await _forget_page(page)
        if was_active:
            _session['page'] = None
            _activate_recent()
        return {'ok': True, 'closed': pid, **await _session_facts()}


async def handle_conn(reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                      proxy: str | None) -> None:
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
                result = await render(req, proxy)
            elif op == 'debug_navigate':
                result = await debug_navigate(req, proxy)
            elif op == 'debug_evaluate':
                result = await debug_evaluate(req)
            elif op == 'debug_network':
                result = await debug_network(req)
            elif op == 'debug_cookies':
                result = await debug_cookies(req)
            elif op == 'debug_websocket':
                result = await debug_websocket(req)
            elif op == 'debug_close':
                await _close_session(all_tabs=True)
                result = {'ok': True, 'closed': True}
            elif op == 'panel_state':
                result = await panel_state(req)
            elif op == 'ime':
                result = await panel_ime(req)
            elif op == 'panel_resize':
                result = await panel_resize(req)
            elif op == 'screenshot':
                result = await panel_screenshot(req)
            elif op == 'mouse':
                result = await panel_mouse(req)
            elif op == 'key':
                result = await panel_key(req)
            elif op == 'reload':
                result = await panel_reload(req)
            elif op == 'panel_pages':
                result = await panel_pages(req)
            elif op == 'panel_select':
                result = await panel_select(req)
            elif op == 'panel_close':
                result = await panel_close(req)
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
    ap.add_argument('--proxy', default=None,
                    help='代理地址（如 http://ip:port）；仅在按需拉起 cloakserve 时注入')
    ap.add_argument('--profile-dir', default=None, help='已废弃，忽略（持久化由 cloakserve 的 --data-dir 承担）')
    ap.add_argument('--port', type=int, default=0,
                    help='监听端口（缺省随机；dsh 插件按 BOBO_ROOT 派生端口传入以复用同一浏览器实例）')
    a = ap.parse_args()

    proxy = parse_proxy(a.proxy)

    server = await asyncio.start_server(
        lambda r, w: handle_conn(r, w, proxy),
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