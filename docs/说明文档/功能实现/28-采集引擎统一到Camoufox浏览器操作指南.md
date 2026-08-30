# 28 - 采集引擎统一到 Camoufox 浏览器操作指南

> 适用范围：本指南说明把项目采集引擎（camoufox / scrapling / crawl4ai）的浏览器统一收敛到
> 内置的 **Camoufox**（抗检测 Firefox 内核），并把三家的输出统一到 html / md / 网页骨架（skeleton）
> 三种格式，同时让浏览器在会话内常驻复用、代理由浏览器统一承载。
>
> 本指南对应一次已完成代码改造，可用作后续维护与排查的参考。

---

## 1. 背景与要解决的问题

改造前，`dsh` 的采集工具 `crawl_fetch` 每次都会 spawn 一个 `scripts/run_<engine>.py` 子进程，
而三个引擎各自拉起**不同的浏览器**：

| 引擎脚本 | 改造前浏览器 | 问题 |
| --- | --- | --- |
| `run_camoufox.py`（默认） | Camoufox（抗检测 Firefox） | 已正确 |
| `run_crawl4ai.py` | Playwright **Chromium** | 未用 camoufox |
| `run_scrapling.py` | patchright（打补丁 Playwright）+ **Chromium** | 未用 camoufox |

带来几个问题：

- 浏览器指纹不统一（Chromium vs Firefox），同一会话内不同引擎抓同一站点结果可能不一致。
- 每次采集都新建进程 + 新浏览器，进程结束浏览器即销毁，**无法会话内复用**，Cookie/会话状态不延续。
- Scrapling 的 `StealthyFetcher` 根本不透传代理（旧代码注释已注明），代理只对 camoufox 生效。
- 三家对 `--selector` 的切片实现各不相同（浏览器 locator / `page.css` / 无），行为不一致。

---

## 2. 目标与确认的决策

本次改造基于以下确认的决策落地：

1. **三引擎全部统一用内置 camoufox**；收敛后 `engine` 仅作为“解析/输出方式”选项保留。
2. **Md 输出三引擎统一**：删除 Crawl4AI 独家的 `result.markdown` 分支，全部走
   `crawl_common.html_to_format(..., 'md')`（html2text + lxml 兜底）。
3. **输出统一为完整文档**：html 格式输出含 `<!DOCTYPE html>/<html>/<body>` 的完整渲染文档。
4. **浏览器长驻复用**：会话内常驻一个 camoufox 实例，多次采集排队复用同一个 browser context，
   直到智能体/会话结束才关闭。
5. **代理统一由 camoufox 实例承载**：在浏览器服务启动时注入一次（复用既有代理池逻辑）。
6. **补全 Crawl4AI 的 `--selector` 支持**：用 lxml 在渲染后 HTML 上切片（低复杂度路径）。
7. **降级策略**：渲染超时/失败也拿当前 `content()` 兜底，三个引擎行为一致。

---

## 3. 最终架构

采用**形状 A**：一个长驻“浏览器服务进程” + 三个瘦客户端脚本。

```
┌─────────────────────────── dsh（tool-acquisition 插件）──────────────────────────┐
│   会话开始/首次采集时，spawn 常驻 scripts/browser_server.py（持有 1 个 camoufox）    │
│   ctx.effect(() => killServer)：会话/插件 teardown 时进程树方式关闭浏览器           │
│   服务不可达时自动重启并重试一次                                                   │
└───────────────┬──────────────────────────────────────────┬───────────────────────┘
                │ 代理(proxy_pool)在服务启动注入一次          │ spawn run_<engine>.py
                ▼                                           ▼
       browser_server.py (loopback TCP)          run_camoufox / run_crawl4ai / run_scrapling
       一行 JSON 指令 → 渲染完整文档 → 一行 JSON   （瘦客户端）──► crawl_common 统一：
                                                 selector 切片(lxml) + html/md/skeleton + 落盘
```

### 数据流

1. 智能体调用 `crawl_fetch(url, engine, outputFormat, selector, ...)`。
2. 插件确保长驻浏览器服务在跑（未起则拉起，读取首行 `READY <端口>`）；若会话启用代理，先从
   代理池取一个代理并在服务启动时注入。
3. 插件以 `--server 127.0.0.1:<端口>` 调用 `run_<engine>.py`。
4. 客户端脚本（均为瘦客户端，不再自己拉起浏览器）向服务请求“渲染该 URL”，拿到**渲染后的完整文档**。
5. 客户端在 `crawl_common` 里统一做：`--selector` 切片（lxml+cssselect）→ 按 `--format`
   派生 html/md/skeleton → 落盘 → 只打一行单行 JSON 到 stdout。
6. 插件解析 JSON，返回 `{ savedTo, status, contentPreview, format, outputs }` 给智能体。

服务端一次只处理一个请求（串行），天然实现“排队复用同一个 browser context”。

---

## 4. 改动文件清单

### 新增
- `scripts/browser_server.py` —— 长驻 Camoufox 浏览器服务。
  - `AsyncCamoufox(headless=True, persistent_context=True, user_data_dir=..., proxy=...)` 持有常驻
    BrowserContext；`--profile-dir` 指定时，自动重启后仍保留 Cookie（会话状态）。
  - 回环 TCP（`127.0.0.1`），每连接读一行 JSON 指令 → 渲染 → 回一行 JSON 应答后关闭。
  - 渲染逻辑沿用旧 `run_camoufox.py`：DOMContentLoaded、点掉常见 Cookie 弹窗、等待 JS、滚动懒加载、
    超时拿 `content()` 兜底。
  - 首行 stdout 输出 `READY <端口>`；随后常驻运行直到被进程终止（**不把 stdin EOF 当关闭信号**，
    避免后台无注入 stdin 时误退出）。

### 修改
- `scripts/crawl_common.py` —— 新增共享客户端核：
  - `crawl_via_server()`：TCP 请求服务渲染，返回 `{status,title,html,partial,error}`；服务不可达抛
    `ServerUnreachable`。
  - `narrow_by_selector()`：lxml+cssselect 在渲染后 HTML 上切片（cssselect 不可用时的简易回退
    `tag#id.cls`）；三引擎统一切片入口。
  - `extract_preview_text()` / `build_crawl_result()`：统一预览与“切片→多格式派生→落盘→组装回传 JSON”。
  - 供三个脚本共用的渲染默认参数常量。
- `scripts/run_camoufox.py` / `run_crawl4ai.py` / `run_scrapling.py` —— 全部改为瘦客户端：
  - 不再各自拉起浏览器；删除 Crawl4AI 的 markdown 分支；补全 Crawl4AI 的 `--selector`。
  - 通过 `--server` 连常驻服务取完整文档，再调 `build_crawl_result` 输出三种格式。
  - 服务不可达时打 JSON 并 `exit(2)`（区别于“渲染成功但有页面错误”）。
- `dsh/packages/acquisition/tool-acquisition/src/index.ts` —— 插件侧：
  - 新增长驻服务生命周期管理：`ensureServer()`（惰性拉起 + READY 解析）、`killServer()`、
    `ctx.effect(() => killServer)`（会话/插件 teardown 关闭浏览器，Windows 用 `taskkill /T` 递归清理
    firefox 子进程）。
  - 代理改为在服务启动时注入一次（复用现有 `proxy_pool.py` 的 `get`），不再按次采集传 `--proxy`。
  - 客户端脚本统一追加 `--server`；服务不可达（退出码 2）时自动重启服务并重试一次。

---

## 5. 三种输出格式如何适配

html / md / skeleton 本质是同一份“渲染后完整文档”（`page.content()`）的派生物，全部在
`crawl_common` 统一转换，不因引擎而异：

| 格式 | 扩展名 | 来源 |
| --- | --- | --- |
| `html` | `.html` | 渲染后完整文档（含 doctype），`--selector` 指定则退化为命中子树的 HTML |
| `md`（默认） | `.md` | html2text 转换 + lxml 正文回退（`html_to_format(..., 'md')`）；三引擎一致 |
| `skeleton` | `.skeleton.txt` | `skeleton_gen.html_to_skeleton`：`CSS路径 -> 合并文本` 块级骨架 |

- 因浏览器统一为 camoufox（真实渲染），JS 注入的内容也会进入 md/skeleton，输出比以往更完整。
- 一次抓取可产出多格式：`--format html,md,skeleton`。
- `--selector` 命中时，md/skeleton/html 都只基于该子树（服务端仍返回整页，由客户端统一切片）。

---

## 6. 验证步骤

### Python 侧（无需 dsh）
```bash
# 1) 后台启动长驻浏览器服务（首次会启动 camoufox，较慢）
./.venv/Scripts/python.exe scripts/browser_server.py --profile-dir /tmp/bobo_profile \
      > /tmp/bobosrv.out 2>&1 &
sleep 8
cat /tmp/bobosrv.out        # 应看到: READY <端口>

# 2) 三个引擎各产三格式（<端口> 替换为上行 READY 的值）
S=127.0.0.1:<端口>
for eng in camoufox crawl4ai scrapling; do
  ./.venv/Scripts/python.exe scripts/run_$eng.py \
      --url https://example.com \
      --out /tmp/o_$eng --format html,md,skeleton --server $S
  echo "exit=$?"
done
# 期望：status=200，exit=0，/tmp/o_*.html/.md/.skeleton.txt 均生成；html 以 <!DOCTYPE html> 开头

# 3) selector 切片
./.venv/Scripts/python.exe scripts/run_crawl4ai.py \
      --url https://example.com --out /tmp/sel --selector p \
      --format md --server $S
# 期望：md 只含 <p> 段落文本
```
- 服务不可达时客户端应打 JSON 并 `exit=2`；渲染成功但有页面错误时 `exit=0` 且 JSON 的 `status=0`。

### dsh 侧
- 该包类型检查通过（`tsc -b packages/acquisition/tool-acquisition`）。
- `pnpm bobo` 通过 `node --import tsx/esm` 从源码启动，`src/index.ts` 改动即时生效，**无需重新打包 lib**。

---

## 7. 注意事项与限制

- **Camoufox 是 Firefox 内核，没有 CDP**：Scrapling 的 patchright（Chromium）与 Crawl4AI 的
  `connect_over_cdp` 都无法直连 camoufox，所以采用“长驻服务 + 统一取完整文档”的方式，而不是 CDP 直连。
- **长驻进程清理**：Windows 下 `child.kill()` 只终止 python 本身，插件用 `taskkill /pid <pid> /T /F`
  递归清掉 camoufox firefox 子进程，避免残留占用 profile 锁文件。
- **profile 持久化**：`--profile-dir` 指定目录会让 Cookies 等服务重启后仍保留；缺省用临时目录
  （重启即清空）。被占用的 profile 锁文件是浏览器在跑的正常现象。
- **代理注入时机**：代理在浏览器服务**每次（重新）启动时**注入一次；服务已在跑时再改代理配置不会
  即时生效，需在下次会话/重启后生效。
- **stdin 不使用做关闭信号**：`browser_server` 不依赖 stdin EOF，避免后台/无注入 stdin 时启动即退出。
- **前置 spike**：camoufox `persistent_context + proxy `在当前固定版本上已验证可行；若后续升级
  camoufox/playwright 版本，先按上面 Python 验证步骤回归一次。

---

## 8. 回滚

如需回退到“每引擎各自拉起浏览器”的旧行为：

1. 还原 `scripts/run_camoufox.py` / `run_crawl4ai.py` / `run_scrapling.py` 与 `scripts/crawl_common.py`。
2. 还原 `dsh/packages/acquisition/tool-acquisition/src/index.ts`。
3. 删除 `scripts/browser_server.py`。
4. 重启 `pnpm bobo`。

（本次改造未改动 `docs/说明文档/功能实现/04/05` 的旧描述；如需保持一致可后续同步，或直接以本指南为准。）