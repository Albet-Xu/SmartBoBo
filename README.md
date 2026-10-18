# SmartBoBo

> 一个把「研究、采集、逆向、汇报」四类工作装进同一个对话窗口的桌面智能体工作台。

SmartBoBo 基于 **DeepSeek Harness（dsh）** 内核构建。它不是又一个聊天界面，而是把智能体真正干活时缺的那几层补齐：

- **能看见网页**：一套隐身 Chromium（CloakBrowser）同时供抓取、右栏可视化浏览、人工接管、逆向调试使用，共享同一份登录态。
- **能读数据库**：内置覆盖 90+ 种数据库类型的图形控制台，并把「已保存的连接」变成对话里的只读查询工具与脚本可复用的连接器。
- **有记忆**：逆向 / 论文 / 汇报三套经验池，同一类任务先检索历史打法，收尾再沉淀，靠预设级闸门强制执行。
- **有纪律**：八种模式预设把「该做什么、先做什么」写进装配，关键节点由插件拦截，而不是靠提示词自觉。
- **能取用外部技能**：技能市场（ClawHub / SkillHub）与模式预设市场，模型可搜、可读、可装。
- **能交付**：从文献检索、PDF 抽取、数据入库，到可编辑 PPTX 与机械质检，形成闭环。

---

## 目录

- [快速开始](#快速开始)
- [核心能力总览](#核心能力总览)
- [八种模式预设](#八种模式预设)
- [智能体能力详解](#智能体能力详解)
  - [1. 会话、模型与推理控制](#1-会话模型与推理控制)
  - [2. 内置工具集](#2-内置工具集)
  - [3. MCP 能力清单](#3-mcp-能力清单)
  - [4. 技能与经验池（RAG 记忆）](#4-技能与经验池rag-记忆)
  - [5. 隐身上网（CloakBrowser）](#5-隐身上网cloakbrowser)
  - [6. 数据库（DBX）](#6-数据库dbx)
  - [7. 采集、逆向与代理池](#7-采集逆向与代理池)
  - [8. 技能市场与工具市场](#8-技能市场与工具市场)
  - [9. 文献、数据与交付物](#9-文献数据与交付物)
  - [10. 上下文与记忆治理](#10-上下文与记忆治理)
  - [11. 人机协作机制](#11-人机协作机制)
  - [12. 人格与语气开关](#12-人格与语气开关)
- [界面能力](#界面能力)
- [架构与端口](#架构与端口)
- [目录结构](#目录结构)
- [环境变量与配置](#环境变量与配置)
- [测试与验收](#测试与验收)
- [安全须知与已知限制](#安全须知与已知限制)
- [仓库范围说明](#仓库范围说明)

---

## 快速开始

### 方式一：源码运行（开发态）

前提：

1. 已安装 [DeepSeek Harness Desktop](https://github.com/dsh-tauri/deepseek-harness-desktop)。打包内核位于
   `%APPDATA%\dsh-tauri\dependencies\dsh\`（随原桌面应用首次运行下载，独立于安装目录）。
   若不在该位置，用环境变量 `DSH_KERNEL` 指定 `lib/bin.js` 路径。
2. 已安装 [uv](https://docs.astral.sh/uv/) 与 Node.js。

```powershell
uv sync                                                      # 建 .venv，装 Python 侧依赖
powershell -ExecutionPolicy Bypass -File bobo\ensure-deps.ps1 # 补齐 bobo 插件的共享依赖
powershell -ExecutionPolicy Bypass -File cloak\ensure.ps1     # 预铺隐身浏览器（约 200 MB）
```

然后双击 `启动.cmd`（或 `bash 启动.sh`），浏览器自动打开 `http://127.0.0.1:7075`。

启动脚本做四件事，顺序固定：打品牌补丁 → 设 `DSH_HOME=<仓库>\.dsh` → 刷新环境清单并播种 DBX AI 配置 → 拉起内核 web profile（7075）。任一步失败只告警，不阻断。

### 方式二：Windows 安装包

双击 `SmartBoBo_<版本>_x64-setup.exe`（免管理员）。安装器只带约 41 MB 的启动器与 payload，内核、Node、DBX、隐身 Chromium 等约 500 MB 运行时会**首次启动时按需下载并做 sha256 校验**。

> 安装包与依赖分发脚本位于 `packaging/`，不在本仓库中。

---

## 核心能力总览

| 能力域 | 用户感知到的能力 | 主要实现 |
|---|---|---|
| **对话与推理** | 多会话、流式输出、会话内换模型、压缩上下文、目标与计划、子代理 | dsh 内核 + `dsh/` 桌面壳 |
| **隐身上网** | 让智能体打开真实网页、读当前页、抓取落盘、绕过基础反爬 | `cloak/` + `scripts/browser_server.py` |
| **可视化浏览** | 右栏内嵌浏览器，实时镜像画面，可点可打字可输中文 | `bobo/ui-browser-cloak` |
| **数据库** | 90+ 种数据库图形控制台；对话里只读查库；脚本 UPSERT 入库 | `dbx/` + `dbx-runtime/` |
| **经验记忆** | 逆向 / 论文 / 汇报三套经验池，先检索后动手，收尾沉淀 | `skills/` + `experience-pool/` |
| **代理池** | 多源代理管理、探测筛选、失败台账、会话级切换 | `scripts/proxy_pool.py` + `bobo/command-proxy` |
| **技能市场** | 搜索并安装第三方技能；模型可自行检索借鉴 | `bobo/tool-market` + 扩展面板 |
| **模式预设市场** | 八种模式可安装 / 更新 / 卸载 | `dsh-tauri-extension` |
| **文献与 PDF** | 文献检索（OpenAlex + arXiv）、PDF 文字与表格抽取 | `scripts/literature_*`、`pdf_extract_server.py` |
| **交付物生成** | 可编辑 PPTX、机械质检、交付说明、论文写作说明 | `scripts/report_pptx.py` 等 |
| **桌面体验** | 托盘常驻、一键更新、通知、桌宠、右键菜单、SSH 远端、定时任务 | `packaging/` + `dsh/` |
| **人格开关** | 隐藏的「爸爸模式」会话人格 | `bobo/plugins/xujianbo-persona.mjs` |

---

## 八种模式预设

模式预设是**会话级**的能力边界：不同会话可以挂不同的工具集、人设与闸门。切换模式即切换「这个智能体是谁、能用什么、必须先做什么」。

| id | 名称 | 适合的任务 | 装配特点 |
|---|---|---|---|
| `crawl` | 采集模式 | 批量抓取网页、结构化落盘 | `crawl_fetch`（html/md/skeleton 三格式并存）、`browser_handoff`、`/proxy`、`/skill-model`、市场工具 |
| `reverse` | 逆向模式 | 分析反爬、签名、动态 Cookie、接口还原 | `cloak-debug` MCP（抓包/求值/Cookie/WebSocket）、逆向经验池闸门（**拦截式**）、人工接管 |
| `workflow` | 工作流模式 | 把一套重复流程固化成可复用脚本 | 采集工具 + 更窄的逆向触发词 + 逆向经验库 |
| `empirical` | 实证研究模式 | 计量实证论文全流程 | 论文经验库 + 只读 `dbx-empirical` 取数 + 论文闸门（提醒式） |
| `modeling` | 建模研究模式 | 运筹/优化建模与证明写作 | 论文经验库 + 论文闸门 |
| `experiment` | 实验研究模式 | 实验设计、可复现性、实验评估 | 论文经验库 + 论文闸门 |
| `review` | 综述与质性研究模式 | 文献综述、PRISMA、质性编码 | 论文经验库 + 论文闸门 |
| `report` | 文献汇报模式 | 论文→汇报 PPT 的完整交付 | 汇报经验库 + 汇报闸门（**拦截式**）+ `crawl_fetch` |

预设落盘在 `<DSH_HOME>/.agent-presets/<id>/`，由 `bobo/plugins/preset-includes.mjs` 在宿主启动时扫描合并。**新装或更新的预设需重启内核才进入模式列表**。

---

## 智能体能力详解

### 1. 会话、模型与推理控制

- **仅追加的会话日志**：每次交互都写成 `SessionEvent` 事件流，模型所见上下文可完全由日志重建，历史会话可归档、可检索、可修复。
- **模型接入**：DeepSeek 官方直连 + 任意 OpenAI 兼容网关；会话内可切换模型；支持为每个 provider 声明输入模态（纯文本模型可只声明 `text`）。
- **上下文压缩**：长对话自动压缩，压缩后仍注入确定性事实（见 [上下文治理](#10-上下文与记忆治理)）。
- **目标与计划**：可创建跨轮的持久目标、进入计划模式先出方案再落地。
- **子代理与协作**：`subagent` 派生子代理并行干活、`send_message` / `interrupt_agent` 通信与打断；`bobo/plugins/collab-gate.mjs` 让协作类工具只有在真正需要时才懒加载露出，避免污染每次请求的工具表。
- **后台任务**：长时间命令可放后台，`job_list` / `job_output` / `job_kill` 管理。
- **权限与沙箱**：三档沙箱（只读 / 工作区可写 / 完全放开）+ 审批策略（询问 / 从不询问）；审批无应答一律按拒绝处理。

### 2. 内置工具集

内核自带的原生工具，所有模式可用：

| 类别 | 工具 |
|---|---|
| 命令执行 | `bash`、`pwsh`（含后台与持久 PTY） |
| 文件读写 | `read`、`write`、`edit`、`str_replace_editor`、`read_image` |
| 检索 | `glob`、`grep`（随包 ripgrep）、`web_search`、`web_fetch`、`lsp` |
| 任务管理 | `todo_write`、`job_list`、`job_output`、`job_kill` |
| 协作 | `subagent`、`send_message`、`interrupt_agent`、`ask_user_question` |
| 计划与目标 | `exit_plan_mode`、`create_goal`、`get_goal`、`update_goal` |
| 技能 | `skill`（加载磁盘上的可复用指令） |

SmartBoBo 在此之上追加了本项目的专用工具：

| 工具 | 作用 | 可用范围 |
|---|---|---|
| `cloak_fetch` | 用隐身浏览器打开网址，返回 HTML 或可见文本（可指定 selector / 等待条件） | 所有模式 |
| `browser_read_current` | 读取用户右栏当前正看着的那一页（含登录态），不新开也不关页 | 所有模式 |
| `crawl_fetch` | 抓取并落盘，一次渲染同时产出 `html` / `md` / `skeleton` 三种格式 | 采集 / 工作流 / 实证 / 汇报 |
| `browser_handoff` | 把卡在验证码或登录墙的页面推给用户，等人工过关后继续 | 采集 / 逆向 / 工作流 |
| `market_search` / `market_detail` / `market_file` / `market_install` | 检索、精读、读单文件、安装第三方技能 | 采集 / 逆向 / 工作流 / 实证 / 汇报 |
| `session_recall` | 中文友好的历史会话检索 | 按配置启用 |

### 3. MCP 能力清单

外部能力以 MCP 服务器形式接入，工具名形如 `mcp__<serverName>__<tool>`。宿主层常驻的单实例服务：

| serverName | 工具 | 作用 |
|---|---|---|
| `cloak-debug` | `debug_navigate`、`debug_evaluate`、`debug_network`、`debug_cookies`、`debug_websocket`、`debug_close` | 打开并保持会话页，抓接口、验签名、看动态 Cookie 与 WS —— 逆向主力 |
| `dbx` | `dbx_list_connections`、`dbx_describe_table`、`dbx_table_exists`、`dbx_query` | 复用 DBX 里已保存的连接做**只读**查询 |
| `pdf-extract` | `pdf_extract_info`、`pdf_extract` | PDF 文字与表格抽取（无 OCR；默认 20 页 / 4 万字符上限） |
| `literature` | `literature_search`、`by_title`、`get`、`resolve`、`lookup`、`references`、`stats` | OpenAlex + arXiv 检索，带本地 SQLite 缓存，断网时只答本地库 |
| `reverse-memory` | `reverse_memory_search` / `_save` / `_feedback` / `_stats` / `_cleanup` / `_sync` | 逆向经验池 |
| `paper-memory-<模式>` | `paper_experience_search` / `_save` / `_get` / `_feedback` / `_stats` / `_cleanup` / `_sync` | 论文经验池（四个论文模式共用一个集合） |
| `report-memory` | `report_experience_search` / `_save` / `_get` / `_feedback` / `_stats` / `_cleanup` / `_sync` | 汇报经验池 |

记忆类 MCP 会按预设作用域下沉（只有真正引用它的预设才挂载），以降低常驻内存。

### 4. 技能与经验池（RAG 记忆）

这是 SmartBoBo 与普通聊天智能体最本质的差别：**它会记住自己上次是怎么栽的**。

**三层结构**

1. **本地 Markdown 是事实源**：一条经验一个 `.md` 文件，人类可读、可 diff、可手改。
2. **`registry.json` 是索引台账**：字段契约、指纹、置信度、复用次数。
3. **Qdrant 是语义索引**：`BAAI/bge-small-zh-v1.5`（512 维，COSINE）本地向量化；Qdrant 不可达时自动降级为本地关键词 + 标签打分（返回值 `mode: local`），不阻塞干活。

**三套池**

| 池 | 内容 | 当前条目 | 触发场景 |
|---|---|---|---|
| `paper-experience` | 论文写作方法论、数据处理、评审应对 | 36 条 | 选题定盘、采集前、返修后检索；收尾沉淀 |
| `report-experience` | 文献汇报 PPT 的叙事、版式、评审经验 | 29 条 | 定盘、页策划前、评分返修后检索 |
| `reverse-experience` | 具体站点的反爬手段与突破路径 | 7 条 | 新站点逆向之前按域名 + 标签 + 语义检索 |

**质量机制**

- **入库门槛**：置信度必须严格大于 2.0 才入库，否则直接丢弃（不写文件、不入索引）。
- **反馈调分**：用过某条经验后回报成功 +0.5 / 失败 −0.5，跌破门槛自动删除索引点并本地归档。
- **同指纹去重**：逆向池「同域名 + 同标签 + 同反爬特征」直接替换旧条目；论文与汇报池做强化合并（取并集并提升置信度）。
- **冷归档**：90 天未被复用、置信度低于 2.5、从未被使用 → 归档。

**纪律（闸门插件）**

闸门是「拦截式」而不是「提醒式」，这是刻意设计：

| 预设 | 闸门行为 |
|---|---|
| 逆向 / 工作流 / 汇报 | **deny 拦截**：开题前没检索、收尾前没沉淀，工具调用直接被拒；同一目标连拒 3 次后放行，防死锁 |
| 论文四模式 | **只提醒不拦截**：按 S0–S6 阶段注入对应提示，S4 明确提示「此时不要查」 |

闸门只在本机 `readiness.json` 标记 `ready: true` 时生效，任何异常一律 fail-open（宁可不拦，也不卡死工作）。

### 5. 隐身上网（CloakBrowser）

普通智能体拿到的网页是 HTTP 响应文本；SmartBoBo 拿到的是一个**真实的、有指纹伪装的、带登录态的浏览器**。

- **单实例 CDP 服务**：`cloakserve` 在 `127.0.0.1:9333` 多路复用，一个 Python 进程托管多个浏览器身份；Profile 持久化在 `cloak/data/`，Cookie 重启后延续。
- **惰性启动与自愈**：首次调用才起服务，宿主退出只清理自己起的进程；启动失败会先清孤儿进程再拉起。
- **无黑窗**：用 `pythonw.exe` 拉起、子进程带 `CREATE_NO_WINDOW`，不会在桌面闪出终端。
- **右上角能力**：`cloak_fetch` 抓取、`browser_read_current` 读当前页、`crawl_fetch` 多格式落盘、`cloak-debug` 深度调试，全部共用同一个浏览器实例与登录态。

**右栏「内置浏览器」面板**：把共享页做成可视化镜像。

- 50 ms 级画面镜像（服务端 screencast 帧缓存，静止页面零带宽）
- 鼠标点击 / 双击 / 右键 / 拖动 / 滚轮、键盘输入直接作用于真实页面
- **中文输入法直输**：通过 CDP IME 合成事件，拼音缓冲与候选窗都能跟着走，中文一步上屏
- 标签页管理、地址栏、刷新；窗口拖宽拖窄时页面真 reflow（视口跟随）
- 无页面时自动打开起始页
- **人工接管（handoff）**：智能体卡在验证码/登录墙时，页面自动浮出到右栏，用户手工过关后选「我已完成，继续 / 跳过这个站点 / 换个代理再试」

### 6. 数据库（DBX）

- **图形控制台**：侧栏「数据库」面板内嵌 DBX Web（`dbx-web.exe`，端口 4230），界面提供 90+ 种数据库类型的连接入口，支持建表、SQL 编辑、备份调度。连接与口令落在本地 SQLite。实际可用方言取决于随包编译的驱动；对话查库与脚本入库目前只覆盖 MySQL / MariaDB、PostgreSQL、SQLite 三类。
- **运行时托管**：内核加载插件即自动拉起 `dbx-web.exe`，退出时按进程树清理；安装版会提前预热，避免「启动后一分钟内工具时有时无」。
- **对话里查库**：4 个只读 MCP 工具，可直接说「用 dbx 看看某个连接里有哪些表」。
  - 默认**摘要模式**：200 行以内内联返回，超出只回表头 + 真实行数 + 建议，完整结果流式落盘，避免把几十万行灌进上下文。
  - **只读闸门**：非 `SELECT` 开头的语句直接拒绝。写库必须走提取脚本，不能靠对话直接改数据。
- **内置 AI 桥**：DBX 自带的「AI 修 SQL / AI 对话」被转发到与主界面同一条大模型通道（`/bobo-llm`），不用在 DBX 里再配一遍 endpoint 和 key。
- **脚本侧复用**：`dbx_connector.py` 提供 `list-connections` / `list-tables` / `describe-table` / `table-exists` 与 `upsert_rows()`；`db-extraction` 技能给出「采集 → 逐字段确认 → 提取 → UPSERT 入库（含增量）」的标准流程，写库前还有乱码与缺失值质检，不通过直接阻断写入。

### 7. 采集、逆向与代理池

- **采集**：`crawl_fetch` 一次渲染派生三种格式——原始 `html`、Markdown、块级 DOM 骨架（`skeleton`），文件名带站点、标题与时间戳。服务不可达时自动重启并重试一次。
- **逆向**：`cloak-debug` 保持会话页不关，逐步验证接口、签名、动态 Cookie、WebSocket 消息，配合逆向经验池「先查历史打法、后动手」。
- **代理池**：
  - 多源管理（API 地址、密钥、提取数量、协议 http/socks5、启停、拖拽排序）
  - 取用策略 `cache`（批量取后轮询）/ `realtime`（每次现取）
  - **探测筛选**：最多 3 轮、每源每轮最多探 10 个、单个超时 8 秒；目标站只要能回任意 HTTP 响应就算通（403 不判死，避免误杀可用 IP）
  - **失败台账**：失败 IP 记入 `data/proxy_failed.json`，15 分钟内不再复用
  - **会话级开关**：`/proxy`、`/proxy on`、`/proxy off`；`/proxy 帮我抓 xxx` 会把后半句原样转给模型
  - **全灭降级**：池里找不到可用代理时，会反问「是否走本地网络访问」，而不是静默失败
- 代理注入发生在拉起浏览器服务时（服务级参数），因此会话中途切代理会重启服务、丢失当前页状态。

### 8. 技能市场与工具市场

**给模型用的**：`market_search` → `market_detail` → `market_file` → `market_install`。安装前会复验 frontmatter（名字必须 kebab-case、描述非空），逐文件 sha256 校验后原子落盘，**不执行任何脚本**。`market_detail` 会做**能力披露**：这个技能要 shell 吗、有 hooks 吗、读不读密钥、访不访问网络、写不写文件，每条都带证据片段。

**给人用的**：侧栏扩展面板

| 标签页 | 能做什么 |
|---|---|
| 插件 | 已装插件的卸载 / 升级 / 禁用 |
| 市场 | 内嵌第三方插件市场面板 |
| 技能 | 内置 / 自定义 / 市场三源聚合；新建、编辑、删除、技能仓库（本地目录或 GitHub tarball） |
| MCP | 全局与 profile 两层 MCP 的增删改查、连通性检查，可从 Claude Code / Codex / Cursor 等配置导入 |
| 模式预设 | 八种模式的安装 / 更新 / 卸载，卡片直接标出「依赖缺失」「装配缺失」 |
| 工具 | 把工具挂进指定预设的作用域（写入预设的托管区块） |

市场索引不做长缓存，每次打开都真拉；上游挂了才回落到上次成功的文档并标注。

### 9. 文献、数据与交付物

- **文献检索**：`literature` MCP 对接 OpenAlex 与 arXiv，标题解析、DOI 解析、引用关系、统计；结果落本地 SQLite，断网时仍可查历史。
- **PDF 抽取**：`pdf_extract` 按页取文字与表格，可先 `pdf_extract_info` 探页数与体量再决定抽哪些页。
- **汇报交付三件套**：
  - `report_pptx.py`：把 `slide-plan.json` 渲染成**可编辑** PPTX + 讲稿备注，同一份 plan 产出确定性哈希
  - `report_qa.py`：机械质检（high / medium / low），可选调用本机 PowerPoint 逐页渲图并留 sha256 指纹；有 high 违规时退出码非 0
  - `report_deliver.py`：生成《汇报说明》，`--check` 核对交付闸门是否齐全
- **论文写作说明**：`paper_report.py` 支持四种论文模式，输出阶段化写作说明与检查项。

### 10. 上下文与记忆治理

长对话最容易崩的不是模型，是上下文。这一层由四个插件负责：

| 插件 | 作用 |
|---|---|
| `at-workspace` | 消息里写 `@路径` 自动展开成文件正文或目录清单（限制深度与单文件体积） |
| `context-facts` | 上下文被压缩后，重新注入一份**确定性事实台账**（任务目标、约束、已完成项），分层裁剪进固定字符预算，最高优先级永不丢 |
| `context-throttle` | 重型检索类工具调用限流：先软提醒，再硬拒绝，并留逃生阀，防止模型陷入反复检索 |
| `session-search-cn` | 中文历史会话检索，自建 trigram 倒排索引，补上游中文分词不可用的问题 |

另有 `session-state`：会话级粘性状态落盘，压缩后自动重注入，避免「压缩完就忘了自己开了代理」。

### 11. 人机协作机制

- **主动提问**：`ask_user_question` 结构化提问（选项 + 说明），而不是让模型瞎猜。
- **人工接管**：`browser_handoff` 见上文，是采集/逆向场景里最实用的一条逃生通道。
- **审批气泡**：需要授权时弹出一次性批准，可内联在原生通知里直接「批准」。
- **子代理协作**：可派生独立上下文的子代理并行处理子任务，主代理只收结论。

### 12. 人格与语气开关

代码里保留了一个隐藏的会话人格开关：用户自报身份并点名时进入该人格（固定开场句、周期性提醒、撒娇语气），说「BoBo 正常点」「别撒娇了」退出。它只响应**真实用户输入**，网页内容或工具结果不会误触发；状态是会话级内存态，重启即恢复默认。

标准模式下也有固定的开场文案（由宿主层 `bobo-common` 系统提示段保证），所以模式之间切换不会出现「换个壳就换了个人」。

---

## 界面能力

除了对话本身，桌面壳把智能体真正需要的东西都放进了同一个窗口：

| 能力 | 说明 |
|---|---|
| **品牌与外观** | 侧栏与首屏品牌位、标题、favicon、PWA manifest 统一为 SmartBoBo；首屏标语「万物皆可得」；启动字标 HARNESS → AGENT |
| **内置浏览器** | 右栏标签页，见上文 |
| **设置面板** | 通用设置之外新增「经验池」「代理池」两个栏目；模型设置里去掉官方 API 引导弹窗与未配置供应商的默认填写卡 |
| **拖选与复制** | 对话正文可自由拖选；自建右键菜单支持复制文本、复制图片（含转 PNG）、图片另存为、复制图片地址 |
| **扩展面板** | 插件 / 市场 / 技能 / MCP / 模式预设 / 工具 六个标签页 |
| **托盘常驻** | 关窗 = 隐藏到托盘；托盘菜单可显示主界面、检查更新、退出。二次启动秒开 |
| **一键更新** | 后台静默查版本，托盘提示，点了才下载安装；带 sha256 校验，升级不丢数据 |
| **原生通知** | 轮次完成、权限审批、提问三类，审批可内联「批准」 |
| **桌宠** | 独立透明置顶窗口，按会话活动切状态 |
| **右键菜单** | 会话、工作区、正文、链接、输入框五类原生菜单 |
| **定时任务** | cron 计划，可向当前会话投递提醒或新开会话执行，带执行历史 |
| **会话归档** | 把「删除工作区」改成「归档工作区」，另有已归档页可搜索、恢复 |
| **Git Worktree** | 每个会话独立工作树，分支前缀 `dsh/`，改动可收回或丢弃 |
| **SSH 远端** | 连远端机器、自动装/启远端 `dsh web`、回环隧道嵌进本窗口 |
| **任务管理器** | 查看本机与内核子进程的 CPU / 内存 / 运行时长，可结束进程、重启服务、读日志 |

---

## 架构与端口

```
┌──────────────────────────────────────────────────────────────┐
│  桌面壳（pywebview / Tauri）                                   │
│  启动器：依赖下载 → 版本闸门 → 预热 → 就绪端点 → 托盘           │
└───────────────┬──────────────────────────────────────────────┘
                │ iframe / WebView2
┌───────────────▼──────────────────────────────────────────────┐
│  dsh 内核（DeepSeek Harness）  127.0.0.1:7075                  │
│  会话 / 模型 / 工具 / MCP 宿主 / 工作区 / 权限 / 预设            │
└───┬──────────┬──────────┬──────────┬──────────┬───────────────┘
    │          │          │          │          │
    ▼          ▼          ▼          ▼          ▼
 插件 18 个   MCP ×7   经验池 ×3   浏览器      数据库
 bobo/plugins  stdio   Qdrant     cloakserve   dbx-web
                                   :9333        :4230
                                      │
                                      ▼
                              browser_server（派生端口）
```

| 端口 | 服务 | 说明 |
|---|---|---|
| `7075` | dsh 内核 Web UI | 主界面，URL 带一次性 token |
| `4230` | DBX Web 控制台 | `dbx-web.exe` |
| `9333` | cloakserve CDP | 隐身浏览器多路复用，仅绑回环 |
| `20000 + crc32(项目根) % 20000` | `browser_server.py` | 采集/面板适配层，由项目根派生，保证同一部署共用一个浏览器实例 |
| `7085` | 验收脚本 | `scripts/acceptance.py` 起临时内核 |

---

## 目录结构

| 路径 | 说明 |
|---|---|
| `启动.cmd` / `启动.sh` | 开发态启动器：打品牌补丁 → 设 `DSH_HOME` → 刷新环境清单 → 播种 DBX → 拉起 web（7075） |
| `bobo/plugins/` | 18 个宿主层插件：上下文治理、闸门、人格、就绪端点、预设合并等 |
| `bobo/command-proxy/` | `/proxy` 会话代理开关 + 代理池设置命名空间 |
| `bobo/command-skill-model/` | `/skill-model` 命令：任务先检索技能市场再干活 |
| `bobo/tool-market/` | 模型侧市场工具（search / detail / file / install） |
| `bobo/tool-acquisition/` | `crawl_fetch`、`browser_handoff`、右栏浏览器桥 |
| `bobo/ui-*/` | 三个 Web 侧 UI 插件：内置浏览器、经验池设置、代理池设置 |
| `cloak/` | CloakBrowser 集成：插件、CDP 服务封装、抓取工具、预铺脚本、回归测试 |
| `dbx/` | DBX 集成：面板插件、AI 桥、只读 MCP、连接器、`db-extraction` 技能、测试 |
| `dbx-runtime/` | DBX 运行时（二进制、前端、本地 SQLite、环境清单），已在 `.gitignore` |
| `skills/` | 四个技能资产：三个经验池 + 一个共用机制层 |
| `experience-pool/` | 三套经验池的实际条目（36 / 29 / 7 条）与 registry |
| `scripts/` | 21 个 Python 脚本 + 2 个 Node 脚本：浏览器服务、代理池、MCP 服务、文献、PDF、PPTX、质检、验收、会话修复 |
| `dsh/` | 桌面宿主源码工作区（Tauri + React，17 个一方插件包） |
| `vendor/dsh-resources/` | 桌面端插件构建产物（以普通文件收录，供 profile `link:` 引用） |
| `.dsh/` | 本地 `DSH_HOME`：profile、会话、预设、市场状态、凭据（已 gitignore） |
| `docs/` | 详细操作指南（见[仓库范围说明](#仓库范围说明)） |
| `packaging/` | Windows 打包与发布脚本（见[仓库范围说明](#仓库范围说明)） |

---

## 环境变量与配置

| 变量 | 作用 |
|---|---|
| `DSH_HOME` | 内核状态根目录；开发态指向 `<仓库>/.dsh` |
| `BOBO_ROOT` | 项目根，决定派生端口、技能与脚本定位 |
| `BOBO_DSH_ROOT` | `dsh/` 源码工作区路径 |
| `DSH_KERNEL` | 内核 `lib/bin.js` 路径（内核不在默认位置时使用） |
| `CLOAK_WINDOW_SIZE` | 内置浏览器视口，如 `1920,947` |
| `CLOAK_VIEWPORT_FOLLOW` | 设为 `0` 关闭视口跟随 |
| `CLOAKBROWSER_CACHE_DIR` | 隐身浏览器二进制缓存目录 |
| `DBX_PORT` / `DBX_DATA_DIR` | DBX 端口与数据目录 |
| `LITERATURE_DATA_DIR` | 文献本地库目录 |
| `HF_ENDPOINT` | 设置 `https://hf-mirror.com` 可加速向量模型下载 |
| `BOBO_NO_TRAY` | 设为 `1` 关闭托盘 |
| `BOBO_TRACE_PAGE` | 设为 `1` 打开页面性能追踪 |

配置文件：

- `.dsh/profiles/web/cordis.patch.yml` —— 宿主层接线总表（MCP、插件、UI 挂载都在这）
- `.dsh/profiles/web/package.json` —— profile 的插件 link 与 bundles
- `experience-pool/experience-pool.json` —— 三池共享的连接配置（含密钥，**已 gitignore**）
- `pyproject.toml` / `uv.lock` —— Python 依赖与锁定

---

## 测试与验收

```powershell
# 隐身浏览器全链路（不启内核）
node cloak\plugin\test.mjs

# 市场与预设的纯逻辑自检（100 + 83 个用例，不联网）
node dsh\packages\dsh-tauri-extension\src\host\service\repo\repo-core.mjs --selftest
node dsh\packages\dsh-tauri-extension\src\host\service\repo\market-core.mjs --selftest

# 每个宿主层插件自带自检
node bobo\plugins\context-facts.mjs --selftest

# DBX 摘要契约与只读闸门
pytest dbx\tests

# 装配层整体验收（七组检查，默认 7085 端口）
python scripts\acceptance.py
python scripts\acceptance.py --skip-live   # 只跑静态检查，不起内核
```

`acceptance.py` 覆盖：环境前置、启动、预设挂载、技能发现与命名空间、装配一致性、Cloak 守卫、插件自检、pytest；退出码 0 / 1 / 2 分别表示通过 / 失败 / 环境不满足。

---

## 安全须知与已知限制

**请认真读这一节再决定怎么用它。**

1. **这是一个能执行本地代码的智能体。** 默认沙箱为「工作区可写 + 询问审批」，但 `danger-full-access` + 从不询问的组合意味着完全不拦。请在可信、可丢弃的环境里运行，不要在有敏感数据的机器上放开。
2. **端口只应在本机使用。** `9333`（浏览器 CDP）与 `7075`（内核，URL 带 token）都只绑回环。`4230`（DBX）默认监听更宽，且面板口令可能被禁用，**不要把该端口暴露到局域网或公网**。
3. **DBX 的口令是本地明文存储的**（SQLite 中 `connection_secrets` 表未加密）。共用机器上请注意磁盘权限。
4. **代理只是「服务级」参数。** 运行中切换代理需要重启浏览器服务，当前页面状态会丢；带账号密码的代理不能内联到 `--proxy-server`。
5. **`dbx_query` 的只读判定是字符串前缀判断。** `WITH ... SELECT` 会被当作只读放行，`EXPLAIN` / `SHOW` 一律按首词判定。真正的安全边界是**目标数据库账号的权限**，不是这道闸门。
6. **市场安装不执行脚本，但技能内容仍需自行判断。** 安装前请看一眼能力披露（shell / hooks / secrets / network / writes）。
7. **品牌补丁是锚点式文本替换。** 内核升级改写压缩产物后，个别补丁可能失配并回退官方品牌——功能不受损，只是外观变回去，重跑补丁即可。
8. **预设装完要重启**才进模式列表；直接手改随包预设目录会在升级时被覆盖。
9. **经验池里的经验只是待验证假设，不是引用来源。** 经验 id 只允许出现在设计文档的「参考经验」字段里，不得进入论文正文、PPT 页面或讲稿。

---

## 致谢

- 内核与桌面宿主来自 [DeepSeek Harness](https://github.com/dsh-tauri/deepseek-harness-desktop)
- 隐身浏览器来自 [CloakBrowser](https://github.com/CloakHQ/CloakBrowser)
- 数据库控制台来自 DBX
- 向量检索来自 [Qdrant](https://qdrant.tech/)，本地嵌入模型为 `BAAI/bge-small-zh-v1.5`
- 技能市场聚合 [ClawHub](https://clawhub.ai) 与 [SkillHub](https://api.skillhub.cn)
