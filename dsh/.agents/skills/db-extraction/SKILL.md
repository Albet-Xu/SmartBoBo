---
name: db-extraction
description: 工作流模式下"从采集数据提取字段并写入数据库"的可复用技能：含读取 DBX 已保存连接的库（dbx_connector）、提取入库脚本骨架（extraction_template）、逐字段确认与 UPSERT 去重/更新入库的 SOP。当用户要求把采集到的数据按字段写入数据库表时使用。
disable-model-invocation: false
user-invocable: true
---

# db-extraction：采集数据 → 确认字段 → 选择输出格式 → 提取 → UPSERT 入库

本技能供「工作流模式」复用，核心目标：**少写样板、少费 token、产出结构一致的提取入库脚本**，同时做到**不猜测字段、无重复入库（去重/更新）**，并让**采集输出格式与入库字段的提取需求对齐**。动手前先加载本技能，按下面的 SOP 执行。

## 配套文件（同目录）

- `dbx_connector.py`：**读取 DBX 已保存的连接**（`dbx-runtime/data/dbx.db`），提供 `list-connections` / `list-tables` / `describe-table` / `upsert_rows`，既可当命令行也能被脚本 import。
- `extraction_template.py`：**可复用的提取入库骨架**。生成脚本时把它复制为 `extraction_scripts/<名称>.py`，只填充「# ⛏️ GEN-CUSTOM」定制区。

## 数据库连接：复用内置 DBX（读走 MCP，写走脚本）

1. **先定位 BoBo 根目录**（含 `dbx-runtime` 的目录，常见 `E:/SmartBoBo/BoBo`、`~/SmartBoBo/BoBo`），用文件系统工具确认其路径；`dbx-mcp` 服务器会自动定位它。
2. **读取连接与表结构走 MCP 工具**（工作流模式已挂 `mcp-dbx`，常驻提速）：用 `mcp__dbx__list_connections` 查看 DBX 已保存的连接（数据源即 `<BoBo根目录>/dbx-runtime/data/dbx.db`）、`mcp__dbx__describe_table(<连接名>,<表>)` 读表字段、`mcp__dbx__table_exists` 校验存在、`mcp__dbx__query` 做只读 SELECT。比逐命令起 `dbx_connector` 子进程更快。
3. 目标库已在连接里 → 直接按连接名复用；不在 → 用 ask_user 询问用户，或引导其在左侧「数据库」面板新建连接。
4. **写库（批量 UPSERT）走提取脚本**：脚本进程内 `import dbx_connector` 直接连库写，不经 MCP（避免行的 JSON-RPC 序列化开销）。`dbx_connector` CLI（带 `--bo-bo-root <根目录>`）仍可用于手工排障。

## 选择采集输出格式 source_format

字段映射确认后，按"入库字段的提取需求"选定采集输出格式（与 `crawl_fetch` 的 `outputFormat` 一致），
**三种格式都能满足时选默认 md**：

| 需要入库的字段类型 | source_format | 原因 |
|---|---|---|
| 标题 / 正文 / 简介等常规纯文本字段；或三种格式皆可 | `md`（默认） | 兼容默认，零额外结构解析 |
| 需精确选择器定位 / 取链接(@href) / 嵌套结构化字段 | `html` | 保留原始结构与可定位性 |
| 按块 / 容器逐块取文本（文章分段、逐块字段） | `skeleton` | 每行 `CSS路径 -> 文本`，逐块取值干净 |

- 选定后写入提取脚本 `CONFIG.source_format`（可用 `--input-format` 覆盖），并在批量采集时让 `crawl_fetch` 带 `outputFormat=<source_format>`，保证**采集落盘格式 == 提取脚本读取格式**。
- `extract_rows(text, source_format)` 内先调 `parse_source(text, source_format)` 拿通用"取值块"，模板里给了 md / html / skeleton 三种取值范式。

## 提取入库 SOP

1. **读数据库字段（只针对被授权的目标表）**：用 `mcp__dbx__list_connections` 确认 DBX 已保存连接并复用目标库；用 `mcp__dbx__table_exists(<连接名>,<目标表>)` 校验存在，用 `mcp__dbx__describe_table(<连接名>,<目标表>)` 取目标表全部字段（名/类型/主键/唯一/可空）。**授权范围（强制）**：只操作目标表；用户主动给的参考表仅 describe 只读，绝不写入；**不用 `list-tables` 枚举库里其它表**。
   - 空白/新表：问用户要 CREATE TABLE SQL；没有则逐个询问需要哪些字段（名+含义+类型），确认后仅建该目标表。
2. **确认字段含义（严格逐一，不猜测）**：拿到目标表全部字段后**严格逐一**用 ask_user 逐个字段询问含义与数据来源，**每问完一个字段再问下一个**；**必须保证每个字段都征求过用户意见**。每个字段可给**推荐方案**（依据网页信息/建议默认值），但推荐不能代替询问。**先只确认字段含义**，页面能否满足放在第 4 步对照样品页后再定。**不要自作主张把未经确认的值写入。**
   - NOT NULL 配置类字段的推荐默认值（供确认/修改）：`fetcher='http'`（需渲染/登录用 `browser`）、`link_selector`（从页面 HTML 分析出的列表链接选择器）、`per_column_limit=20`、`dedupe_enabled=1`、`sort_order=1`、`enabled=1`、`remark=''`、`created_at/updated_at=NOW()`。
3. **抓样品页了解页面结构**：抓一个样品页（`crawl_fetch`，或先运行 `crawl_script/` 里已有的逆向脚本），阅读样品，**枚举该网页可提供的信息点**（标题/正文/列表/价格/日期/链接等）与样例值；同时记录 `crawl_script/` 是否已有匹配脚本。样品页抓取也用最终确认的 `outputFormat`（或先用 md 侦察，写脚本时再按 source_format 采集）。
4. **核对字段满足度 & 补空值/固定值，并选定 source_format**：把第 2 步确认的每个字段逐一对照样品页，能提取的标记来源；**页面满足不了的字段逐个询问用户**：填 NULL 空值，还是给固定值（由用户给定）。整理最终字段映射给用户**再确认一次**；同时按上面"选择采集输出格式"一节选定 `source_format`（三种格式皆可时选 md）。确认无异议才进入写脚本。
5. **写提取入库脚本（复用检查 + 生成）**：读 `extraction_scripts/index.md`，若已有"同网址类型 + 同目标表 + 同 source_format"脚本 → 直接复用（跳到第 7 步）；否则复制 `extraction_template.py` 至 `extraction_scripts/<名称>.py`，同目录复制 `dbx_connector.py`；只改定制区：
   - `CONFIG`：`conn`（DBX 连接名）、`table`、`dbx_data_dir`（BoBo/dbx-runtime/data 绝对路径）、`input`/`data_dir`（data 目录）、`source_format`（第 4 步选定的格式）、`unique`（去重键）、`fixed_values`（用户确认的固定值）；
   - `extract_rows(text, source_format)`：按确认的映射（先 `parse_source(text, source_format)` 取块）把该网站采集结果拆成一条条记录（dict，键=数据库字段名）。
6. **登记复用**：在 `extraction_scripts/index.md` 追加一行 `网址类型 | 目标表 | source_format | 脚本名`。
7. **批量采集与入库（采集与入库分离；只写目标表）**：
   - **批量来源**：用户输入里的一批 URL、一个 **URL 清单文件**（每行一个 URL）、或一个已抓好的 `data/` 目录；
   - **采集（落数据）**：对清单/输入里的每个网址，优先运行匹配的 `crawl_script/` 逆向脚本，否则用 `crawl_fetch` **按引擎降级**（camoufox → 失败/超时改 scrapling → 再失败改 crawl4ai → 全失败再报告），并带 **`outputFormat=<source_format>`**（与提取脚本 CONFIG.source_format 一致），同类型数据统一落 `data/`；
   - **入库（调脚本）**：`python <脚本> --data data`（目录/通配/单文件都支持）或 `python <脚本> --urls <清单> --data-dir data`（URL 清单驱动，入库 data/ 下已抓文件），批量 UPSERT 目标表。
8. **预览并入库（只写目标表）**：
   - 先 `python <脚本> --dry-run`，把将要写入的行展示给用户确认；
   - 用户确认后正式运行：`python <脚本>`，**只向目标表写入**，按唯一键 UPSERT（已存在更新、无则插入）→ **无重复入库（去重/更新）**；绝不写/改其它表；
   - 汇报插入/更新条数、目标表、脚本路径、source_format。

> 运行脚本建议用 BoBo 的 `.venv/Scripts/python.exe`（已含 pymysql/psycopg/lxml）；若用系统 python 缺驱动，脚本会打印安装命令。

## 减少 token 的要点

- **不要重写通用部分**：`dbx_connector` 连库/UPSERT、模板的 CLI/预览/清洗全部复用。
- **改动收敛在定制区**：生成脚本与模板的 diff，就是"该网站 → 该表 + 该 source_format"的抽取逻辑。
- **同类复用**：同类型网址 + 同表 + 同 source_format 时直接调用 `extraction_scripts/` 里已有脚本，不重新生成。

## 边界

- 用途合规：只写用户授权库表；不用于非法采集、绕过付费墙、损害他人系统。
- 驱动缺失会明确提示安装命令；不支持的数据类型给出清晰报错，不静默失败。
- source_format 必须与采集落盘格式一致；不一致会导致 extract_rows 解析不到字段（dry-run 会暴露）。