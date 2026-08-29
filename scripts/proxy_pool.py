"""代理池管理模块：从代理API拉取IP，校验可用性，轮询/随机取用。

用法：
    pool = ProxyPool(api_url="...", apikey="...", pwd="...", getnum=50)
    proxy = pool.get_proxy(target_url="https://example.com", timeout=10)
    # proxy = "http://1.2.3.4:8080" 或 None（无可用代理）

    pool.mark_failed(proxy)  # 标记代理失败
    proxy = pool.get_proxy(...)  # 换下一个

    pool.mark_success(proxy)  # 标记代理成功（可选，用于统计）
"""

import argparse
import asyncio
import json
import os
import random
import sys
import time
from typing import Optional
from urllib.parse import urlsplit

import httpx
from httpx import Proxy


class ProxyPool:
    """代理池：管理一批代理IP，提供取用、校验、轮换功能。"""

    def __init__(
        self,
        api_url: str,
        apikey: str = '',
        pwd: str = '',
        getnum: int = 50,
        httptype: str = 'http',
        geshi: str = '2',
        fenge: str = '1',
        strategy: str = 'cache',  # 'cache' | 'realtime'
        timeout: int = 30,
    ):
        self.api_url = api_url
        self.apikey = apikey
        self.pwd = pwd
        self.getnum = getnum
        self.httptype = httptype
        self.geshi = geshi
        self.fenge = fenge
        self.strategy = strategy
        self.timeout = timeout

        self._cache: list[str] = []
        self._failed: set[str] = set()
        self._last_fetch: float = 0
        self._fetch_lock = asyncio.Lock()

    async def _fetch_from_api(self) -> list[str]:
        """调用代理API拉取一批IP。"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            params = {
                'apikey': self.apikey,
                'pwd': self.pwd,
                'getnum': self.getnum,
                'httptype': self.httptype,
                'geshi': self.geshi,
                'fenge': self.fenge,
                'operate': 'all',
            }
            try:
                # 若 api_url 已带完整查询参数（新增源只填一个完整地址时），
                # 直接按原样请求，避免 params 覆盖其中的 apikey/pwd 等凭证。
                if '?' in self.api_url:
                    resp = await client.get(self.api_url)
                else:
                    resp = await client.get(self.api_url, params=params)
                resp.raise_for_status()
                text = resp.text.strip()
                if not text:
                    return []
                # geshi=2 + fenge=1 => 换行分隔
                proxies = [p.strip() for p in text.split('\n') if p.strip()]
                return proxies
            except Exception as e:
                print(f"[proxy_pool] 代理API请求失败: {e}")
                return []

    async def _ensure_cache(self) -> None:
        """确保缓存非空（缓存模式下才触发）。"""
        if self.strategy != 'cache':
            return
        if self._cache:
            return
        async with self._fetch_lock:
            # double-check after acquiring lock
            if self._cache:
                return
            proxies = await self._fetch_from_api()
            if proxies:
                random.shuffle(proxies)
                self._cache = proxies
                self._last_fetch = time.time()

    async def fetch_batch(self) -> list[str]:
        """实时模式：拉取一批新的IP。"""
        proxies = await self._fetch_from_api()
        if proxies:
            random.shuffle(proxies)
        return proxies

    async def get_proxy(self, target_url: Optional[str] = None) -> Optional[str]:
        """获取一个可用代理。

        - 缓存模式：从缓存中取，缓存空则拉取一批。
        - 实时模式：每次都拉取新一批。
        - 返回格式：http://ip:port 或 socks5://ip:port
        """
        if self.strategy == 'realtime':
            proxies = await self.fetch_batch()
            for p in proxies:
                if p not in self._failed:
                    if target_url is None or await self._test_proxy(p, target_url):
                        return p
            return None

        # cache mode
        await self._ensure_cache()
        while self._cache:
            # 过滤掉已标记失败的
            self._cache = [p for p in self._cache if p not in self._failed]
            if not self._cache:
                # 缓存全部失败，尝试重新拉取一次
                self._cache = []
                self._failed.clear()
                await self._ensure_cache()
                if not self._cache:
                    return None
            proxy = self._cache.pop(0)
            if target_url and not await self._test_proxy(proxy, target_url):
                self._failed.add(proxy)
                continue
            return proxy

        return None

    async def _test_proxy(self, proxy: str, target_url: str) -> bool:
        """测试代理是否可用（请求目标网页本身）。"""
        proxy_url = self._format_proxy(proxy)
        try:
            async with httpx.AsyncClient(
                proxy=Proxy(proxy_url),
                timeout=self.timeout,
                follow_redirects=True,
            ) as client:
                resp = await client.get(target_url)
                return 200 <= resp.status_code < 400
        except Exception:
            return False

    def _format_proxy(self, proxy: str) -> str:
        """格式化代理地址。"""
        if '://' in proxy:
            return proxy
        return f'http://{proxy}'

    def mark_failed(self, proxy: str) -> None:
        """标记代理失败。"""
        self._failed.add(proxy)

    def mark_success(self, proxy: str) -> None:
        """标记代理成功（可选，用于统计）。"""
        pass  # 可以添加成功率统计

    def clear_failed(self) -> None:
        """清除失败标记（重置）。"""
        self._failed.clear()

    def clear_cache(self) -> None:
        """清空缓存，强制下次拉取新一批。"""
        self._cache.clear()
        self._failed.clear()
        self._last_fetch = 0


def create_proxy_pool_from_config(config: dict) -> Optional[ProxyPool]:
    """从配置字典创建代理池实例。

    config 字段：
      - apiUrl, apiKey, pwd, getnum, httptype, geshi, fenge
      - fetchStrategy ('cache' | 'realtime')
      - timeoutMs
    """
    api_url = config.get('apiUrl', '')
    if not api_url:
        return None
    return ProxyPool(
        api_url=api_url,
        apikey=config.get('apiKey', ''),
        pwd=config.get('pwd', ''),
        getnum=config.get('getnum', 50),
        httptype=config.get('httptype', 'http'),
        geshi=config.get('geshi', '2'),
        fenge=config.get('fenge', '1'),
        strategy=config.get('fetchStrategy', 'cache'),
        timeout=config.get('timeoutMs', 30000) // 1000,
    )


# ════════════════════════════════════════════════════════════════════════
# 命令行入口（供 tool-acquisition 以子进程调用）
# 用法：
#   python proxy_pool.py --action get --config-json '<json>' --target-url <url>
#       → 成功输出 {"proxy":"http://ip:port", "checked":N, "valid":K},
#         3 轮筛选全失效输出 {"proxy":null, "failed":true, "reason":"all_invalid_after_3_rounds"}
#   python proxy_pool.py --action fail --proxy <ip:port>
#       → 把该代理记为失败（持久化到项目 data/proxy_failed.json，15 分钟 TTL）
#
# 每次 get 最多做 3 轮"拉取一批→逐个对目标页测试→筛出有效代理"；整批全失效则整批
# 重取。这是"使用前先测、筛出有效的用；全失效重请一次；3 次全失效报代理失效"的落实。
# ════════════════════════════════════════════════════════════════════════

FAILED_LEDGER_FILE = 'proxy_failed.json'
FAILED_TTL_SECONDS = 15 * 60
MAX_SCREEN_ROUNDS = 3
# 筛选探测：单轮内最多测 N 个代理，找到有效的即返回；每个代理的连通探测超时。
# 正常批次前几个就能命中（<1s）；只有"整批全死"才走到 3 轮，由上限兜底避免长时间空转。
SCREEN_PROBE_CAP = 10
SCREEN_TIMEOUT = 8


def _project_data_dir() -> str:
    """本项目根目录下的 data/（scripts 在项目根的下一级）。"""
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, '..', 'data')


def _failed_path() -> str:
    return os.path.join(_project_data_dir(), FAILED_LEDGER_FILE)


def _load_failed() -> dict:
    """读取持久化失败账本 {归一化代理: 失败时间戳}。"""
    try:
        with open(_failed_path(), 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _prune_failed(now: float) -> dict:
    """剔除超过 TTL 的失败记录，剩下的返回。"""
    return {k: v for k, v in _load_failed().items() if now - v < FAILED_TTL_SECONDS}


def _save_failed(failed: dict) -> None:
    """原子写失败账本。"""
    path = _failed_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(failed, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _normalize_proxy(proxy: str) -> str:
    """去掉 scheme，得到 ip:port，作为失败账本/去重的主键。"""
    p = proxy
    if '://' in p:
        p = p.split('://', 1)[1]
    return p


def _proxy_scheme(httptype: str) -> str:
    """按代理类型返回 Playwright/httpx 可用的 scheme 前缀。"""
    t = (httptype or 'http').lower()
    if 'socks' in t:
        return 'socks5://'
    if 'https' in t:
        return 'https://'
    return 'http://'


def cli_mark_failed(proxy: str) -> None:
    """把代理写入失败账本（跳过在 15 分钟 TTL 内已记过的）。"""
    now = time.time()
    failed = _prune_failed(now)
    failed[_normalize_proxy(proxy)] = now
    _save_failed(failed)


async def _screens_proxy(pool: ProxyPool, proxy: str, target_url: str) -> bool:
    """筛选探针：只要目标站回了**任一** HTTP 响应即视为代理可用。

    反爬/JS 挑战站（如知乎）对纯 HTTP 客户端返回 403/挑战页，但此时代理其实
    已经到达目标主机——是否真能采下来应由真实浏览器（camoufox）定夺，筛选阶段
    不应据此把代理判死。因此只有超时/拒连/重置这类"代理本身不通"才判无效。
    """
    proxy_url = pool._format_proxy(proxy)
    try:
        async with httpx.AsyncClient(
            proxy=httpx.Proxy(proxy_url),
            timeout=pool.timeout,
            follow_redirects=True,
        ) as client:
            await client.get(target_url)
            return True  # 拿到了任一响应（含 4xx/5xx）
    except Exception:
        return False


async def cli_screen(sources: list, strategy: str, timeout_ms: int,
                     target_url: Optional[str]) -> dict:
    """3 轮"拉取→测试→筛有效代理"。返回代理或全失效标记。"""
    now = time.time()
    failed = _prune_failed(now)
    checked_total = 0
    for round_idx in range(MAX_SCREEN_ROUNDS):
        round_valid: Optional[str] = None
        probes = 0
        for src in sources:
            if round_valid is not None:
                break
            if not src.get('enabled', True):
                continue
            api_url = src.get('apiUrl')
            if not api_url:
                continue
            pool = ProxyPool(
                api_url=api_url,
                apikey=src.get('apiKey', ''),
                pwd=src.get('pwd', ''),
                getnum=src.get('getnum', 50),
                httptype=src.get('httptype', 'http'),
                geshi=src.get('geshi', '2'),
                fenge=src.get('fenge', '1'),
                strategy=strategy or 'cache',
                # 筛选阶段用较短探测超时；真实采集由采集脚本用自己的超时。
                timeout=min(SCREEN_TIMEOUT, (timeout_ms or 30000) // 1000),
            )
            proxies = await pool.fetch_batch()
            scheme = _proxy_scheme(src.get('httptype', 'http'))
            for p in proxies:
                if probes >= SCREEN_PROBE_CAP:
                    break
                if _normalize_proxy(p) in failed:
                    continue
                probes += 1
                checked_total += 1
                if not target_url or await _screens_proxy(pool, p, target_url):
                    round_valid = scheme + p
                    break
        if round_valid is not None:
            return {
                'proxy': round_valid,
                'screened': checked_total,
                'valid': 1,
                'round': round_idx + 1,
            }
    return {
        'proxy': None,
        'failed': True,
        'reason': 'all_invalid_after_3_rounds',
        'screened': checked_total,
    }


def _print_result(result: dict) -> None:
    print(json.dumps(result, ensure_ascii=False))


def main() -> int:
    ap = argparse.ArgumentParser(description='BoBo Proxy Pool CLI')
    ap.add_argument('--action', required=True, choices=['get', 'fail'])
    ap.add_argument('--config-json', default=None, help='sources/fetchStrategy/timeoutMs 的 JSON')
    ap.add_argument('--target-url', default=None, help='用于筛选代理的目标网页')
    ap.add_argument('--proxy', default=None, help='fail 动作要标记的代理')
    a = ap.parse_args()

    if a.action == 'fail':
        if not a.proxy:
            _print_result({'ok': False, 'error': 'action fail requires --proxy'})
            return 1
        cli_mark_failed(a.proxy)
        _print_result({'ok': True, 'proxy': _normalize_proxy(a.proxy)})
        return 0

    # action == get
    if not a.config_json:
        _print_result({'proxy': None, 'failed': True, 'reason': 'missing_config'})
        return 1
    try:
        cfg = json.loads(a.config_json)
    except Exception as e:
        _print_result({'proxy': None, 'failed': True, 'reason': 'bad_config', 'error': str(e)})
        return 1

    sources = cfg.get('sources')
    if not sources:
        # 兼容单源配置（直接传 {apiUrl,...}）
        sources = [cfg]
    result = asyncio.run(cli_screen(
        sources,
        cfg.get('fetchStrategy', 'cache'),
        cfg.get('timeoutMs', 30000),
        a.target_url,
    ))
    _print_result(result)
    return 0


if __name__ == '__main__':
    sys.exit(main())
