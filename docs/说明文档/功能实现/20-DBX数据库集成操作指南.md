# 20-DBX 数据库集成操作指南

> 在 BoBo 左侧导航栏新增“数据库”入口，点击后应用内嵌 DBX Web 面板，
> 支持 90+ 种数据库的连接、查询、管理。本指南记录本次集成方式与后续运维步骤。

## 1. 功能概述

- 导航栏（折叠态 / 展开态）在“搜索”附近新增“数据库”图标。
- 点击“数据库”在 BoBo 内打开一个全屏覆层面板，内嵌本地 DBX Web 服务页面
  （`http://localhost:4224`）。
- DBX 服务由项目启动脚本自动拉起（也可手动启动），连接配置保存在
  `dbx-runtime/data`。

## 2. 集成架构

```
+----------------------------- BoBo 前端 (React / dsh) ------------------------------+
|  左侧导航栏 (ui-workspace/WorkspaceBrowser)                                          |
|    └─ “数据库”按钮 → 全屏 overlay → <iframe src="http://localhost:4224">             |
+---------------------------------------------+----------------------------------------+
                                              | HTTP (iframe)
+---------------------------------------------v----------------------------------------+
|                          DBX Web 服务 (dbx-web, Rust + Vue)                          |
|      dbx-web.exe  (cargo build --release -p dbx-web --no-default-features)           |
|      DBX_STATIC_DIR = dbx-runtime/dist      (Vue 前端构建产物)                       |
|      DBX_DATA_DIR   = dbx-runtime/data      (连接配置 / sqlite 等数据)               |
|      DBX_PORT       = 4224 (默认)          DBX_DISABLE_PASSWORD = 1 (免密码)         |
+--------------------------------------------------------------------------------------+
```

- BoBo 只负责“入口 + 内嵌面板”，数据库能力完全复用于 DBX 官方 Web 代码库（Apache-2.0）。
- DBX Web 未设置 `X-Frame-Options` / CSP `frame-ancestors`，可被 iframe 内嵌；面板同时
  提供“在新标签页打开”兜底。

## 3. 本次前端改动清单（BoBo/dsh）

| 文件 | 改动 |
| --- | --- |
| `packages/client/ui-primitives/src/icons/index.tsx` | 新增 `IconDatabaseOutline16`（经典数据库圆柱图标），随包的 `icons/index` 一并导出 |
| `packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx` | 新增 `DBX_WEB_URL` 常量、`dbxOpen` 状态；折叠态在“搜索”下方加入“数据库”36px 按钮；展开态在搜索框右侧的 `headerActions` 加入 28px 按钮(与同排图标同用 `gap:4px`)；渲染全屏 DBX 面板 overlay |
| `packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css` | 新增 `.rail .database` / `.rail .databaseButton`（折叠态 36×36 + 底部 12px）与 `.dbxBackdrop/.dbxPanel/.dbxBar/.dbxFrame/...` 面板样式（复用 `--dsw-alias-bg-mask-1`、`--dsw-alias-bg-layer-2`、`--dsw-shadow-lv3` 等语义 token）；`headerActions` 最大宽度 60px→92px 以容纳第 3 个图标 |
| `packages/client/ui-workspace/src/client/locales.ts` | 新增 `database.label`、`dbx.panel.title`、`dbx.openTab`、`dbx.hint` 中英文案 |

> 语义 token 与 slot 规范遵循 `packages/client/AGENTS.md`；中文产品文案、英文代码注释。

### 按钮位置（与需求对应）

- 折叠态 rail 从上到下：打开侧边栏 / 新建会话 / 添加工作区 / **搜索** / **数据库**。
- 展开态 wide：搜索框右侧为“数据库 / 视图选项 / 添加工作区”图标，间距 `gap: 4px`，
  与同排图标一致。

## 4. DBX 运行时准备（一次性构建）

DBX 独立于 BoBo 的 pnpm/Rust 工作区，单独构建后复制成自包含的 `dbx-runtime/`。
源码位于 `E:/SmartBoBo/github project/dbx-main`。

### 4.1 前置依赖

- **Rust 工具链**：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable`
  （本机已装 gnu 工具链 1.98.0）。
- **Node ≥ 22 + pnpm**：DBX 使用 pnpm workspaces（已装 pnpm 10.27）。

### 4.2 前端 dist

```bash
cd "e:/SmartBoBo/github project/dbx-main"
pnpm install            # 首次依赖安装（约 6 分钟）
pnpm build              # Vite 构建 → 输出到 dbx-main/dist（约 19MB）
```

### 4.3 Rust 后端二进制

```bash
cd "e:/SmartBoBo/github project/dbx-main"
# 默认 features 含 DuckDB/DynamoDB/MQ 管理/SQLCipher，编译较重；
# 本次使用 --no-default-features 加速（覆盖 MySQL/PostgreSQL/SQLite/Redis/MongoDB
# 等核心驱动）。如需完整能力，去掉该参数全量编译。
cargo build --release -p dbx-web --no-default-features
# 产物：dbx-main/target/release/dbx-web.exe
```

> `--no-default-features` 不包含：DuckDB sidecar、DynamoDB、MQ 管理(Pulsar/Kafka/RocketMQ)、
> SQLite SQLCipher 加密。其余 90+ 驱动中由 Agent/JDBC 提供的能力仍可用。

### 4.4 组装自包含运行目录

```bash
cd "e:/SmartBoBo/BoBo"
mkdir -p dbx-runtime/dist dbx-runtime/data
cp "e:/SmartBoBo/github project/dbx-main/target/release/dbx-web.exe" dbx-runtime/
cp -r "e:/SmartBoBo/github project/dbx-main/dist/." dbx-runtime/dist/
```

`dbx-runtime/` 已在 `BoBo/.gitignore` 中忽略（本地构建产物，不入库）。

## 5. 启动方式

### 5.1 自动启动（推荐）

`启动.cmd`（Windows）/ `启动.sh`（Linux/macOS）已增加 DBX 拉起逻辑：
- Windows：`start "BoBo DBX (http://localhost:4224)" "%BOBO_ROOT%\dbx-runtime\dbx-web.exe"`，在独立窗口运行。
- Unix：后台运行并输出 pid，日志写 `dbx-runtime/dbx-web.log`。
- 若 `dbx-web` 二进制缺失则给出提示但**不阻塞** BoBo 启动。

环境变量：`DBX_STATIC_DIR`、`DBX_DATA_DIR`、`DBX_PORT=4224`、`DBX_DISABLE_PASSWORD=1`。

### 5.2 手动启动

```bash
cd "e:/SmartBoBo/BoBo/dbx-runtime"
DBX_STATIC_DIR="$(pwd)/dist" DBX_DATA_DIR="$(pwd)/data" \
DBX_PORT=4224 DBX_DISABLE_PASSWORD=1 ./dbx-web.exe
# 浏览器访问 http://localhost:4224 可独立使用 DBX
```

## 6. 使用

1. 启动 BoBo（`启动.cmd` / `启动.sh`）。
2. 左侧导航栏看到“数据库”图标：
   - 折叠态在“搜索”正下方；展开态在搜索框右侧。
   - 若默认侧边栏为折叠，点侧边栏“打开”按钮可见展开态。
3. 点击“数据库”打开内嵌 DBX 面板；右上角“在新标签页打开”可脱离内嵌独立使用。
4. 在 DBX 中点击“新建连接”选择数据库类型并填写连接信息，即可在 BoBo 内直接查询/管理。

## 7. 常见问题

| 问题 | 处理 |
| --- | --- |
| 面板空白 / 提示无法加载 | 确认 DBX 服务已启动（`启动.cmd` 是否出现 DBX 窗口，或 `http://localhost:4224` 是否可访问）；未启动时先手动启动见 5.2 |
| 端口 4224 被占用 | 修改 `启动.cmd/启动.sh` 的 `DBX_PORT`，并同步改 `WorkspaceBrowser.tsx` 中 `DBX_WEB_URL` 端口 |
| 需要 DuckDB / 消息队列等完整能力 | 去掉 `--no-default-features` 全量 `cargo build --release -p dbx-web` 后重新复制二进制 |
| DBX 连接配置丢失 | 连接保存在 `dbx-runtime/data`；删除该目录会清空已存连接 |
| 前端修改不生效 | 在 `BoBo/dsh` 重新构建：`pnpm run build:lib:host` 与 `pnpm exec tsdown --env.DSH_BUILD_FACE client`，或直接 `pnpm run build:lib`，再重启 |

## 8. 相关文件

| 文件 | 用途 |
| --- | --- |
| `BoBo/dbx-runtime/` | DBX 自包含运行目录（二进制/dist/data，已 gitignore） |
| `BoBo/启动.cmd` / `启动.sh` | 启动时拉起 DBX 服务 |
| `BoBo/dsh/packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx` | “数据库”按钮与内嵌面板（`DBX_WEB_URL` 在此调整） |
| `E:/SmartBoBo/github project/dbx-main` | DBX 官方源码库（构建来源） |