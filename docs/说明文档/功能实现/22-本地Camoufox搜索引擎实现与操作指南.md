# 22-本地 Camoufox 搜索引擎实现与操作指南

> 本文档记录把 BoBo 的 `web_search`（网页搜索）**从 DeepSeek 云搜索替换成本地 Camoufox 浏览器搜索**的改动流程、文件清单与后续维护方式。改动只影响「搜索」这一个渠道，`crawl_fetch`（整页采集）等其他功能不受影响。

---

## 1. 背景与目标

- **原问题**：`web_search` 走 `web-search-deepseek`（DeepSeek 官方云搜索），需要 `DEEPSEEK_API_KEY`。若该 key 缺失或为占位中文，会报 `Cannot convert argument to a ByteString ...`（标题头含非 ASCII 字符）或 `Authentication Fails ... invalid`（key 无效）。
- **目标**：彻底替换 DeepSeek 云搜索 —— 所有 `web_search` 都改为**调用本地 Camoufox 抗检测浏览器**去搜索引擎（默认百度）检索，无需任何 API key，结果真实、可直连。
- 好处：零密钥、零费用、可控、可扩展多引擎；坏处：每次搜索会冷启动一个浏览器（约 3–8 秒），且不返回 AI 合成摘要（只有标题/链接/摘要，模型自行组织）。

> 关键认知：dsh 把「搜索」抽象成了 `ctx.web` 的**可插拔 provider**（`searchProvider` 配置项），所以换引擎**不需要改动模型侧的任何提示词或工具定义**，只新增一个 provider 并把配置指过去即可。

---

## 2. 工作原理（数据流）

```
web_search 工具
   └─ ctx.web.search({query, maxResults})
        └─ CamoufoxSearchProvider.search()      [@deepseek-ai/dsh-web-search-camoufox]
             └─ child_process 调  BoBo根/.venv/Scripts/python.exe
                  └─ scripts/run_camoufox_search.py --query "..." --engine baidu --max 8
                       └─ Camoufox 无头浏览器 → 打开百度/必应 → 提取结果行
                       └─ stdout 打单行 JSON {"sources":[{title,url,snippet}], "truncated":bool}
        └─ 解析 JSON → 映射成 WebSearchSource[] → 返回给 web_search
```

- provider 的 Python/脚本路径**自动定位**（向上找含 `dsh` 的目录），不依赖启动时 cwd，跨机器可移植。
- seam 会在返回前按 `request.maxResults` 截断；`truncated` 由脚本判定后透传。

---

## 3. 改动文件清单

| 作用 | 文件 | 说明 |
|---|---|---|
| **Python 搜索引擎（核心）** | `E:/SmartBoBo/scripts/run_camoufox_search.py` | 新增。用 Camoufox 在指定引擎检索，单行 JSON 输出。默认引擎 `baidu`，可选 `bing`。 |
| **Node 搜索 provider 插件（核心）** | `E:/SmartBoBo/dsh/packages/web/web-search-camoufox/` | 新增包 `@deepseek-ai/dsh-web-search-camoufox`。含 `src/index.ts`、`src/provider.ts`、`src/invariant.ts`、`package.json`、`tsconfig.json`。 |
| 构建登记 | `E:/SmartBoBo/dsh/tsconfig.host.json` | 在 `web-search-*` 组里新增 `packages/web/web-search-camoufox` 引用。 |
| 运行时链接 | `E:/SmartBoBo/dsh/apps/cli/package.json` | 新增依赖 `@deepseek-ai/dsh-web-search-camoufox: workspace:^`（供 `pnpm bobo` 时 link 进 profiles node_modules）。 |
| 部署装配 + 切换 provider | `E:/SmartBoBo/dsh/patch/web-acquisition.yml` | `- insert:` 新增 `web-search-camoufox` 行；再用 `- id: web` 覆盖 `searchProvider: camoufox`（替换掉 base 里的 `deepseek-official`）。 |

> 说明：DeepSeek 的 `web-search-deepseek` 插件仍保留在 base（已不再被选中，属于不生效的闲置注册）。若想连注册都去掉，可在 `packages/bundle/base/cordis.patch.yml` 那个 `web-search-deepseek` 行加 `disabled: true`；但更稳妥的做法是保留它，只在 overlay 里切 `searchProvider`，这样万一新 provider 出问题，还有一个可回退的旧渠道（只要它有有效的 key）。

---

## 4. 配置说明（怎么改）

**4.1 引擎选择（`engine`）**
- 默认 `baidu`：国内直连、返回干净真实 URL，推荐。
- 可选 `bing`：需在 `patch/web-acquisition.yml` 里把 `web-search-camoufox` 的 `config.engine` 改成 `bing`。
  - ⚠️ 实测 **Bing 对无人值守查询有反爬投毒**（会整页返回无关结果，如 Amazon/地图），此环境不推荐；保留它是为将来网络/代理条件变化时备用。
- 要加新引擎：在 `run_camoufox_search.py` 的 `ENGINES` 字典里加一项（`url` 构造 + `extract` 提取函数 + `--engine` 取值），并在 `provider.ts` / `index.ts` 的 `engine` 参数说明中同步。

**4.2 结果条数（`maxResults`）**
- `web_search` 工具默认最多 8 条（`tool-web` 的 `WEB_SEARCH_MAX_RESULTS`）。
- provider 兜底上限由 `web-search-camoufox` 的 `maxResults`（默认 8）控制；`web.config.searchProvider` 只选 provider，不改条数。

**4.3 超时（`timeoutMs`）**
- 默认 90 秒，覆盖一次 Camoufox 冷启动 + 检索 + 提取。搜索慢时可调大。

---

## 5. 构建与生效方式

```bash
# 1) 链接新 workspace 包并更新 lockfile（仅首次）
cd E:/SmartBoBo/dsh
pnpm install

# 2) 构建（打出 lib/ 供运行时加载；全量构建含所有包）
pnpm run build

# 3) 重启服务（provider 与装配在启动时加载）
pnpm bobo
```

- provider 是**启动时才挂载**的，改装配/新包后必须**重启** `pnpm bobo`。
- 不用重启的场景：只改 `run_camoufox_search.py` 的选择器/引擎逻辑时，脚本是搜索时实时调用的，改完立即生效。

---

## 6. 验证方法

1. 重启用 `pnpm bobo` 启动 BoBo。
2. 在任一含 `web_search` 的模式（标准/code/cordis/采集等）里发：「**帮我搜索：DeepSeek MCP 服务器 GitHub**」。
3. 期望：工具返回来源列表（百度结果、真实 URL），模型据此作答；不再出现 `DeepSeek search request failed ... ByteString` 或 `Authentication Fails`。
4. 直连脚本自测（不依赖界面）：
   ```bash
   cd E:/SmartBoBo
   .venv/Scripts/python.exe scripts/run_camoufox_search.py --query "DeepSeek MCP" --max 5
   ```
   应输出一行 JSON，`sources` 为真实结果。

---

## 7. 故障排除

| 现象 | 原因与处理 |
|---|---|
| 搜索报「未找到本地脚本/venv」 | `.venv` 缺失或 `scripts/run_camoufox_search.py` 不在。执行 `cd E:/SmartBoBo && uv sync` 重建 venv；确认脚本在 `scripts/`。 |
| 插件没加载（`web-search` 报 provider 缺失） | 新增包未 link/未构建。检查 `pnpm install` 与 `pnpm run build` 是否执行、`apps/cli` 是否加了依赖。 |
| 返回结果全是不相关（尤其 `--engine bing`） | Bing 反爬投毒，换回 `baidu`（见 4.1）。 |
| 搜索很慢 | Camoufox 每次冷启动浏览器，属正常（约 3–8 秒）。后续可加「常驻浏览器/复用页面」优化。 |
| `web_fetch` 抓取整页 | 仍未开启（base 出于 SSRF 关闭）；抓整页仍用 `crawl_fetch`，两者互不影响。 |

---

## 8. 维护速查

- **改搜索逻辑/选择器**：只改 `scripts/run_camoufox_search.py`，无需重启。
- **改引擎/条数/超时**：改 `dsh/patch/web-acquisition.yml` 里 `web-search-camoufox` 的 `config`，需重启。
- **加新引擎 / 换默认引擎**：改 `run_camoufox_search.py` 的 `ENGINES` 与 `provider.ts` / `index.ts` 的默认值及说明，重新构建 + 重启。
- **要彻底移除 DeepSeek 搜索注册**：见第 3 节末尾说明（base 补丁里 `web-search-deepseek` 加 `disabled: true`）。