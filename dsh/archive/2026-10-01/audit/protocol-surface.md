# 协议面白名单（审计豁免） — ponytail-audit

> 用户约束（本轮审计的硬性前提）：
> **协议类方法，就算没用上，也不允许标记为删除**（`useListen`、`useListenIframe`、`useInvoke` 等等）。
> 本文件是 `docs/audit/*` 的**豁免清单**：凡落入下列类别者，即使全仓 0 调用方，也只能写
> `keep:` 或在「Considered and rejected」中说明，**不得**出现在 `net:` 计数里。

## 1. 判定原则

> 「本仓无调用方」≠「死代码」。

协议面的消费者在仓外：dsh 核心 GUI（iframe 内）、第三方 cordis 插件、上游 dsh 版本、以及未来
版本的自己。这些接口先于调用方存在，删除它们等于破坏对外契约。判据：

| 证据 | 结论 |
| :--- | :--- |
| 被 `src/index.ts` / `client/index.ts` / `host/routes/index.ts` 导出 | 协议面，`keep:` |
| 名字出现在 `docs/specs/plugin.*.md` 的示例或命名约定中 | 协议面，`keep:` |
| 注释显式声明「协议 / 先定义好 / 暂无调用方」 | 协议面，`keep:`（本仓已有先例，见 §3.1） |
| 通过字符串通道被引用（事件名、命令名、槽位名、路由 path） | 协议面，`keep:` |
| 仅在仓内实现体之间调用、无导出、无字符串引用 | 才允许 `delete:` |

## 2. 白名单类别

### 2.1 壳层 iframe 桥（`src/hooks/**`）

| 符号 | 文件 | 方向 | 说明 |
| :--- | :--- | :--- | :--- |
| `useListen` | `src/hooks/use-listen.ts:16` | Tauri 事件 → 组件 | 全部 Tauri 事件订阅的统一入口 |
| `useListenIframe` | `src/hooks/use-listen-iframe.ts:38` | 宿主 → iframe | 与 `useInvokeIframe` 成对；注释声明「目前尚无调用方…先按协议定义好」 |
| `useInvoke` | `src/hooks/use-invoke.ts:5` | command 拉取 | 声明式 `invoke` 封装 |
| `useInvokeIframe` | `src/hooks/use-invoke-iframe.ts:61` | iframe → 宿主 | 含 `ALLOWED_INVOKE_CMDS` 白名单（`src/hooks/use-invoke-iframe.ts:39-59`，15 条命令），是**越权防线**，只可增不可减 |
| `useIframeMessage` / `useIframePost` + `IFRAME_HOST_SOURCE` | `src/hooks/use-iframe-message.ts:25`、`src/hooks/use-iframe-post.ts:6,26` | 桥基础设施 | `source`/`origin` 校验的唯一入口；`IFRAME_HOST_SOURCE = 'dsh-desktop'` 是协议标识 |
| `listenParent` / `useListenParent` | `packages/dsh-tauri/src/client/hooks/use-listen-parent.ts:17`、`packages/dsh-tauri/src/client/service/listen-parent.ts` | 宿主 → 插件 | 插件自有协议档位（`ParentMessageTypes`） |

> `ALLOWED_INVOKE_CMDS` 里的每条命令（`get_pet_status`、`remote_bridge_ping`、`open_external_url` …）
> 与 `packages/dsh-tauri-pet/src/client/constants/index.ts` 的 `CMD_*` 一一对应，属于跨包契约。

### 2.2 插件客户端协议（`packages/dsh-tauri/src/client/**`）

- `useListen` / `useInvoke`：`packages/dsh-tauri/src/client/hooks/*.ts`（插件侧版本，签名与壳层版不同，勿合并）。
- `request/` 层：`packages/dsh-tauri/src/client/request/index.ts` + `index.utils.ts` —— dsh 官方 API 的调用契约。
- `controller/`：`packages/dsh-tauri/src/client/controller/index.ts` —— DOM 补丁生命周期托管（规范 3 级退级）。
- 适配器探测：`defineAdapter` / `adapter.has(...)`，实现于 `packages/dsh-tauri/src/client/register/index.adapter.ts`、类型见 `packages/dsh-tauri/src/client/types/adapter.ts`。**能力名即协议**，包括当前无调用方的档位：

  `sessions.list`、`sessions.provideInfo`、`workspaces.list`、`workspaces.create`、`navigation.startSession`、`navigation.addWorkspace`、`navigation.openSession`、`composer.workspace-less`（消费方 `packages/dsh-tauri-ui/src/client/register/hero-workspace.ts:26`、`new-session.ts:23,53`）。

### 2.3 宿主 IPC surface

- **Tauri commands**：`src-tauri/src/bridge/**` 中 14 个文件、共 **97** 处 `#[tauri::command]`；注册点为 `src-tauri/src/bridge/mod.rs`（`generate_handler`）与 `src-tauri/src/desktop/builder.rs`。命令名是跨进程字符串契约，**不得**因子系统改名而删。
- **事件名**：Rust 侧 `.emit(...)` / `emit_to(...)` 的事件字符串 ↔ 前端 `useListen('...')`。含 `pet://status`、`session:create|update|remove|clear`、`preinstall-log`、`setting_updated`、`dsh-notification-clicked` 等。
- **路由 path**：`packages/*/src/host/routes/index.ts`。按 `docs/specs/plugin.baisc.md` 规则，path **不**入常量模块，直接字面量书写；因此不受「常量 0 消费即删」规则约束。
- **能力/权限声明**：`src-tauri/capabilities/**`、插件 manifest 键。
- **槽位名 / `ctx.effect` 标签 / 样式 ID**：`packages/*/src/{client,host}/constants/index.ts`、`src/shared/constants.ts`。

### 2.4 平台/第三方边界

- `@deepseek-ai/dsh-*`、`@tauri-apps/*`、`@heroui/*`、`@reause/core` 的再导出面。
- `src-tauri/vendor/**`（第三方 vendored，仅可注明体量，不审计内部）。
- `archive/` 目录：按 AGENTS.md 禁止读取（本仓根目录当前无此目录；`packages/dsh-tauri-archive` 是**另一个**东西，属正常审计范围）。

## 3. 本仓已有的协议面先例（证据）

### 3.1 `useListenIframe` —— 显式声明的「无调用方协议」

`src/hooks/use-listen-iframe.ts:25-26`：

> 目前尚无调用方（壳层现有的宿主 → iframe 推送仍写在 `layout/components/iframe.tsx` 里），先按协议定义好，新增「Tauri 事件 → iframe」通道时直接复用。

### 3.2 iframe invoke 白名单 —— 安全边界，不是复杂度

`src/hooks/use-invoke-iframe.ts:31-37` 说明白名单用于「防止 iframe 内其他插件借道桥执行任意 Tauri command（越权）」。此类代码即使看起来是「手写的 Set + 分支」，也属于**信任边界校验**，ponytail 规则明确排除（never simplify away input validation at trust boundaries）。

### 3.3 适配器档位探测 —— 退级策略要求

`docs/specs/plugin.baisc.md` 要求「客户端统一通过 `defineAdapter(ctx)` 探测…禁止猜版本」。因此 `adapter.has(...)` 的分支**不能**因「当前版本恒为真/假」而被判定为死分支。

## 4. 使用方法

1. 各分册作者在标注 `delete:` / `yagni:` 前，先对照本文件与 §1 判据。
2. 命中白名单但确有内部冗余时，写法为：
   `keep: <公开符号> 保留；其内部 <X> 可收敛。<replacement>。[path:lines]`
   该行**不计入** `net:`。
3. 存疑时降级为「问句」写入 `## Considered and rejected`，不要计入净收益。
