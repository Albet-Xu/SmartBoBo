# -*- coding: utf-8 -*-
"""生成 / 读取 SmartBoBo 全局环境清单（dbx-runtime/env-manifest.json）。

该清单是采集 / 逆向 / 工作流模式下，模型、浏览器服务与提取脚本共用的「唯一事实来源」。
由启动脚本在每次启动时幂等刷新；`bobo-env` 技能告诉模型直接读它，
无需每次费力查找 python / CloakBrowser / 代理 / 数据库等位置。

本项目的唯一浏览器引擎是 CloakBrowser（cloak/bin/cloakserve，CDP 多路复用服务）：
cloakserve 由 dsh-cloakbrowser 插件与 browser_server.py 按需拉起、
常驻复用；这里只做「文件就绪 + 端口在跑」的无副作用探测，**绝不**拉起任何进程、
绝不联网下载。

对外函数：
  - read_manifest(root) / build_manifest(root) / write_manifest(m, out)
  - cloakserve_readiness()  探测文件就绪与端口状态，返回 dict；不拉起、不下载

CLI：
  python gen_env_manifest.py                探测并写盘清单
  python gen_env_manifest.py --root <根目录>  显式指定 BoBo 根目录
  python gen_env_manifest.py --out <路径>     显式指定清单输出路径
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
from datetime import datetime
from pathlib import Path

_SCHEMA_VERSION = 2

# cloakserve 默认端口（与 cloak/plugin/service.js 及 cordis.patch.yml 的配置一致）
CLOAKSERVE_PORT = int(os.environ.get("BOBO_CLOAKSERVE_PORT") or "9333")


# ── BoBo 根目录定位（与 dbx_connector.find_bobo_root 等价，避免跨技能强依赖）──

def find_bobo_root(start: str | None = None) -> Path | None:
    """定位 BoBo 根目录。

    根标记目录优先 `dbx-runtime`（开发板仓库根），其次 `dbx`（安装包的
    resources/runtime 下同目录，dbx-runtime 在打包布局里改名成了 dbx）。
    查找顺序：环境变量 BOBO_ROOT > 从 start/当前目录向上找。找不到返回 None。
    """
    markers = ("dbx-runtime", "dbx")
    env_root = os.environ.get("BOBO_ROOT")
    if env_root:
        p = Path(env_root).resolve()
        if any((p / m).is_dir() for m in markers):
            return p
    cur = Path(start).resolve() if start else Path.cwd().resolve()
    for cand in (cur, *cur.parents):
        if any((cand / m).is_dir() for m in markers):
            return cand
    return None


def _python_bin(root: Path) -> str:
    """项目虚拟环境解释器路径（Windows Scripts / Unix bin）。"""
    return str(root / ".venv" / "Scripts" / "python.exe") if os.name == "nt" \
        else str(root / ".venv" / "bin" / "python")


# ── cloakserve 就绪探测（不拉起、不下载）────────────────────────────────────

def _port_open(host: str, port: int, timeout: float = 0.5) -> bool:
    """TCP 端口是否在监听（快速无副作用探测）。"""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def cloakserve_readiness(root: Path) -> dict:
    """探测 CloakBrowser（cloakserve）就绪状态。

    返回 {ready, running, script, dataDir, port, error}：
      - ready   : 文件就绪（cloak/bin/cloakserve 存在且 .venv 解释器存在）
      - running : 端口在监听（服务已被插件/采集拉起）
      - ready=true 且 running=false 是常态：首次需要浏览器时自动拉起，无需预热。
    绝不拉起进程、绝不联网下载（预铺运行时用 cloak/ensure.ps1，幂等）。
    """
    info: dict = {
        "ready": False, "running": False, "script": "", "dataDir": "",
        "port": CLOAKSERVE_PORT, "error": "",
    }
    script = root / "cloak" / "bin" / "cloakserve"
    data_dir = root / "cloak" / "data"
    info["script"] = str(script)
    info["dataDir"] = str(data_dir)
    if not script.exists():
        info["error"] = f"cloakserve 脚本缺失: {script}（运行 cloak/ensure.ps1 预铺运行时）"
        return info
    if not Path(_python_bin(root)).exists():
        info["error"] = f".venv 解释器缺失: {_python_bin(root)}（运行 uv sync）"
        return info
    info["ready"] = True
    info["running"] = _port_open("127.0.0.1", CLOAKSERVE_PORT)
    return info


# ── 清单构造 / 读写 ─────────────────────────────────────────────────────────

def dsh_home(root: Path) -> Path:
    """dsh 状态目录：优先环境变量 DSH_HOME，否则 <BoBo 根>/.dsh（与启动脚本一致）。"""
    env = os.environ.get("DSH_HOME", "").strip()
    return Path(env) if env else root / ".dsh"


def build_manifest(root: Path) -> dict:
    """探测当前环境并构造清单字典（不写盘）。"""
    settings = dsh_home(root) / "settings.yaml"
    return {
        "schemaVersion": _SCHEMA_VERSION,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "boboRoot": str(root),
        "pythonBin": _python_bin(root),
        "scriptsDir": str(root / "scripts"),
        "dbxDataDir": str(root / "dbx-runtime" / "data"),
        "crawlScriptDir": str(root / "crawl_script"),
        "proxyPoolConfig": f"{settings}（命名空间 proxy-pool；会话用 /proxy 命令开关）",
        "siteKeyNote": "站点键 = 域名去 www. + 点转横线（news.qq.com→news-qq-com）；产物按站点归类在 <工作区>/<站点键>/{data,crawl_script,extraction_scripts}/。",
        "browserServer": {
            "host": "127.0.0.1",
            "adapterPort": "由 BOBO_ROOT 的 crc32 派生于 20000-39999（scripts/crawl_common.py derive_browser_port）",
            "cdpPort": CLOAKSERVE_PORT,
            "protocol": "采集/调试/面板走 browser_server.py 的回环 TCP 一行 JSON；其后端经 CDP 连 cloakserve（唯一浏览器服务）",
        },
        "cloakserve": cloakserve_readiness(root),
        "workspaceNote": (
            "data/、crawl_script/、extraction_scripts/ 按站点归类在 <工作区>/<站点键>/ 下"
            "（站点键 = 域名去 www. + 点转横线，如 news.qq.com→news-qq-com），而非 BoBo 根；"
            "BoBo 根 crawl_script/ 仅为历史/示例存量。CloakBrowser 运行时由 cloak/ensure.ps1 预铺"
            "（幂等），服务由插件/采集按需拉起常驻复用，不要自行再启动新的浏览器进程。"
        ),
    }


def read_manifest(root: Path) -> dict:
    """读取清单；缺失或损坏返回空 dict。"""
    p = root / "dbx-runtime" / "env-manifest.json"
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 — 损坏则视为无清单
            pass
    return {}


def write_manifest(manifest: dict, out: Path) -> None:
    """写清单到 out（UTF-8，缩进 2）。父目录不存在则自动创建。"""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


# ── CLI ────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="生成 / 刷新 SmartBoBo 全局环境清单（含 cloakserve 就绪探测）。")
    ap.add_argument("--root", default="", help="显式指定 BoBo 根目录（缺省自动定位含 dbx-runtime 的目录）")
    ap.add_argument("--out", default="", help="显式指定清单输出路径（缺省 <root>/dbx-runtime/env-manifest.json）")
    a = ap.parse_args(argv)

    root = Path(a.root).resolve() if a.root else find_bobo_root()
    if root is None:
        print("错误: 未定位到 BoBo 根目录（含 dbx-runtime 的目录）。请用 --root 显式指定。", file=sys.stderr)
        return 1

    manifest = build_manifest(root)
    out = Path(a.out) if a.out else (root / "dbx-runtime" / "env-manifest.json")
    write_manifest(manifest, out)
    cloak = manifest["cloakserve"]
    state = "已就绪" if cloak["ready"] else "未就绪"
    running = "（服务在跑）" if cloak["running"] else "（未拉起，首次用浏览器时自动启动）"
    print(f"已生成环境清单: {out}")
    print(f"  pythonBin  : {manifest['pythonBin']}")
    print(f"  dbxDataDir : {manifest['dbxDataDir']}")
    print(f"  cloakserve : {state}{running if cloak['ready'] else ''}")
    if not cloak["ready"]:
        print(f"  提示: {cloak['error']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
