# DeepSeek Harness (dsh) 项目文件夹结构说明

> DeepSeek Harness（dsh）是由 DeepSeek AI 开发的开源 agent harness（智能体框架）。
> 采用"一切皆插件"的架构，由 Cordis 框架驱动。

---

## 1. apps/ — 应用入口

存放可直接运行的应用程序入口，提供用户交互界面。

### 1.1 apps/cli — 命令行界面应用

DeepSeek Harness 的 CLI（命令行界面）应用入口。负责解析命令行参数、加载 agent 预设配置、启动交互式终端会话。支持通过 `dsh web`、`dsh --profile headless` 等命令启动不同模式。包含 agent 预设配置目录（code、cordis、crawl、minimal、standard 等预设），以及命令行参数解析库。

### 1.2 apps/web — Web 界面应用

DeepSeek Harness 的 Web UI（Web 界面）应用入口。提供基于浏览器的交互式聊天界面，支持会话管理、模型选择、设置配置等功能。包含 UI 组件源码、静态资源、快照测试和压力测试。默认运行地址为 `http://127.0.0.1:3080`。

---

## 2. packages/ — 核心包仓库（Monorepo）

项目的核心代码库，采用 monorepo 架构组织。所有 npm 包的 scope 为 `@deepseek-ai/dsh-*`。按功能分组存放在不同子目录中。

### 2.1 packages/core — 核心 API 脊柱

产品 API 的核心骨架，包含会话管理、系统提示词、工具定义、Agent 服务和具体的 agent 循环（agent-loop）。是整个框架最基础的模块，其他所有功能都依赖于此。

### 2.2 packages/api — 远程 API 层

远程 BFF（Backend For Frontend）组装和 Typert RPC 网关。负责处理客户端与服务端之间的 API 通信。

- **packages/api/gateway** — API 网关，处理请求路由和转发
- **packages/api/remotes** — 远程服务调用封装

### 2.3 packages/llm — LLM 能力层

LLM（大语言模型）能力家族：抽象服务定义 + 提供者适配器。负责与 DeepSeek 及其他 LLM 提供商的对接，包括模型调用、流式响应、Token 计数等功能。

### 2.4 packages/session — 会话持久化

持久化会话数据平面：持久化接口 + JSONL/SQLite 后端、投影接口、日志驱动的标题、会话报告。负责会话的创建、存储、恢复和查询。

### 2.5 packages/session-query — 会话查询

会话检索家族：逻辑语料库、有界读取、行 lineage、事件关系、语义过滤和 SQLite 全文搜索。提供对会话历史的高效查询能力。

### 2.6 packages/context — 请求上下文

模型可见的请求上下文，包括工作区指令和时间上下文。为每次 LLM 请求提供必要的环境信息。

### 2.7 packages/subagent — 子代理

子代理能力家族：提供者注册表契约和模型面向的委托工具。支持主代理将任务委托给子代理执行。

### 2.8 packages/skill — 技能系统

技能能力家族：提供者注册表、本地提供者和模型面向的目录/加载器。支持可扩展的技能插件系统。

### 2.9 packages/web — Web 能力

Web 能力家族：搜索/提供者实现和模型面向的 Web 工具。支持网页搜索、内容获取等 Web 交互功能。

### 2.10 packages/fs — 文件系统能力

文件系统能力家族：接口、本地实现、模型面向的文件工具、bash 支持的发现工具。提供文件读写、搜索、目录浏览等文件系统操作。

### 2.11 packages/shell — Shell 能力

Bash 能力家族：执行器接口、本地实现、模型面向的工具。支持 Bash 命令的执行和管理。

### 2.12 packages/terminal — 终端持久化

持久化 PTY 能力家族：所有者作用域的会话、本地实现和模型面向的工具。支持持久化终端会话，跨多次交互保持状态。

### 2.13 packages/subprocess — 子进程管理

子进程能力家族：服务定义 + 本地进程树提供者。管理子进程的创建、监控和回收。

### 2.14 packages/sandbox — 沙箱隔离

进程隔离接口：bwrap/Landlock/Seatbelt 后端。提供安全的代码执行沙箱环境。

### 2.15 packages/lsp — 语言服务器协议

LSP 能力家族：接口、通用 stdio 提供者和 `lsp` 工具。支持语言服务器协议集成，提供代码补全、定义跳转等功能。

### 2.16 packages/code-runtime — 代码运行时

代码执行能力家族：服务定义 + 工作线程提供者 + Code Mode 消费者。支持代码的在线执行和调试。

### 2.17 packages/compaction — 上下文压缩

压缩能力家族：服务定义 + 基础提供者 + 命令消费者。在对话过长时自动压缩上下文以节省 Token。

### 2.18 packages/goal — 目标管理

同会话目标持久化和生命周期管理。支持创建、跟踪和完成目标。

### 2.19 packages/plan — 计划模式

计划协作状态，支持直接输入命令和审查退出。让 Agent 在执行复杂任务前先制定计划。

### 2.20 packages/todo — 待办事项

模型面向的 `todo_write` 工具。支持 Agent 管理待办事项列表。

### 2.21 packages/workflow — 工作流

工作流接口、工作线程引擎和模型面向的 `workflow`/`ralph` 工具。支持复杂工作流的编排和执行。

### 2.22 packages/jobs — 后台任务

通用后台任务运行时和模型面向的 `job_*` 控制工具。支持长时间运行任务的后台执行和管理。

### 2.23 packages/schedule — 调度系统

会话本地的定时跟进支持。支持创建定时任务和提醒。

### 2.24 packages/attachment — 附件管理

持久化附件标识、验证、本地内容寻址存储。管理对话中的文件附件。

### 2.25 packages/spill — 溢出存储

溢出能力家族：存储接口、本地实现、工具结果溢出策略。当工具结果过大时，将其溢出到磁盘存储。

### 2.26 packages/preset — 预设配置

每会话 Agent 组合，从预设的 cordis.yml 文件加载。支持不同场景的预设配置。

### 2.27 packages/bundle — 可安装的配置包

可安装的 `dsh --profile` 补丁层。将多个插件打包为可安装的配置包。

### 2.28 packages/extensions — 自我修改

Agent 运行时自我修改：实时插件/服务检查和模型编写的插件挂载/卸载。让 Agent 能够动态修改自身行为。

### 2.29 packages/guard — 循环卫生

循环卫生守护：建议性重复调用提醒 + `tools/execute` 期限执行器。防止 Agent 陷入无限循环。

### 2.30 packages/hooks — Hook 桥接

Hook 桥接 + 共享的 Claude Code / Codex 线协议库。支持与其他 Agent 框架的集成。

### 2.31 packages/interaction — 人机协作

人机协作平面：审批/交互接口、权限预设、命令、ask-user 工具。处理 Agent 与用户之间的交互确认。

### 2.32 packages/identity — 身份管理

共享的匿名身份管理。为每个用户提供唯一的匿名标识。

### 2.33 packages/settings — 用户设置

用户设置接口 + 文件后端提供者。管理用户的个性化配置。

### 2.34 packages/credentials — 凭证管理

凭证引用接口 + env-over-.env 提供者。安全地管理 API 密钥等敏感凭证。

### 2.35 packages/storage — 通用存储

非会话存储中心 + 后端 + 领域表单。提供通用的键值存储能力。

### 2.36 packages/workspace — 工作区

工作区实体管理。管理 Agent 的工作目录和项目上下文。

### 2.37 packages/acp — ACP 服务器

自动化专用的 Agent Client Protocol 服务器。提供程序化的 Agent 交互协议。

### 2.38 packages/sdk — SDK

进程外运行时 SDK：JSON-RPC 协议、TypeScript 客户端和服务器插件。支持通过 SDK 在外部程序中驱动 Agent。

### 2.39 packages/boot — 启动引导

共享的应用启动引导粘合层。负责应用的初始化和启动流程。

- **packages/boot/app-boot** — 应用启动核心逻辑
- **packages/boot/cmdline** — 命令行启动逻辑

### 2.40 packages/client — Web 客户端

Web GUI 浏览器端：shell、wire、对象服务、插件槽、`ui-*` 插件。包含所有 Web UI 的前端组件。

- **packages/client/web** — Web 基础客户端
- **packages/client/web-react** — React 集成
- **packages/client/runtime** — 客户端运行时
- **packages/client/connection** — 连接管理
- **packages/client/locale** — 国际化
- **packages/client/ui-*** — 各类 UI 组件（conversation、sidebar、tool、settings、theme 等）

### 2.41 packages/host — Web 主机端

Web GUI 主机端半：API 网关 + HTTP 路由服务器。处理 Web 客户端的 HTTP 请求。

### 2.42 packages/examples — 示例包

演示包（agent-spine + CLI/ACP/JSON-RPC 二进制文件叶子加载）。提供各种使用场景的示例。

### 2.43 packages/test-support — 测试支持

支持基础设施（测试工具包、不变量检查、重放、Loader 冒烟测试）。为测试提供通用工具。

### 2.44 packages/util — 工具库

零依赖的底层工具库，跨组共享（`Branded<B>`、Harness home/path 辅助函数、超时、保留策略）。

### 2.45 packages/typert — 类型图生成

类型图生成、产物加载和运行时注册表。为工具提供类型安全的定义和验证。

### 2.46 packages/e2b — E2B 集成

E2B 提供者（Proof of Concept）。集成 E2B 沙箱服务。

### 2.47 packages/feedback — 反馈系统

人类反馈收集和处理。支持用户对 Agent 输出进行评价。

---

## 3. vendor/ — 源码供应商

存放 Cordis 框架及其基础库的源码副本。将这些包直接纳入 monorepo 而非通过 npm 依赖，使框架层完全可控（可审计、可修补、已锁定）。

### 3.1 vendor/cordis — Cordis 框架核心

Cordis 插件系统的核心运行时，提供依赖注入、生命周期管理、事件系统等基础设施。

### 3.2 vendor/cosmokit — 基础工具库

Cordis 生态的基础工具库，提供通用辅助函数。

### 3.3 vendor/schemastery — Schema 验证

Schema 验证库，提供配置和数据的类型安全验证。

### 3.4 vendor/loader — 插件加载器

Cordis 插件加载器，负责从配置文件加载和管理插件。

### 3.5 vendor/include — Include 插件

Cordis Include 插件，支持配置文件的组合和补丁。

### 3.6 vendor/group — Group 插件

Cordis Group 插件，支持插件的分组管理。

### 3.7 vendor/timer — Timer 插件

Cordis Timer 插件，提供定时器服务。

### 3.8 vendor/hmr — HMR 插件

Cordis HMR（热模块替换）插件，支持开发时的代码热更新。

### 3.9 vendor/logger-console — 日志插件

Cordis Console Logger 插件，提供控制台日志输出。

---

## 4. python/ — Python SDK

用于以子进程方式驱动 DeepSeek Harness 的 Python 包。客户端 SDK 通过 stdio 使用按行分隔的 JSON-RPC 与内置运行时通信。

### 4.1 python/sdk — Python SDK 核心

高层轮次 API 与低层 JSON-RPC 客户端。提供 `deepseek-harness-sdk` 分发包，模块名为 `deepseek_harness`。

### 4.2 python/sdk-runtime — Python 运行时

内置运行时二进制与默认 Agent 配置。提供 `deepseek-harness-runtime-bin` 分发包，模块名为 `deepseek_harness_runtime`。

---

## 5. native/ — 原生插件

存放需要编译的原生 Node.js 插件。

### 5.1 native/landlock-run — Landlock 沙箱启动器

基于 [Landlock](https://landlock.io/) 的「先限制自身、再执行」启动器，用于在 Linux 上限制子进程的安全边界。用约 300 行 C11 编写，与 musl 静态链接。支持 linux-x64 和 linux-arm64 平台。提供文件系统访问控制，确保不可信命令在允许的目录范围内执行。

---

## 6. examples/ — 可运行示例

展示 DeepSeek Harness 主要接口和扩展点的可运行演示。

### 6.1 examples/acp-agent — ACP 自动化服务器

面向程序化客户端的 ACP（Agent Client Protocol）自动化服务器，支持会话、权限和取消操作。包含丰富的快照测试用例。

### 6.2 examples/headless-agent — 无头 Agent

非交互式 Agent：接受一项任务并运行，然后以机器可读或人类可读格式输出结果。适用于自动化任务执行。

### 6.3 examples/jsonrpc-agent — JSON-RPC Agent

由 Python SDK 和 JSON-RPC 驱动的无人值守编码 Agent。支持通过 JSON-RPC 协议进行远程控制。

### 6.4 examples/mcp-memory — MCP 记忆

通过通用 MCP 客户端连接受支持第三方记忆服务器的可选 overlay。支持 Agent 的长期记忆存储。

### 6.5 examples/web-cordis — Cordis 自指 Agent

能够检查并更改内存中 Cordis 插件树的自指 Agent。展示了框架的自我修改能力。

### 6.6 examples/web-schedule — Web 定时任务

用于持久、仅限 Session 内提醒的可选 Web overlay。支持延时提醒和绝对时间提醒。

---

## 7. docs/ — 项目文档

存放项目架构、开发指南、API 文档等各类文档。

### 7.1 docs/architecture.md — 架构文档

项目的整体架构设计文档，描述各模块之间的关系和设计原则。

### 7.2 docs/development.md — 开发指南

面向开发者的环境搭建、构建、测试指南。

### 7.3 docs/cookbook — 实用手册

包含各种实用操作指南，如添加新插件、添加新工具、添加新的 vendor 包等。

### 7.4 docs/cordis-api — Cordis API 文档

Cordis 框架的 API 参考文档。

### 7.5 docs/cordis-tutorial — Cordis 教程

Cordis 框架的入门教程。

### 7.6 docs/subsystems — 子系统文档

各子系统的详细设计文档。

### 7.7 docs/postmortem — 事后分析

项目重大问题的事后分析报告和经验总结。

### 7.8 docs/i18n — 国际化文档

翻译规则、术语表等国际化相关文档。

### 7.9 docs/user — 用户文档

面向终端用户的使用指南。

- **docs/user/guide** — 使用指南
- **docs/user/develop** — 开发者文档（基础、框架、实践）

---

## 8. scripts/ — 构建脚本

存放构建、检查、生成、发布等各类脚本。包括类型检查、代码覆盖率检查、文档同步、npm 发布、翻译配对、vendor 同步等功能。

---

## 9. website/ — 文档站点

基于 VitePress 构建的项目文档网站。将 `docs/` 中的部分文档投影为可在浏览器中浏览的站点。

---

## 10. .agents/ — Agent 工作流

存放 Agent 工作流定义和 Agent Notes（设计决策记录）。

### 10.1 .agents/skills — Agent 技能

定义 Agent 可以使用的技能，包括代码审查、文档同步、翻译、推送前检查等。

### 10.2 .agents/notes — Agent Notes

设计决策和架构变更的记录文档。

- **.agents/notes/proposed** — 提议中的设计
- **.agents/notes/implemented** — 已实现的设计
- **.agents/notes/archived** — 已归档的设计
- **.agents/notes/rejected** — 被拒绝的设计

---

## 11. .github/ — GitHub 配置

GitHub 仓库的配置文件。

### 11.1 .github/workflows — CI/CD 工作流

GitHub Actions 的持续集成和部署工作流定义。

### 11.2 .github/ISSUE_TEMPLATE — Issue 模板

GitHub Issue 的创建模板。

### 11.3 .github/issue-management — Issue 管理

Issue 标签、分类等管理配置。

---

## 12. 其他顶层目录

### 12.1 assets/ — 静态资源

存放项目使用的静态资源文件，如社区二维码图片等。

### 12.2 patch/ — 依赖补丁

存放针对第三方依赖的补丁文件（如 `web-acquisition.yml`）。

### 12.3 patches/ — pnpm 补丁

pnpm 管理的依赖补丁文件（如 `node-pty` 补丁）。
