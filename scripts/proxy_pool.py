"""代理池管理模块：从代理API拉取IP，校验可用性，轮询/随机取用。

用法：
    pool = ProxyPool(api_url="...", apikey="...", pwd="...", getnum=50)
    proxy = pool.get_proxy(target_url="https://example.com", timeout=10)
    # proxy = "http://1.2.3.4:8080" 或 None（无可用代理）

    pool.mark_failed(proxy)  # 标记代理失败
    proxy = pool.get_proxy(...)  # 换下一个

    pool.mark_success(proxy)  # 标记代理成功（可选，用于统计）
"""

import asyncio
import random
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
