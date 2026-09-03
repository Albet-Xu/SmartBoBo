# BoBo 智能采集平台修改总览

## 1. 项目概述

BoBo 是一个智能采集平台，基于 DeepSeek Harness 构建，集成了多种采集引擎（Camoufox、Scrapling、Crawl4ai），提供智能化的网页采集功能。

## 2. 修改内容汇总

### 2.1 环境配置修改

**文档位置**: `环境配置/01-UV环境重构说明.md`

**修改内容**:
- 将 Python 环境从手动 `venv/` 迁移到 UV 标准管理
- 创建 `pyproject.toml` 配置文件
- 创建 `.python-version` 文件指定 Python 3.13
- 更新 `.gitignore` 忽略 `.venv/` 目录
- 更新所有路径引用从 `venv` 到 `.venv`
- 删除旧的 `venv/` 目录

**关键文件**:
- `BoBo/pyproject.toml` - 项目配置
- `BoBo/.python-version` - Python 版本
- `BoBo/uv.lock` - 依赖锁定
- `BoBo/.gitignore` - Git 忽略配置

### 2.2 前端品牌替换

**文档位置**: `前端修改/02-前端品牌替换说明.md`

**修改内容**:
- 小鲸鱼图标 → 小菠萝图标
- "deepseek" → "SmartBoBo"
- "HARNESS" → "AGENT"
- "探索未至之境" → "万物皆可得"
- 删除 "预览版" badge
- 更新页面标题、PWA 清单、网站图标

**关键文件**:
- `BoBo/dsh/packages/client/ui-primitives/src/FishLogo.tsx` - 菠萝图标
- `BoBo/dsh/packages/client/ui-primitives/src/BrandWordmark.tsx` - 品牌文字
- `BoBo/dsh/packages/client/ui-conversation/src/client/locales.ts` - 本地化
- `BoBo/dsh/packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx` - Hero 组件
- `BoBo/dsh/packages/client/web/src/AppRoot.tsx` - 启动画面
- `BoBo/dsh/apps/web/index.html` - 页面标题
- `BoBo/dsh/apps/web/public/manifest.webmanifest` - PWA 清单
- `BoBo/dsh/apps/web/public/favicon.svg` - 网站图标

### 2.3 采集模式 Agent 预设

**文档位置**: `功能实现/03-采集模式Agent预设说明.md`

**修改内容**:
- 创建采集模式预设配置
- 设计采集专用 Persona 提示词
- 配置采集工具插件
- 实现 URL 自动检测和采集功能

**关键文件**:
- `BoBo/dsh/apps/cli/config/agent-presets/crawl/preset.yml` - 预设元数据
- `BoBo/dsh/apps/cli/config/agent-presets/crawl/agent.cordis.yml` - Agent 配置

### 2.4 采集模式功能实现

**文档位置**: `功能实现/04-采集模式功能实现说明.md`

**修改内容**:
- Node.js 编排层实现
- Python 采集脚本实现
- 多引擎支持
- 错误处理机制
- 结果保存和汇报

**关键文件**:
- `BoBo/dsh/packages/acquisition/tool-acquisition/src/index.ts` - 采集工具插件
- `BoBo/scripts/run_camoufox.py` - Camoufox 引擎
- `BoBo/scripts/run_scrapling.py` - Scrapling 引擎
- `BoBo/scripts/run_crawl4ai.py` - Crawl4ai 引擎

### 2.5 采集逻辑优化

**文档位置**: `功能实现/05-采集逻辑优化说明.md`

**修改内容**:
- HTML 转 Markdown 功能集成
- 默认保存位置优化为当前工作区 data 文件夹
- 集成 html2text 库实现高质量转换
- 支持动态路径获取和用户自定义保存位置

**关键文件**:
- `BoBo/pyproject.toml` - 添加 html2text 依赖
- `BoBo/scripts/run_camoufox.py` - 添加 HTML 转 Markdown 功能
- `BoBo/scripts/run_scrapling.py` - 添加 HTML 转 Markdown 功能
- `BoBo/scripts/run_crawl4ai.py` - 添加 HTML 转 Markdown 功能
- `BoBo/dsh/packages/acquisition/tool-acquisition/src/index.ts` - 支持动态工作区路径

### 2.6 工作流模式 Agent 预设

**文档位置**: `功能实现/21-工作流模式实现与操作指南.md`

**修改内容**:
- 创建工作流模式预设配置
- 采集/爬取关键词 + 网址自动采集，数据落当前工作区 data 文件夹
- 复用内置 DBX 已存连接连库，逐字段向用户确认含义后写入
- 用模板技能 db-extraction 生成提取入库脚本（UPSERT 去重/更新），保存到工作区 extraction_scripts
- 新增数据库驱动依赖 pymysql / psycopg

**关键文件**:
- `BoBo/dsh/apps/cli/config/agent-presets/workflow/preset.yml` - 预设元数据
- `BoBo/dsh/apps/cli/config/agent-presets/workflow/agent.cordis.yml` - Agent 配置（工作流 persona + 采集工具）
- `~/.dsh/skills/db-extraction/{SKILL.md, dbx_connector.py, extraction_template.py}` - 提取入库技能与模板
- `~/.dsh/settings.yaml` - skill-library 登记 db-extraction
- `BoBo/pyproject.toml` - 添加 pymysql / psycopg 数据库驱动

### 2.7 逆向经验沉淀（RAG 记忆增强）

**文档位置**: `功能实现/30-逆向经验沉淀RAG记忆增强操作指南.md`

**修改内容**:
- 逆向模式新增经验记忆库：逆向成功/失败经验按模板自动沉淀为本地 MD + 向量化入服务器 Qdrant
- 逆向新站点前按「域名+标签+语义」混合检索历史案例，避免重复踩坑（RAG 记忆增强）
- 置信度 ≥1.8 才入库，<1.8 直接放弃；采纳反馈成功 +0.5 / 失败 −0.5，跌破 1.8 自动出库归档
- 工作流模式只读访问经验库（服务端不注册写工具，硬约束）
- 服务器部署 Qdrant Docker（数据卷 `/home/idata/Qdrant`，API Key 认证）

**关键文件**:
- `BoBo/dsh/apps/cli/config/agent-presets/reverse/agent.cordis.yml` - 逆向预设（mcp-reverse-memory 读写实例 + persona RAG 段落）
- `BoBo/dsh/apps/cli/config/agent-presets/workflow/agent.cordis.yml` - 工作流预设（mcp-reverse-memory 只读实例 + persona 只读段）
- `BoBo/dsh/.agents/skills/reverse-experience/` 与 `~/.dsh/skills/reverse-experience/` - 技能（SKILL.md / log_template.md / memory_store.py）
- `BoBo/scripts/reverse_memory_server.py` - reverse-memory MCP server
- `BoBo/pyproject.toml` - 添加 fastembed / qdrant-client
- `~/.dsh/settings.yaml` - skill-library 登记 reverse-experience
- `BoBo/bobo-data/reverse-experience/` - 经验数据目录（MD 日志 + registry，gitignore）

### 2.8 目录化归类 + Camoufox 默认 + 增量更新（manifest）

**文档位置**: `功能实现/31-目录化归类与增量更新优化操作指南.md`

**修改内容**:
- 采集产物按站点键（域名去 www.）归类：`data/<站点键>/`、`crawl_script/<站点键>/`、`extraction_scripts/<站点键>/`，顶层 `index.md` 登记复用；三个模式（采集/逆向/工作流）persona 统一此规则（`crawl_fetch` 传 `saveDir`）。
- 逆向/工作流生成的需要浏览器能力的爬虫代码默认内置 **camoufox**（模板 `render_html` 内建），禁用 selenium/原生 playwright。
- 增量更新：每站点 `data/<站点键>/manifest.json` 为共享状态源，采集/提取脚本各带 `--incremental`（只处理新增/变化），工作流 persona 新增「七、增量更新」分支与省 token 红线。
- 修复工作流预设 `mcp-dbx` 失效路径 `E:/SmartBoBo/BoBo/...` → `E:/SmartBoBo/...`；补装并登记 `reverse-crawler` 技能。

**关键文件**:
- `dsh/.agents/skills/reverse-crawler/{crawl_template.py,SKILL.md}`（+ 用户级副本补装）
- `dsh/.agents/skills/db-extraction/{extraction_template.py,SKILL.md}`（+ 用户级副本同步）
- `dsh/apps/cli/config/agent-presets/{crawl,reverse,workflow}/agent.cordis.yml`
- `~/.dsh/settings.yaml`、`crawl_script/index.md`（新建）

## 3. 文档结构

```
E:/SmartBoBo/说明文档/
├── 00-BoBo项目修改总览.md              # 本文档
├── 环境配置/
│   └── 01-UV环境重构说明.md            # UV 环境重构详细说明
├── 前端修改/
│   └── 02-前端品牌替换说明.md          # 前端品牌替换详细说明
└── 功能实现/
    ├── 03-采集模式Agent预设说明.md      # 采集模式预设配置说明
    ├── 04-采集模式功能实现说明.md       # 采集模式技术实现说明
    └── 05-采集逻辑优化说明.md          # 采集逻辑优化详细说明
```

## 4. 技术栈

### 4.1 前端技术
- **框架**: React + TypeScript
- **构建**: Vite + tsdown
- **UI 组件**: 自定义组件库
- **状态管理**: Zustand
- **样式**: CSS Modules

### 4.2 后端技术
- **运行时**: Node.js 22+
- **包管理**: pnpm
- **插件系统**: Cordis
- **构建工具**: tsx + tsc

### 4.3 采集引擎
- **Camoufox**: 抗检测浏览器引擎
- **Scrapling**: 轻量级 HTTP 采集
- **Crawl4ai**: LLM 友好的 Markdown 提取

### 4.4 Python 环境
- **版本**: Python 3.13
- **包管理**: uv
- **虚拟环境**: `.venv/`

## 5. 构建和运行

### 5.1 环境准备

```bash
# 1. 安装 Python 依赖
cd E:/SmartBoBo/BoBo
uv sync

# 2. 安装 Node.js 依赖
cd dsh
pnpm install

# 3. 构建前端
pnpm run build:lib:host
```

### 5.2 启动服务

```bash
# 启动 dsh 服务
pnpm bobo
```

### 5.3 验证功能

1. **品牌标识**: 检查页面左上角显示小菠萝图标 + "SmartBoBo" + "AGENT"
2. **采集模式**: 在设置 → Agent 预设中选择"采集模式"
3. **URL 采集**: 在对话中输入包含 URL 的内容，测试自动采集功能

## 6. 注意事项

### 6.1 构建顺序
1. 修改前端代码后必须重新构建才能生效
2. 采集模式预设需要重启服务才能加载

### 6.2 路径配置
- Windows 路径使用正斜杠 `/` 或转义反斜杠 `\\`
- 所有配置使用绝对路径，避免相对路径解析问题

### 6.3 依赖管理
- Python 依赖通过 `uv.lock` 锁定版本
- Node.js 依赖通过 `pnpm-lock.yaml` 锁定版本

### 6.4 测试验证
- 前端修改后运行 `pnpm run test:gui` 验证
- 采集功能修改后运行端到端测试验证

## 7. 扩展建议

### 7.1 功能扩展
- 批量采集功能
- 定时采集任务
- 采集监控面板
- 结果分析工具

### 7.2 引擎扩展
- 自定义采集引擎支持
- 引擎配置优化
- 引擎性能监控

### 7.3 用户体验
- 采集进度实时显示
- 采集结果可视化
- 采集历史管理
- 采集任务调度

## 8. 故障排除

### 8.1 常见问题

**问题**: 前端修改不生效
**解决**: 重新运行 `pnpm run build:lib:host` 构建

**问题**: 采集模式预设不显示
**解决**: 重启 dsh 服务 `pnpm bobo`

**问题**: 采集脚本执行失败
**解决**: 检查 Python 环境和依赖库安装

### 8.2 调试方法

1. **查看日志**: 检查 dsh 服务日志输出
2. **手动测试**: 手动运行 Python 脚本验证
3. **检查配置**: 验证配置文件路径和参数

## 9. 版本记录

### v1.2.0 (2024-08-25)
- 工作流模式 Agent 预设实现
- 采集 + 复用内置 DBX 连库 + 逐字段确认写入的采集入库工作流
- 新增模板技能 db-extraction（提取入库脚本 UPSERT 去重/更新）
- 新增数据库驱动 pymysql / psycopg

### v1.1.0 (2024-08-20)
- 采集逻辑优化完成
- HTML 转 Markdown 功能集成
- 默认保存位置优化为当前工作区 data 文件夹
- 集成 html2text 库实现高质量转换

### v1.0.0 (2024-08-20)
- 初始版本
- UV 环境重构完成
- 前端品牌替换完成
- 采集模式 Agent 预设实现
- 采集模式功能实现完成

## 10. 联系方式

如有问题或建议，请联系项目维护人员。