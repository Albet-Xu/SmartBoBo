# -*- coding: utf-8 -*-
"""camoufox-debug —— 本地 MCP server：为逆向分析提供「camoufox 长驻浏览器」的调试工具。

模型可见工具（serverName=camoufox-debug → mcp__camoufox-debug__*）：
- debug_navigate(url, wait_ms?, body_limit_kb?, capture_websocket?)  —— 打开并**保持会话页**：
  捕获网络请求/响应（含 body 样本）、console、websocket；返回页面摘要
- debug_evaluate(expression)  —— 在**主世界**执行 JavaScript（可调用页面自身函数 / 抠签名参数 / 验混淆）
- debug_network(filter_patterns?)  —— 查看捕获的网络条目（url/method/status/头/body 样本）
- debug_cookies(urls?)  —— 查看长驻上下文 cookies（动态 cookie / 登录态分析）
- debug_websocket()  —— 查看 websocket 消息分组
- debug_close()  —— 关闭会话页

设计要点：
- **浏览器统一走 camoufox**（browser_server.py 长驻服务），不引入任何其它浏览器内核；
  通过 BOBO_ROOT 派生的稳定端口复用 dsh 插件（tool-acquisition）已拉起的同一浏览器实例；
  未启动时由本服务器自行拉起（同一端口规则，见 crawl_common.derive_browser_port）。
- 会话语义：debug_navigate 之后页面保持打开，随后可连续 evaluate / 查网络 / 查 cookie / 查 ws；
  debug_close 关闭。Cookie/登录态在同一长驻上下文内延续。
- 与 js-reverse 的边界：不断点、无源码级调用栈、无 CDP 静默导航（Firefox 无 CDP）；
  覆盖逆向高频链路：接口定位 / 参数签名 / 动态 cookie / 混淆验证。
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
from pathlib import Path

# 确保可 import 同目录共享模块（脚本可能被任意 cwd 调用）
sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.fastmcp import FastMCP  # noqa: E402

from crawl_common import ServerUnreachable, derive_browser_port, send_cmd  # noqa: E402

mcp = FastMCP("camoufox-debug")

# ── 浏览器服务定位 / 拉起（与 tool-acquisition 同一端口规则，复用同一实例） ────────
_server_addr: str | None = None
_server_proc: subprocess.Popen | None = None


def _root() -> Path | None:
    """定位 BoBo 根（env BOBO_ROOT 优先；否则从本文件向上找含 dsh 的目录）。"""
    env = os.environ.get("BOBO_ROOT", "").strip()
    if env:
        return Path(env).resolve()
    cur = Path(__file__).resolve()
    for _ in range(12):
        if (cur / "dsh").is_dir():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def _addr() -> str:
    global _server_addr, _server_proc
    if _server_addr is not None:
        return _server_addr
    root = _root() or Path.cwd()
    port = derive_browser_port(root)
    addr = f"127.0.0.1:{port}"

    # 已有服务在跑（tool-acquisition 拉起的）→ 直接复用
    try:
        r = send_cmd(addr, {"op": "ping"}, connect_timeout=2.0)
        if r.get("pong"):
            _server_addr = addr
            return addr
    except ServerUnreachable:
        pass

    # 未启动 → 自行拉起（同一派生端口）
    script = Path(__file__).resolve().parent / "browser_server.py"
    proc = subprocess.Popen(
        [sys.executable, str(script), "--port", str(port)],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8",
    )
    _server_proc = proc
    ready_line = proc.stdout.readline() if proc.stdout else ""
    if not ready_line.strip().startswith("READY"):
        try:
            proc.kill()
        except Exception:
            pass
        raise RuntimeError(f"camoufox 浏览器服务启动失败: {ready_line.strip() or '无 READY 输出'}")
    _server_addr = addr

    def _on_exit():
        try:
            if _server_proc and _server_proc.poll() is None:
                _server_proc.kill()
        except Exception:
            pass

    import atexit
    atexit.register(_on_exit)
    return addr


def _call(op: str, params: dict, *, timeout: float = 60.0) -> dict:
    """向长驻浏览器服务发调试指令；不可达时重启一次并重试。"""
    try:
        return send_cmd(_addr(), {"op": op, **params}, connect_timeout=timeout)
    except ServerUnreachable:
        _rearm()
        return send_cmd(_addr(), {"op": op, **params}, connect_timeout=timeout)


def _rearm():
    global _server_addr, _server_proc
    _server_addr = None
    _server_proc = None


@mcp.tool()
def debug_navigate(url: str, wait_ms: int = 6000, body_limit_kb: int = 50,
                   capture_websocket: bool = True) -> dict:
    """打开目标页并保持会话：捕获网络请求/响应、console、websocket，返回页面摘要。

    逆向前调用：拿到页面后可用 debug_evaluate / debug_network / debug_cookies 连续分析。
    同一长驻上下文，Cookie/登录态延续；再次调用会关闭上一会话页并重新导航。

    Args:
        url: 目标网址（http/https）
        wait_ms: 导航完成后等待 JS 的时间（毫秒，默认 6000）
        body_limit_kb: 每个响应/请求 body 的最大捕获长度（KB，默认 50）
        capture_websocket: 是否捕获 websocket 消息（默认 true）
    """
    r = _call("debug_navigate", {
        "url": url, "wait_ms": int(wait_ms), "body_limit_kb": int(body_limit_kb),
        "capture_websocket": bool(capture_websocket),
    }, timeout=180.0)
    if r.get("hint"):
        r.pop("hint")
    return r


@mcp.tool()
def debug_evaluate(expression: str) -> dict:
    """在页面主世界执行 JavaScript 并返回可 JSON 化的结果。

    可调用页面自身函数、读取全局变量、验证签名参数、抠加密逻辑等。需先 debug_navigate。

    Args:
        expression: 要执行的 JS 表达式（如 "window.__INITIAL_DATA__"、"sign(param)"）
    """
    return _call("debug_evaluate", {"expression": expression}, timeout=60.0)


@mcp.tool()
def debug_network(filter_patterns: list[str] | None = None) -> dict:
    """返回当前会话捕获的网络请求/响应（含请求头、POST body、响应体样本）。

    Args:
        filter_patterns: 可选正则列表，只返回 URL 命中的条目（如 ["/api/", "sign"]）
    """
    return _call("debug_network", {"patterns": filter_patterns or []}, timeout=60.0)


@mcp.tool()
def debug_cookies(urls: list[str] | None = None) -> dict:
    """返回长驻上下文的 cookies（动态 cookie / 登录态分析）。

    Args:
        urls: 可选 URL 列表限定域名；缺省取当前会话页所属域
    """
    return _call("debug_cookies", {"urls": urls or []}, timeout=60.0)


@mcp.tool()
def debug_websocket() -> dict:
    """返回当前会话捕获到的 websocket 连接与消息分组（消息文本，限流）。"""
    return _call("debug_websocket", {}, timeout=60.0)


@mcp.tool()
def debug_close() -> dict:
    """关闭当前会话页并清空捕获内容（释放资源）。"""
    return _call("debug_close", {}, timeout=30.0)


def main() -> int:
    mcp.run()


if __name__ == "__main__":
    raise SystemExit(main())