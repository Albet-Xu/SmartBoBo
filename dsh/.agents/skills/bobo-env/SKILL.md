---
name: bobo-env
description: 读取 BoBo 全局环境清单（dbx-runtime/env-manifest.json），一次性给出爬虫/逆向/工作流模式用到的全部运行环境位置：python 解释器、scripts、数据库数据目录、代理池配置、常驻浏览器服务、Camoufox 浏览器二进制状态。当你要运行 Python 采集/逆向/提取脚本、要使用 camoufox 或代理或数据库时，先加载本技能读清单，按清单给出的路径行事，不要自行搜索、猜测或重新安装 camoufox。
---

# bobo-env —— BoBo 全局环境清单

本技能让模型在任意模式**一次性拿到爬虫相关工具的全部位置**，免去每次费力搜索 python / camoufox / 代理 / 数据库在哪，也避免误触发 camoufox 重新下载。

## 什么时候用

当你要执行或生成涉及以下任一项的 Python 脚本 / 工具调用时，**先加载本技能并读取清单**：

- 运行 Python 采集 / 逆向 / 提取入库脚本（`<工作区>/<站点键>/crawl_script/*.py`、`<工作区>/<站点键>/extraction_scripts/*.py`、`scripts/*.py`）；其中**站点键 = 域名去 www. + 点转横线**（如 news.qq.com→news-qq-com）。
- 使用 Camoufox 浏览器 / 常驻浏览器服务；
- 使用代理池（`/proxy`）定位其配置；
- 定位数据库连接数据目录（dbx-runtime/data）或目标网站逆向脚本目录。

## 清单文件位置

清单由启动脚本在每次启动时**幂等刷新**，路径固定为：

```
<BoBo根目录>/dbx-runtime/env-manifest.json
```

- **BoBo 根目录**：环境变量 `BOBO_ROOT` 指向的目录；或含 `dbx-runtime` 子目录的目录；常见如 `E:/SmartBoBo`、`D:/SmartBoBo`、`~/SmartBoBo`。
- 定位方法：优先读 `BOBO_ROOT` 环境变量；否则在文件系统中找含 `dbx-runtime` 的目录。生成提取脚本时也可参考 db-extraction 技能的 `find_bobo_root`。

## 如何读取清单

用文件系统 / 读取工具直接读上述 JSON 文件。关键字段含义：

| 字段 | 含义 / 用法 |
|---|---|
| `pythonBin` | BoBo 虚拟环境 Python 解释器绝对路径（Windows 为 `.venv\Scripts\python.exe`）。**运行任何采集/提取脚本都用它**，保证有 camoufox / lxml / pymysql 等依赖。 |
| `scriptsDir` | 采集/调试脚本目录（browser_server.py、proxy_pool.py、run_*.py 等）。 |
| `dbxDataDir` | DBX 数据库连接数据目录（dbx-runtime/data，含 dbx.db）。提取脚本 `CONFIG.dbx_data_dir` 填这里。 |
| `crawlScriptDir` | 已沉淀的网站逆向脚本目录。**按站点归类在 `<工作区>/<站点键>/crawl_script/`**（站点键 = 域名去 www. + 点转横线），批量采集时优先复用；BoBo 根 `crawl_script/` 仅为历史/示例存量。 |
| `proxyPoolConfig` | 代理池配置所在的 settings.yaml 路径与命名空间；用 `/proxy` 命令会话级开关。 |
| `browserServer` | 常驻 Camoufox 浏览器服务的回环地址、端口派生规则与协议。浏览器由插件/工具自动拉起并常驻复用，**不要自行再启动新的 camoufox 进程**。 |
| `camoufox` | 浏览器二进制就绪状态：`ready`（是否就绪）、`version`、`home`（缓存目录）、`executable`（可执行文件绝对路径）、`error`。 |

## 硬规则

1. **路径以清单为准**：涉及上述工具的调用，一律用清单里给出的绝对路径，**不要自行搜索、猜测、或者沿用记忆里可能过期的路径**。
2. **不要重新安装/下载 camoufox**：camoufox 浏览器二进制已在本机就绪（清单 `camoufox.ready` 应为 `true`）。**绝不运行** `camoufox fetch`、`pip install camoufox` 或任何联网下载流程。
3. **若清单 `camoufox.ready` 为 `false`**（浏览器二进制缺失）：**不要自动下载**；通知用户先运行受控预铺命令再继续：
   ```
   <pythonBin> scripts/gen_env_manifest.py --ensure-camoufox
   ```
   或重启 BoBo（启动脚本会自动预铺）。
4. **常驻浏览器服务**：采集走既有 `crawl_fetch` 工具，浏览器由工具自动拉起并复用，勿手写新浏览器启动逻辑。

## 与其它技能的关系

- 生成提取入库脚本的其他骨架、字段确认详见 `db-extraction` 技能。
- 逆向生成爬虫脚本模板详见 `reverse-crawler` 技能。
- 本技能只负责「环境全局申明」，不替代上述业务技能。