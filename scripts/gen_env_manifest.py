# -*- coding: utf-8 -*-
"""生成 / 读取 BoBo 全局环境清单（dbx-runtime/env-manifest.json）。

该清单是爬虫 / 逆向 / 工作流模式下，模型、浏览器服务与提取脚本共用的「唯一事实来源」
（方案 A：全局申明）。由启动脚本在每次启动时幂等刷新；`bobo-env` 技能告诉模型直接读它，
无需每次费力查找 python / camoufox / 代理 / 数据库等位置。

本脚本同时把 camoufox 浏览器二进制的就绪探测与「受控预铺」集中到这里，供
browser_server.py 与启动脚本复用，根治「camoufox 重新下载」：
  - camoufox 浏览器二进制由 pip 包在**首次使用时**联网下载到用户缓存目录（user_cache_dir），
    不在项目内、安装包不带——这就是高温运行时静默重新下载的根源。
  - 这里用 camoufox.pkgman.camoufox_path(download_if_missing=False) 做探测，**绝不触发下载**；
    需预铺时由启动脚本显式调 ensure_camoufox() 跑一次受控的 `python -m camoufox fetch`（幂等，就绪即跳过）。

对外函数（可被 browser_server.py `import gen_env_manifest` 复用）：
  - read_manifest(root) / build_manifest(root) / write_manifest(m, out)
  - camoufox_readiness()   探测就绪与否，返回 dict；绝不下载
  - camoufox_executable()  已就绪返回可执行路径，否则返回 None（不下载）
  - ensure_camoufox()      未就绪时受控预铺一次（幂等）

CLI：
  python gen_env_manifest.py                    探测并写盘清单
  python gen_env_manifest.py --ensure-camoufox  先受控预铺 camoufox，再写盘
  python gen_env_manifest.py --root <根目录>    显式指定 BoBo 根目录
  python gen_env_manifest.py --out <路径>       显式指定清单输出路径
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

_SCHEMA_VERSION = 1


# ── BoBo 根目录定位（与 dbx_connector.find_bobo_root 等价，避免跨技能强依赖）──

def find_bobo_root(start: str | None = None) -> Path | None:
    """定位含 `dbx-runtime` 目录的 BoBo 根目录。

    查找顺序：环境变量 BOBO_ROOT > 从 start/当前目录向上找。找不到返回 None。
    """
    env_root = os.environ.get("BOBO_ROOT")
    if env_root:
        p = Path(env_root).resolve()
        if (p / "dbx-runtime").is_dir():
            return p
    cur = Path(start).resolve() if start else Path.cwd().resolve()
    for cand in (cur, *cur.parents):
        if (cand / "dbx-runtime").is_dir():
            return cand
    return None


def _python_bin(root: Path) -> str:
    """BoBo 虚拟环境解释器路径（Windows Scripts / Unix bin）。"""
    return str(root / ".venv" / "Scripts" / "python.exe") if os.name == "nt" \
        else str(root / ".venv" / "bin" / "python")


# ── camoufox 就绪探测（绝不触发下载）与受控预铺 ────────────────────────────

def _bundled_camoufox_home() -> Path | None:
    """定位随包/项目内置的 camoufox 安装（打包版 <根>/camoufox 布局）。

    打包版把 camoufox 缓存放在 <根>/camoufox/camoufox/Cache/browsers/official/<版本>/camoufox.exe。
    优先按 __file__ 定位根目录（scripts/ 的上一级 = 项目根/运行根）探测，其次看 BOBO_ROOT 环境变量，
    两种都命中不了返回 None（回退到 platformdirs 用户缓存）。
    这样打包版在目标机上不依赖 %LOCALAPPDATA% 环境变量即可命中自带内核。
    """
    homes = [Path(__file__).resolve().parent.parent]
    if os.environ.get("BOBO_ROOT"):
        homes.append(Path(os.environ["BOBO_ROOT"]).resolve())
    for root in homes:
        bundled = root / "camoufox"
        if (bundled / "camoufox" / "Cache" / "browsers" / "official").is_dir():
            return bundled
    return None


def camoufox_readiness() -> dict:
    """探测 camoufox 浏览器二进制是否就绪。返回 {ready, home, executable, version, error}。

    优先使用随包/项目内置的 <根>/camoufox 内核（打包版跨机关键：不依赖 %LOCALAPPDATA%），
    否则回退 camoufox.pkgman.camoufox_path(download_if_missing=False)（开发版/真缓存）。
    缺失时抛异常返回 ready=False，**不会**像默认行为那样静默联网下载。
    """
    info: dict = {"ready": False, "home": "", "executable": "", "version": "", "error": ""}
    try:
        bundle_home = _bundled_camoufox_home()
        if bundle_home is not None:
            official = bundle_home / "camoufox" / "Cache" / "browsers" / "official"
            exe_name = "camoufox.exe" if os.name == "nt" else "camoufox-bin"
            candidates = [d for d in official.iterdir() if d.is_dir()]
            exe = None
            for d in sorted(candidates, reverse=True):
                cand = d / exe_name
                if cand.exists():
                    exe = cand
                    break
            if exe is not None:
                info.update(home=str(bundle_home), executable=str(exe),
                            version=exe.parent.name, ready=True)
                return info
        from camoufox.pkgman import camoufox_path, installed_verstr, launch_path
        home = camoufox_path(download_if_missing=False)
        info["home"] = str(home)
        info["executable"] = launch_path(home)  # 显式传已定位路径，避免内部再触发下载
        info["version"] = installed_verstr()
        info["ready"] = True
    except Exception as e:  # noqa: BLE001 — 未安装 / 版本不兼容等一律视为未就绪
        info["error"] = str(e).strip()
    return info


def camoufox_executable() -> str | None:
    """返回 camoufox 可执行文件路径；未就绪返回 None（不触发下载）。"""
    r = camoufox_readiness()
    return r["executable"] if r["ready"] else None


def ensure_camoufox() -> dict:
    """受控预铺 camoufox：已就绪直接返回；未就绪跑一次 `python -m camoufox fetch` 后重探。"""
    if camoufox_readiness()["ready"]:
        return camoufox_readiness()
    subprocess.run([sys.executable, "-m", "camoufox", "fetch"], check=False)
    return camoufox_readiness()


# ── 清单构造 / 读写 ─────────────────────────────────────────────────────────

def build_manifest(root: Path) -> dict:
    """探测当前环境并构造清单字典（不写盘）。"""
    settings = Path.home() / ".dsh" / "settings.yaml"
    return {
        "schemaVersion": _SCHEMA_VERSION,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "boboRoot": str(root),
        "pythonBin": _python_bin(root),
        "scriptsDir": str(root / "scripts"),
        "dbxDataDir": str(root / "dbx-runtime" / "data"),
        "crawlScriptDir": str(root / "crawl_script"),
        "proxyPoolConfig": f"{settings}（命名空间 proxy-pool；会话用 /proxy 命令开关）",
        "browserServer": {
            "host": "127.0.0.1",
            "port": "由 BOBO_ROOT 的 crc32 派生于 20000-39999（scripts/crawl_common.py derive_browser_port）",
            "protocol": "回环 TCP，一行 JSON 请求 / 应答；浏览器常驻复用同一 context",
        },
        "camoufox": camoufox_readiness(),
        "workspaceNote": (
            "data/ 与 extraction_scripts/ 位于当前工作区（{{cwd}}）下而非 BoBo 根；"
            "crawl_script/ 位于 BoBo 根。camoufox 浏览器二进制安装于用户缓存目录（不在项目内），"
            "缺失时请用 `python gen_env_manifest.py --ensure-camoufox` 受控预铺一次，"
            "勿让运行时静默联网下载。"
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
    ap = argparse.ArgumentParser(description="生成 / 刷新 BoBo 全局环境清单（含 camoufox 就绪探测）。")
    ap.add_argument("--root", default="", help="显式指定 BoBo 根目录（缺省自动定位含 dbx-runtime 的目录）")
    ap.add_argument("--out", default="", help="显式指定清单输出路径（缺省 <root>/dbx-runtime/env-manifest.json）")
    ap.add_argument("--ensure-camoufox", action="store_true",
                    help="先受控预铺 camoufox（幂等，就绪即跳过），再写清单")
    a = ap.parse_args(argv)

    root = Path(a.root).resolve() if a.root else find_bobo_root()
    if root is None:
        print("错误: 未定位到 BoBo 根目录（含 dbx-runtime 的目录）。请用 --root 显式指定。", file=sys.stderr)
        return 1

    if a.ensure_camoufox:
        cam = ensure_camoufox()
        print(f"camoufox: {'已就绪 ' + cam['version'] if cam['ready'] else '预铺后仍缺失（' + (cam['error'] or '未知') + '）'}")
        if not cam["ready"]:
            print("提示: 请检查网络后重新 `python -m camoufox fetch`。", file=sys.stderr)
            # 仍写清单（ready=False），让模型知道现状
    manifest = build_manifest(root)
    out = Path(a.out) if a.out else (root / "dbx-runtime" / "env-manifest.json")
    write_manifest(manifest, out)
    cam = manifest["camoufox"]
    print(f"已生成环境清单: {out}")
    print(f"  pythonBin : {manifest['pythonBin']}")
    print(f"  dbxDataDir: {manifest['dbxDataDir']}")
    print(f"  camoufox  : {'已就绪 ' + cam['version'] if cam['ready'] else '未就绪（' + (cam['error'] or '未知') + '）'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())