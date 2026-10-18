# -*- coding: utf-8 -*-
"""SmartBoBo 装配层端到端验收脚本。

用途
----
把「手工验收」变成一条可重复运行的命令。各插件的纯逻辑自检
（`node bobo/plugins/<插件>.mjs --selftest`）只覆盖插件内部；本脚本补的是**装配层**：
预设能不能挂载、技能能不能被发现、提示词里点名的工具名与真实 serverName 对不对得上。

检查项（每条都会打印 `✔/✘ <检查项> — <证据>`）
  1. 启动        与 启动.cmd 同一套 env，起打包内核 `dsh web` 并抓 `?token=`
  2. 预设挂载    结构校验（agent.cordis.yml / decl.yml 可解析、file:// 引用命中磁盘）
                 后逐个 POST /api/session/create
  3. 技能发现    每个预设会话 skills/list 断言用户级技能（bobo-env / db-extraction）可见；
                 settings/describe 断言 proxy-pool 命名空间已注册
  4. 装配一致性  静态交叉核对 `mcp__<serverName>__<tool>` 与宿主层/预设的 serverName 声明；
                 闸门插件点名工具（searchTool/saveTool/gatedTools）与声明对齐；
                 预设 file:// 引用的自建包 lib 命中磁盘
  5. Cloak 守卫  scripts/ 与 bobo/ 源码不得出现 camoufox 引用（唯一浏览器是 CloakBrowser）
  6. 插件自检    扫 bobo/plugins/*.mjs 里带 `--selftest` 的插件，逐个看退出码
  7. Python 测试  .venv 的 pytest -q（只断言退出码）

预设/技能/插件清单一律**现场扫磁盘**，新增不必回来改常量。

用法
----
    .venv/Scripts/python.exe scripts/acceptance.py             # 全跑（默认端口 7085）
    .venv/Scripts/python.exe scripts/acceptance.py --keep      # 跑完不关服务（排障）
    .venv/Scripts/python.exe scripts/acceptance.py --port 7086 # 换端口

退出码
------
    0 = 全部通过
    1 = 有断言失败
    2 = 环境不具备（端口被占、node/.venv/内核缺失、服务压根起不来）

约束
----
- 除 PyYAML 外只用标准库；不联网、不装依赖。
- 只收尾**自己 spawn 的**服务进程（Windows 走 taskkill /T，POSIX 走进程组），
  绝不触碰别人已在跑的实例（7075/7099/…）。
- DSH_HOME 显式指向项目内 `.dsh`，与启动脚本一致。
- 会在 `.dsh/sessions` 留下验收会话（与手工验收同一副作用）。
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

try:  # PyYAML：解析 cordis.yml 的 `!!js` 标签（.venv 经 mcp 传递安装）
    import yaml
except ImportError:  # noqa: N813 — 缺失时各 YAML 检查自报红，不影响其余检查
    yaml = None  # type: ignore[assignment]

# ── 常量 ────────────────────────────────────────────────────────────────────

DEFAULT_PORT = 7085
BOOT_TIMEOUT_S = 300
CHECK_TIMEOUT_S = 180

MARK_OK = '✔'
MARK_BAD = '✘'

# 代理池设置命名空间：宿主层单例，全部预设共用（预设行只挂 /proxy 命令）。
PROXY_NAMESPACE = 'proxy-pool'

# 用户级技能源（`.dsh/skills`，启动/加载时被 dsh 自动发现，无需播种）。
USER_SKILLS_DIR = '.dsh/skills'


# ── YAML 宽容解析（cordis.yml 带 `!!js` 标签）────────────────────────────────

_TOLERANT_LOADER: object | None = None


def tolerant_loader():
    """容忍 cordis.yml 的 `!!js` 标签的 SafeLoader。

    `!!js <表达式>` 还原成 `{'!!js': <表达式>}`：值仍逐字可比，
    模板与预设走同一套规则，不会因为「一边解析得了、一边解析不了」而误判。
    """
    if yaml is None:
        raise RuntimeError('PyYAML 不可用（先 uv sync 重建 .venv）')
    global _TOLERANT_LOADER
    if _TOLERANT_LOADER is None:

        class TolerantLoader(yaml.SafeLoader):
            """SafeLoader + `!!js` 标签。"""

        def _js(loader, node):  # noqa: ANN001 — PyYAML 的节点类型不在类型桩里
            if isinstance(node, yaml.ScalarNode):
                return {'!!js': loader.construct_scalar(node)}
            return {'!!js': loader.construct_object(node, deep=True)}

        TolerantLoader.add_constructor('tag:yaml.org,2002:js', _js)
        _TOLERANT_LOADER = TolerantLoader
    return _TOLERANT_LOADER


def load_yaml(text: str):
    """用宽容 loader 解析 YAML 文本。"""
    return yaml.load(text, Loader=tolerant_loader())  # type: ignore[arg-type]


def enable_utf8_output() -> None:
    """Windows 控制台默认 GBK 会把 ✔/✘ 打成乱码；强制 UTF-8。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 — 已经是 UTF-8 / 流不支持就不折腾
            pass


# ── 报告记账 ────────────────────────────────────────────────────────────────


class Report:
    """断言记账：每条断言一行，最后汇总。"""

    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0
        self.failures: list[str] = []

    def section(self, title: str) -> None:
        print()
        print(f'── {title} ──')

    def info(self, text: str) -> None:
        print(f'   {text}')

    def ok(self, name: str, evidence: str = '') -> None:
        self.passed += 1
        print(f'{MARK_OK} {name} — {evidence}' if evidence else f'{MARK_OK} {name}')

    def bad(self, name: str, evidence: str = '', raw: str = '') -> None:
        self.failed += 1
        line = f'{MARK_BAD} {name} — {evidence}' if evidence else f'{MARK_BAD} {name}'
        print(line)
        self.failures.append(line)
        if raw:
            for text in raw.strip().splitlines()[:20]:
                print(f'      | {text}')


# ── 路径定位（全部现场推断，不写死盘符）──────────────────────────────────────


def project_root(explicit: str) -> Path:
    """项目根：`--root` > 环境变量 BOBO_ROOT > 脚本所在目录的上一级。"""
    if explicit:
        return Path(explicit).resolve()
    env = os.environ.get('BOBO_ROOT', '').strip()
    if env and (Path(env) / 'dbx-runtime').is_dir():
        return Path(env).resolve()
    return Path(__file__).resolve().parent.parent


def venv_python(root: Path) -> Path:
    return root / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def kernel_bin() -> Path | None:
    """打包内核入口：环境变量 DSH_KERNEL > 桌面应用的默认下载位置。"""
    override = os.environ.get('DSH_KERNEL', '').strip()
    if override and Path(override).is_file():
        return Path(override)
    candidates = []
    appdata = os.environ.get('APPDATA', '')
    if appdata:
        candidates.append(Path(appdata) / 'dsh-tauri/dependencies/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')
    candidates.append(Path.home() / '.local/share/dsh-tauri/dependencies/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')
    for cand in candidates:
        if cand.is_file():
            return cand
    return None


def patch_file(root: Path) -> Path:
    return root / '.dsh' / 'profiles' / 'web' / 'cordis.patch.yml'


def presets_root(root: Path) -> Path:
    """市场安装的预设根（preset-includes 扫描 decl.yml 的地方）。"""
    return root / '.dsh' / '.agent-presets'


def plugins_dir(root: Path) -> Path:
    return root / 'bobo' / 'plugins'


def user_skills_dir(root: Path) -> Path:
    return root / USER_SKILLS_DIR


# ── 现场发现（新增预设/技能/插件不必回来改常量）─────────────────────────────


def discover_presets(root: Path) -> dict[str, Path]:
    """{预设 id: 目录}：`.dsh/.agent-presets` 下带 agent.cordis.yml 的目录。"""
    found: dict[str, Path] = {}
    base = presets_root(root)
    if not base.is_dir():
        return found
    for child in sorted(base.iterdir()):
        if child.is_dir() and (child / 'agent.cordis.yml').is_file():
            found[child.name] = child
    return found


def discover_user_skills(root: Path) -> list[str]:
    """用户级技能名（`.dsh/skills/<name>/SKILL.md`）。"""
    base = user_skills_dir(root)
    if not base.is_dir():
        return []
    return sorted(
        child.name for child in base.iterdir()
        if child.is_dir() and (child / 'SKILL.md').is_file()
    )


def discover_selftest_plugins(root: Path) -> list[str]:
    """带 `--selftest` 处理的本地插件名（扫到即跑，不维护清单）。"""
    found: list[str] = []
    base = plugins_dir(root)
    if not base.is_dir():
        return found
    for path in sorted(base.glob('*.mjs')):
        try:
            if '--selftest' in path.read_text(encoding='utf-8', errors='replace'):
                found.append(path.stem)
        except OSError:
            continue
    return found


# ── 前置条件（不满足即退出码 2）─────────────────────────────────────────────


def port_is_free(port: int) -> bool:
    sock = socket.socket()
    try:
        sock.bind(('127.0.0.1', port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def preflight(root: Path, port: int) -> list[str]:
    """检查运行前置条件，返回问题描述列表；全过返回空列表。"""
    problems: list[str] = []
    kernel = kernel_bin()
    if kernel is None:
        problems.append('打包内核缺失（先跑一次 Deepseek Harness Desktop，或设 DSH_KERNEL）')
    required = {
        'host 覆盖层': patch_file(root),
        '预设根': presets_root(root),
        '插件目录': plugins_dir(root),
        '用户级技能源': user_skills_dir(root),
        '虚拟环境解释器': venv_python(root),
        '采集引擎 run_cloak.py': root / 'scripts' / 'run_cloak.py',
        '浏览器服务 browser_server.py': root / 'scripts' / 'browser_server.py',
        'tool-acquisition 产物': root / 'bobo' / 'tool-acquisition' / 'lib' / 'index.js',
    }
    for label, path in required.items():
        if not path.exists():
            problems.append(f'缺少 {label}: {path}')
    try:
        subprocess.run(['node', '--version'], capture_output=True, timeout=30, check=True)
    except Exception as exc:  # noqa: BLE001
        problems.append(f'node 不可用: {exc}')
    if yaml is None:
        problems.append('PyYAML 不可用（.venv 缺依赖？先 uv sync）')
    if not port_is_free(port):
        problems.append(f'端口 {port} 已被占用（换 --port，或关掉那个实例）')
    return problems


# ── 自己 spawn 的 web 服务 ──────────────────────────────────────────────────


class WebService:
    """自己起、自己收的 `dsh web`（打包内核）进程：日志缓冲、token 抓取、只关自己的树。"""

    URL_RE = re.compile(r'dsh web:\s+(http://\S+)')
    TAIL_LINES = 200

    def __init__(self, root: Path, port: int) -> None:
        self.root = root
        self.port = port
        self.proc: subprocess.Popen[str] | None = None
        self.launch_url = ''
        self.cookie = ''
        self._lines: list[str] = []
        self._lock = threading.Lock()

    def _env(self) -> dict[str, str]:
        """与 启动.cmd 一致的四个变量；DSH_HOME 显式指向项目内 .dsh。"""
        return {
            **os.environ,
            'BOBO_ROOT': str(self.root),
            'BOBO_DSH_ROOT': str(self.root / 'dsh'),
            'DSH_HOME': str(self.root / '.dsh'),
        }

    def _pump(self, stream) -> None:
        for line in stream:
            with self._lock:
                self._lines.append(line.rstrip('\n'))
                if len(self._lines) > self.TAIL_LINES:
                    del self._lines[:len(self._lines) - self.TAIL_LINES]

    def start(self) -> tuple[bool, str]:
        kernel = kernel_bin()
        if kernel is None:
            return False, '打包内核缺失'
        args = [
            'node', str(kernel), '--profile', 'web',
            '--port', str(self.port), '--no-open',
        ]
        kwargs: dict = {}
        if os.name != 'nt':
            kwargs['start_new_session'] = True
        self.proc = subprocess.Popen(  # noqa: S603 — 参数全部来自本脚本常量/推断
            args, cwd=str(self.root), env=self._env(),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            encoding='utf-8', errors='replace', bufsize=1, text=True, **kwargs,
        )
        threading.Thread(target=self._pump, args=(self.proc.stdout,), daemon=True).start()

        deadline = time.time() + BOOT_TIMEOUT_S
        while time.time() < deadline:
            with self._lock:
                blob = '\n'.join(self._lines)
            match = self.URL_RE.search(blob)
            if match is not None:
                self.launch_url = match.group(1)
                return True, ''
            if self.proc.poll() is not None:
                return False, f'进程提前退出（exit={self.proc.returncode}）'
            time.sleep(0.5)
        return False, f'{BOOT_TIMEOUT_S}s 内没有出现就绪 URL'

    def log_tail(self, lines: int = 40) -> str:
        with self._lock:
            return '\n'.join(self._lines[-lines:])

    def log_contains(self, needle: str) -> bool:
        with self._lock:
            return any(needle in line for line in self._lines)

    def token(self) -> str:
        return parse_qs(urlsplit(self.launch_url).query).get('token', [''])[0]

    def redacted_url(self) -> str:
        token = self.token()
        return self.launch_url.replace(token, '***') if token else self.launch_url

    def exchange_token(self) -> tuple[bool, str]:
        """走一次 token 换 cookie（GET /?token=… 期望 303 + Set-Cookie）。"""
        parts = urlsplit(self.launch_url)
        conn = http.client.HTTPConnection(parts.hostname or '127.0.0.1', self.port, timeout=30)
        try:
            conn.request('GET', f'{parts.path}?{parts.query}')
            resp = conn.getresponse()
            resp.read()
            status = resp.status
            set_cookie = resp.getheader('Set-Cookie') or ''
        except OSError as exc:
            return False, f'{type(exc).__name__}: {exc}'
        finally:
            conn.close()
        if status != 303 or not set_cookie:
            return False, f'status={status} set-cookie={"有" if set_cookie else "无"}'
        self.cookie = set_cookie.split(';', 1)[0]
        return True, f'status={status}'

    def stop(self) -> str:
        if self.proc is None or self.proc.poll() is not None:
            return '无需关闭（进程已退出）'
        pid = self.proc.pid
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True, check=False)
        else:
            try:
                os.killpg(os.getpgid(pid), 15)
            except OSError:
                self.proc.terminate()
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        return f'已关闭 pid={pid}'


# ── Remote 调用 ─────────────────────────────────────────────────────────────


def post_api(port: int, cookie: str, method: str, args: dict, rpc_id: str) -> tuple[int, dict | None, str]:
    payload = json.dumps(
        {'type': 'client-request', 'rpcId': rpc_id, 'method': method, 'payload': {'args': args}},
        ensure_ascii=False,
    ).encode('utf-8')
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=CHECK_TIMEOUT_S)
    try:
        conn.request('POST', f'/api/{method}', body=payload, headers={
            'Content-Type': 'application/json',
            'Content-Length': str(len(payload)),
            'Cookie': cookie,
        })
        resp = conn.getresponse()
        raw = resp.read().decode('utf-8', 'replace')
        status = resp.status
    except OSError as exc:
        return 0, None, f'{type(exc).__name__}: {exc}'
    finally:
        conn.close()
    try:
        result = json.loads(raw).get('result')
    except ValueError:
        result = None
    return status, result, raw


def remote_error(result: dict | None) -> str:
    if not isinstance(result, dict):
        return '响应不是合法 JSON 信封'
    error = result.get('error')
    if isinstance(error, dict):
        return f'{error.get("code", "?")}: {error.get("message", "")}'
    return json.dumps(result, ensure_ascii=False)


def create_session(port: int, cookie: str, preset: str, cwd: Path) -> tuple[bool, str, str]:
    status, result, raw = post_api(
        port, cookie, 'session/create',
        {'request': {'agentPreset': preset, 'cwd': str(cwd)}},
        f'acceptance-create-{preset}',
    )
    if status != 200 or not isinstance(result, dict) or result.get('ok') is not True:
        return False, f'HTTP {status}：{remote_error(result)}', raw
    value = result.get('value') or {}
    return True, str(value.get('sessionId', '')), raw


# ── 检查 1-3：需要活服务的检查 ──────────────────────────────────────────────

FILE_URL_RE = re.compile(r"""name:\s*['"](file://[^'"]+)['"]""")


def file_url_to_path(url: str) -> Path:
    """`file:///E:/x/y.js` → Path（Windows 盘符前的斜杠去掉）。"""
    raw = url[len('file://'):]
    if re.match(r'^/[A-Za-z]:', raw):
        raw = raw[1:]
    return Path(raw)


def check_preset_mount(port: int, cookie: str, root: Path, rep: Report) -> dict[str, str]:
    """结构校验后逐个预设建会话；返回 {预设 id: sessionId}（成功的才有）。"""
    rep.section('2. 预设挂载（结构校验 + POST /api/session/create）')
    presets = discover_presets(root)
    if not presets:
        rep.bad('预设可发现', f'{presets_root(root)} 下没有带 agent.cordis.yml 的目录')
        return {}

    problems: list[str] = []
    for pid, pdir in presets.items():
        for fname in ('agent.cordis.yml', 'decl.yml'):
            f = pdir / fname
            if not f.is_file():
                problems.append(f'{pid}: 缺 {fname}')
                continue
            try:
                data = load_yaml(f.read_text(encoding='utf-8'))
            except Exception as exc:  # noqa: BLE001
                problems.append(f'{pid}/{fname}: YAML 解析失败（{exc}）')
                continue
            if not isinstance(data, list):
                problems.append(f'{pid}/{fname}: 顶层不是数组')
            if fname == 'agent.cordis.yml':
                for match in FILE_URL_RE.finditer(f.read_text(encoding='utf-8', errors='replace')):
                    target = file_url_to_path(match.group(1))
                    if not target.is_file():
                        problems.append(f'{pid}/{fname}: 引用 {match.group(1)} —— {target} 不存在（包没构建？）')
    if problems:
        rep.bad('预设结构可解析', f'{len(problems)} 处结构问题', '\n'.join(problems))
    else:
        rep.ok('预设结构可解析',
               f'{len(presets)} 个预设的 agent.cordis.yml / decl.yml 全部可解析，'
               f'file:// 引用全部命中磁盘：{" ".join(sorted(presets))}')

    sessions: dict[str, str] = {}
    for preset in sorted(presets):
        ok, info, raw = create_session(port, cookie, preset, root)
        if ok:
            sessions[preset] = info
            rep.ok(f'预设挂载 {preset}', f'sessionId={info}')
        else:
            rep.bad(f'预设挂载 {preset}', info, raw)
    return sessions


def check_skills_and_namespace(port: int, cookie: str, root: Path,
                               sessions: dict[str, str], rep: Report) -> None:
    """每个预设会话列技能（用户级技能应可见）+ 断言 proxy-pool 命名空间已注册。"""
    rep.section('3. 技能发现（skills/list）与设置命名空间（settings/describe）')
    skills = discover_user_skills(root)
    rep.info(f'用户级技能源 {USER_SKILLS_DIR}：{skills or "(空)"}')
    if not skills:
        rep.bad('用户级技能源', f'{user_skills_dir(root)} 下没有带 SKILL.md 的技能目录')

    for preset in sorted(discover_presets(root)):
        session_id = sessions.get(preset, '')
        if not session_id:
            rep.bad(f'技能发现 {preset}', '没有可用会话（该预设建会话已失败）')
            continue
        status, result, raw = post_api(
            port, cookie, 'skills/list', {'request': {'sessionId': session_id}},
            f'acceptance-skills-{preset}',
        )
        if status != 200 or not isinstance(result, dict) or result.get('ok') is not True:
            rep.bad(f'技能发现 {preset}', f'HTTP {status}：{remote_error(result)}', raw)
            continue
        names = {item.get('name', '') for item in ((result.get('value') or {}).get('skills') or [])}
        missing = [name for name in skills if name not in names]
        if missing:
            rep.bad(f'技能发现 {preset}', f'共 {len(names)} 个技能，缺用户级 {missing}', raw)
        else:
            rep.ok(f'技能发现 {preset}', f'共 {len(names)} 个技能，用户级 {len(skills)} 个全在')

    status, result, raw = post_api(port, cookie, 'settings/describe', {}, 'acceptance-settings-describe')
    if status != 200 or not isinstance(result, dict) or result.get('ok') is not True:
        rep.bad('代理池命名空间已注册', f'HTTP {status}：{remote_error(result)}', raw)
        return
    names = [str(item.get('ns', '')) for item in ((result.get('value') or {}).get('namespaces') or [])]
    if PROXY_NAMESPACE in names:
        rep.ok('代理池命名空间已注册',
               f'settings/describe 共 {len(names)} 个命名空间，含 {PROXY_NAMESPACE}'
               f'（宿主层单例，{len(discover_presets(root))} 个预设共用）')
    else:
        rep.bad('代理池命名空间已注册', f'共 {len(names)} 个命名空间，没有 {PROXY_NAMESPACE}：{names}', raw)


# ── 检查 4：装配一致性（静态，不调模型）─────────────────────────────────────

MCP_REF_RE = re.compile(r'mcp__([A-Za-z0-9][A-Za-z0-9._-]*)__')
SERVER_NAME_RE = re.compile(r'\bserverName\s*:\s*[\'"]?([A-Za-z0-9][A-Za-z0-9._-]*)')
SERVER_NAME_KEY_RE = re.compile(r'[A-Za-z_][\w-]*[Ss]erverName\s*:\s*[\'"]?([A-Za-z0-9][A-Za-z0-9._-]*)')
# 闸门/公共插件 config 里点名工具的键（值形如 mcp__x__y）。
TOOL_KEYS = ('searchTool', 'saveTool', 'feedbackTool', 'reverseSearchTool')


def strip_yaml_comment(line: str) -> str:
    if line.lstrip().startswith('#'):
        return ''
    for marker in (' #', '\t#'):
        idx = line.find(marker)
        if idx != -1:
            return line[:idx]
    return line


def scan_mcp_refs(path: Path, is_yaml: bool) -> list[tuple[int, str, str]]:
    try:
        text = path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return []
    refs: list[tuple[int, str, str]] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        visible = strip_yaml_comment(line) if is_yaml else line
        for match in MCP_REF_RE.finditer(visible):
            refs.append((lineno, match.group(1), match.group(0)))
    return refs


def iter_files(base: Path, suffixes: tuple[str, ...]):
    for path in sorted(base.rglob('*')):
        if path.is_file() and path.suffix.lower() in suffixes:
            yield path


def check_tool_names(root: Path, rep: Report) -> None:
    """静态交叉核对工具名与 serverName 声明。"""
    rep.section('4. 装配一致性（静态交叉核对，不调模型）')
    presets = discover_presets(root)
    host_servers = set(SERVER_NAME_RE.findall(patch_file(root).read_text(encoding='utf-8', errors='replace')))
    preset_servers = {
        pid: set(SERVER_NAME_RE.findall((pdir / 'agent.cordis.yml').read_text(encoding='utf-8', errors='replace')))
        for pid, pdir in presets.items()
    }
    all_servers = host_servers | {name for names in preset_servers.values() for name in names}
    rep.info(f'宿主层 serverName：{sorted(host_servers)}')

    # 4a：预设内引用必须在「本预设 + 宿主层」里有归属。
    dangling: list[str] = []
    total_refs = 0
    for pid, pdir in presets.items():
        available = host_servers | preset_servers[pid]
        for path in iter_files(pdir, ('.yml', '.yaml', '.md')):
            for lineno, server_name, tool in scan_mcp_refs(path, path.suffix.lower() != '.md'):
                total_refs += 1
                if server_name not in available:
                    dangling.append(
                        f'{path.relative_to(root)}:{lineno} 引用 {tool} —— '
                        f'serverName "{server_name}" 既不在本预设也不在宿主层 cordis.patch.yml',
                    )
    if dangling:
        rep.bad('预设内工具名前缀都有 serverName 声明', f'{len(dangling)}/{total_refs} 处悬空引用', '\n'.join(dangling))
    else:
        rep.ok('预设内工具名前缀都有 serverName 声明', f'{len(presets)} 个预设共 {total_refs} 处引用全部有归属')

    # 4b：插件文案里的引用必须能在某个配置里找到归属。
    configured = set()
    for pdir in presets.values():
        for path in iter_files(pdir, ('.yml', '.yaml')):
            configured |= set(SERVER_NAME_KEY_RE.findall(path.read_text(encoding='utf-8', errors='replace')))
    configured |= set(SERVER_NAME_KEY_RE.findall(patch_file(root).read_text(encoding='utf-8', errors='replace')))
    # 插件自身也是 *ServerName 键的出处（自检用例会用合成值如 pdf-extract-crawl）。
    for path in sorted(plugins_dir(root).glob('*.mjs')):
        configured |= set(SERVER_NAME_KEY_RE.findall(path.read_text(encoding='utf-8', errors='replace')))
    plugin_dangling: list[str] = []
    plugin_refs = 0
    for path in sorted(plugins_dir(root).glob('*.mjs')):
        for lineno, server_name, tool in scan_mcp_refs(path, False):
            plugin_refs += 1
            if server_name not in all_servers and server_name not in configured:
                plugin_dangling.append(f'{path.relative_to(root)}:{lineno} 引用 {tool} —— "{server_name}" 无任何声明')
    if plugin_dangling:
        rep.bad('插件文案里的工具名都有出处', f'{len(plugin_dangling)}/{plugin_refs} 处悬空引用', '\n'.join(plugin_dangling))
    else:
        rep.ok('插件文案里的工具名都有出处', f'{plugin_refs} 处引用均能在宿主层/预设/serverName 配置里找到')

    # 4c：闸门 config 点名的工具前缀必须有 serverName 声明。
    gate_bad: list[str] = []
    gate_total = 0
    for source, text in [(patch_file(root), patch_file(root).read_text(encoding='utf-8', errors='replace'))] + [
        (pdir / 'agent.cordis.yml', (pdir / 'agent.cordis.yml').read_text(encoding='utf-8', errors='replace'))
        for pdir in presets.values()
    ]:
        for key in TOOL_KEYS:
            for match in re.finditer(rf'{key}:\s*[\'"]?(mcp__([A-Za-z0-9][A-Za-z0-9._-]*)__[A-Za-z0-9_*-]+)', text):
                gate_total += 1
                if match.group(2) not in all_servers:
                    gate_bad.append(f'{source.relative_to(root)}: {key} 点名 {match.group(1)} —— serverName "{match.group(2)}" 无声明')
    for key in ('gatedTools', 'closeTools', 'depositTools'):
        for source, text in [(patch_file(root), patch_file(root).read_text(encoding='utf-8', errors='replace'))] + [
            (pdir / 'agent.cordis.yml', (pdir / 'agent.cordis.yml').read_text(encoding='utf-8', errors='replace'))
            for pdir in presets.values()
        ]:
            for match in re.finditer(rf'{key}:\s*\[([^\]]*)\]', text):
                for tool_match in MCP_REF_RE.finditer(match.group(1)):
                    gate_total += 1
                    if tool_match.group(1) not in all_servers:
                        gate_bad.append(f'{source.relative_to(root)}: {key} 点名 {tool_match.group(0)} —— serverName "{tool_match.group(1)}" 无声明')
    if gate_bad:
        rep.bad('闸门点名工具都有 serverName 声明', f'{len(gate_bad)}/{gate_total} 处不一致', '\n'.join(gate_bad))
    else:
        rep.ok('闸门点名工具都有 serverName 声明', f'{gate_total} 处点名全部对得上声明')

    # 4d：采集引擎脚本名一致性（crawl-tool.ts 指向的脚本必须在磁盘上）。
    crawl_tool = root / 'bobo' / 'tool-acquisition' / 'lib' / 'index.js'
    if crawl_tool.is_file():
        blob = crawl_tool.read_text(encoding='utf-8', errors='replace')
        engine = re.search(r'CRAWL_ENGINE_SCRIPT\s*=\s*["\']([^"\']+)["\']', blob)
        if engine:
            target = root / 'scripts' / engine.group(1)
            if target.is_file():
                rep.ok('采集引擎脚本存在', f'crawl-tool 指向 scripts/{engine.group(1)}')
            else:
                rep.bad('采集引擎脚本存在', f'crawl-tool 指向 scripts/{engine.group(1)} —— 文件不存在')
        else:
            rep.bad('采集引擎脚本存在', 'lib/index.js 里没扫到 CRAWL_ENGINE_SCRIPT 常量（产物过期？）')
    else:
        rep.bad('采集引擎脚本存在', f'{crawl_tool} 不存在')


# ── 检查 5：Cloak 守卫（唯一浏览器）─────────────────────────────────────────

# 允许出现 camoufox 的白名单：迁移叙事文档与本守卫自身的说明。
CAMOUFOX_ALLOW = (
    'scripts/acceptance.py',  # 本文件（守卫定义处）
)

# 判红范围：Python/TS/MJS 源码里的**活引用**（注释里的历史性提及也判红——
# 提示词与文案会把它们带进模型上下文，见 R3/R4 的清理动机）。
CAMOUFOX_SCAN_SUFFIXES = ('.py', '.ts', '.tsx', '.mjs', '.js')


def check_cloak_guard(root: Path, rep: Report) -> None:
    """scripts/ 与 bobo/ 源码不得出现 camoufox（唯一浏览器引擎是 CloakBrowser）。"""
    rep.section('5. Cloak 守卫（scripts/ 与 bobo/ 源码零 camoufox 引用）')
    violations: list[str] = []
    scanned = 0
    for base in (root / 'scripts', root / 'bobo'):
        if not base.is_dir():
            continue
        for path in sorted(base.rglob('*')):
            if not path.is_file() or path.suffix.lower() not in CAMOUFOX_SCAN_SUFFIXES:
                continue
            rel = str(path.relative_to(root)).replace('\\', '/')
            if rel in CAMOUFOX_ALLOW or '/node_modules/' in rel or '/lib/' in rel or '/lib\\' in rel:
                continue
            scanned += 1
            try:
                text = path.read_text(encoding='utf-8', errors='replace')
            except OSError:
                continue
            for lineno, line in enumerate(text.splitlines(), 1):
                if 'camoufox' in line.lower():
                    violations.append(f'{rel}:{lineno}: {line.strip()[:120]}')
    if violations:
        rep.bad('scripts/ 与 bobo/ 源码零 camoufox 引用',
                f'{len(violations)} 处残留（唯一浏览器引擎是 CloakBrowser）', '\n'.join(violations))
    else:
        rep.ok('scripts/ 与 bobo/ 源码零 camoufox 引用', f'扫了 {scanned} 个源码文件')


# ── 检查 6/7：插件自检 + Python 测试 ────────────────────────────────────────


def run_command(args: list[str], cwd: Path, timeout: int) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            args, cwd=str(cwd), capture_output=True, timeout=timeout,
            encoding='utf-8', errors='replace',
        )
    except FileNotFoundError as exc:
        return 127, f'{args[0]} 不可用: {exc}'
    except subprocess.TimeoutExpired:
        return 124, f'{timeout}s 超时未结束: {" ".join(args)}'
    return proc.returncode, (proc.stdout or '') + (proc.stderr or '')


def check_plugin_selftests(root: Path, rep: Report) -> None:
    rep.section('6. 插件自检（node bobo/plugins/<插件>.mjs --selftest）')
    plugins = discover_selftest_plugins(root)
    if not plugins:
        rep.bad('插件自检', f'{plugins_dir(root)} 下没扫到带 --selftest 的插件')
        return
    for plugin in plugins:
        path = plugins_dir(root) / f'{plugin}.mjs'
        code, output = run_command(['node', str(path), '--selftest'], root, CHECK_TIMEOUT_S)
        lines = [line.strip() for line in output.strip().splitlines() if line.strip()]
        verdict = [line for line in lines if 'selftest' in line.lower() or '通过' in line or 'PASS' in line or 'FAIL' in line or 'ok' in line.lower()]
        evidence = verdict[-1] if verdict else (lines[-1] if lines else '(无输出)')
        if code == 0:
            rep.ok(f'插件自检 {plugin}', evidence)
        else:
            rep.bad(f'插件自检 {plugin}', f'exit={code}；{evidence}', output)


def check_python_tests(root: Path, rep: Report) -> None:
    rep.section('7. Python 测试（pytest -q）')
    python_bin = venv_python(root)
    code, output = run_command([str(python_bin), '-m', 'pytest', '-q'], root, 900)
    summary = [line for line in output.strip().splitlines() if line.strip()]
    evidence = summary[-1] if summary else '(无输出)'
    if code == 0:
        rep.ok('pytest 全绿', evidence)
    else:
        rep.bad('pytest 全绿', f'exit={code}；{evidence}', '\n'.join(summary[-30:]))


# ── 主流程 ──────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='SmartBoBo 装配层端到端验收（预设挂载 / 技能发现 / 装配一致性 / Cloak 守卫）。',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--port', type=int, default=DEFAULT_PORT,
                        help=f'验收实例的端口（默认 {DEFAULT_PORT}，避开 7075 上的常驻实例）')
    parser.add_argument('--keep', action='store_true', help='跑完不关闭自己起的那台服务（排障用）')
    parser.add_argument('--root', default='', help='项目根目录（缺省按 BOBO_ROOT 或脚本位置推断）')
    parser.add_argument('--skip-live', action='store_true',
                        help='跳过需要活服务的检查 1-3（只跑静态检查 4-7）')
    args = parser.parse_args(argv)

    enable_utf8_output()
    root = project_root(args.root)
    rep = Report()
    print(f'SmartBoBo 装配层验收 — root={root} port={args.port}')

    rep.section('0. 环境前置')
    problems = preflight(root, args.port)
    if problems:
        for problem in problems:
            rep.bad('环境前置', problem)
        print(f'\n汇总：通过 {rep.passed} / 失败 {rep.failed}（环境不具备，退出码 2）')
        return 2
    kernel = kernel_bin()
    rep.ok('环境前置', f'node / 内核（{kernel.name if kernel else "?"}）/ 预设根 / 插件目录 / 技能源 / .venv / 端口均就绪')

    if not args.skip_live:
        web = WebService(root, args.port)
        rep.section('1. 启动（打包内核 dsh web --profile web）')
        ready, why = web.start()
        if not ready:
            rep.bad('启动 dsh web', why, web.log_tail())
            web.stop()
            dependency_missing = web.log_contains('MODULE_NOT_FOUND') or web.log_contains('ERR_MODULE_NOT_FOUND')
            note = '依赖缺失（环境不具备）' if dependency_missing else '服务起不来'
            print(f'\n汇总：通过 {rep.passed} / 失败 {rep.failed}（{note}）')
            return 2 if dependency_missing else 1
        rep.ok('启动 dsh web', f'{web.redacted_url()} pid={web.proc.pid if web.proc else "?"}')

        exchanged, detail = web.exchange_token()
        if exchanged:
            rep.ok('token 换 cookie', detail)
        else:
            rep.bad('token 换 cookie', detail, web.log_tail())
            if not args.keep:
                rep.info(web.stop())
            print(f'\n汇总：通过 {rep.passed} / 失败 {rep.failed}')
            return 1

        sessions = check_preset_mount(args.port, web.cookie, root, rep)
        check_skills_and_namespace(args.port, web.cookie, root, sessions, rep)

        if args.keep:
            rep.info(f'--keep：服务保留在 {web.launch_url}（pid={web.proc.pid if web.proc else "?"}）')
        else:
            rep.info(web.stop())

    check_tool_names(root, rep)
    check_cloak_guard(root, rep)
    check_plugin_selftests(root, rep)
    check_python_tests(root, rep)

    rep.section('汇总')
    print(f'通过 {rep.passed} / 失败 {rep.failed}')
    if rep.failures:
        print('失败项：')
        for line in rep.failures:
            print(f'  {line}')
    return 1 if rep.failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
