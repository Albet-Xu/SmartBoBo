---
id: bobo-crawl-tool
type: tool
version: 1.0.0
author: 许建波
lang: zh
tags: [采集, 浏览器, 网页抓取]
minAppVersion: 2.1.1
requires: []
---
## 功能介绍

BoBo 采集工具包：通过部署自带的 camoufox 长驻浏览器服务渲染网页并落盘，同时提供把验证码 / 登录墙交给用户处理的人工接管工具，以及右栏"内置浏览器"面板的宿主侧桥接。

## 提供的能力

- `crawl_fetch` — 抓取一个网页，按需同时产出 `html` / `md`（默认）/ `skeleton` 格式；
  - 参数：`url`（必填）、`selector`（CSS 选择器，只取首个匹配）、`outputFormat`（可逗号分隔多格式）、`outFile`（目标文件名）、`saveDir`（保存目录）；
  - 返回：保存路径、HTTP 状态码、实际格式、约 200 字内容预览；多格式时逐个列出路径；
  - 行为：通过本地 Python 引擎渲染页面，服务不可用时自动重启浏览器并重试一次。
- `browser_handoff` — 把共享浏览器里卡住的那一页推到用户右栏"内置浏览器"面板前，停下来等答复；
  - 参数：`reason`（要用户做什么，如"完成滑块验证"）、`note`（补充说明）、可选 `url`（默认不传，保留现场）；
  - 返回：`done` / `skip` / `proxy` / `unknown` 之一，附用户原话、页面 URL 与标题。
- **camoufox 浏览器服务**（包内组件，非模型工具）— 单一采集引擎的长驻服务，随插件实例启动与关闭。
- **`bobo-browser-bridge` 桥接**（`lib/bridge.js`，宿主层挂载）— 注册 `POST /bobo-camoufox/cmd`，转发状态 / 截图 / 鼠标键盘 / 重载等指令。
- **共用浏览器**：`crawl_fetch`、`browser_handoff` 与右栏面板用同一个浏览器与登录态——用户在面板里过的一次验证，后续调用直接受益。

## 适用模式与范围

"适用范围"指**只有挂载了本包的模式才能调用这些工具**，未挂载的模式看不到它们：

- `crawl`（采集模式）：`crawl_fetch` + `browser_handoff`；
- `workflow`（工作流模式）：`crawl_fetch` + `browser_handoff`（批量采集、就地逆向后回批量流程）；
- `empirical`（实证研究模式）：只挂 `crawl_fetch`，作兜底取证器；
- `report`（文献汇报模式）：只挂 `crawl_fetch`，用户给链接时取论文 PDF；
- `reverse`（逆向模式）：只挂 `browser_handoff`（页面分析走 `camoufox-debug` MCP）；
- 右栏内置浏览器面板的桥接由宿主层挂载，对所有模式可用；
- 上游四模式（standard / ptc / minimal / cordis）不挂本包，`requires` 中列出本工具的预设才会带上它。

## 配置项

| 字段 | 默认值 | 说明 |
|---|---|---|
| `pythonBin` | 留空 | Python 解释器路径；留空按包自身位置定位 BoBo 根 `.venv` |
| `scriptsDir` | 留空 | 采集脚本目录；留空定位 `<BoBo根>/scripts` |
| `dataDir` | `''` | 采集目录兜底；留空默认落到调用会话工作区的 `data/` |
| `timeoutMs` | `120000` | 单次采集引擎调用预算（毫秒，须为正整数） |
| `serverStartTimeoutMs` | `60000` | 浏览器服务启动后就绪上报的预算 |
| `proxyFetchTimeoutMs` | `15000` | 单次代理池取 IP 的预算 |

## 注意事项

- **参数细节**：`outFile` 缺扩展名时按 `outputFormat` 自动补（`html`→`.html`、`md`→`.md`、`skeleton`→`.skeleton.txt`）。
- **默认文件名**：未指定 `outFile` 时按 `站点_标题_时间戳.<扩展名>` 自动生成。
- **落盘位置**：按站点键归类到 `<工作区>/<站点键>/data/`；`saveDir` 传绝对路径，目录自动创建。
- **引擎唯一**：只有 camoufox（抗检测、可渲染 JS），没有其它引擎可降级；失败自动重启服务重试一次，仍失败如实报错。
- **代理**：走代理需先 `/proxy` 开启会话代理模式，且 `proxy-pool` 里有可用代理源；池为空时开启会被拒绝。
- **依赖**：采集脚本与浏览器服务依赖 BoBo 根 `.venv` 与 `scripts/`，路径留空即可自动定位；`lib/` 是预编译产物，随仓库分发。
- **生命周期**：浏览器服务归本插件实例所有，会话结束即随实例关闭。
- **权限**：`crawl_fetch` / `browser_handoff` 会启动本机 Python 与浏览器进程，按会话审批策略执行。
- **合规**：请遵守目标网站服务条款与反爬规则，合理控制频率、范围与用途。
