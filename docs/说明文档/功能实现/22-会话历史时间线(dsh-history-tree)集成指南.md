# 22-会话历史时间线（dsh-history-tree）集成指南

## 一、功能简介

将开源插件 `dsh-history-tree`（DeepSeek Harness 的 Codex 风格对话时间线）集成进本项目的 DSH Web 界面，在会话左侧提供：

- **垂直居中时间线点阵**：每个用户提问对应一个刻度点，不随消息滚动位移。
- **鱼眼波浪放大动效**：鼠标滑过时杠杆式扩散放大。
- **悬浮概览卡片**：显示该轮用户提问、助手最终回复摘要、以及底部元数据（发送时间 · 用时 · Token 吞吐）。
- **点击直达**：点击刻度点或卡片平滑滚动到对应轮次。
- **自动加载更早**：滚到顶或悬停顶部刻度时触发「加载更早」。

> 本指南描述的是一次「源码入库 + 客户端适配」的集成（路线 B），而非仅加一个服务端插件。

## 二、集成方式总览

`dsh-history-tree` 是一个带**前端组件（client 端）**的 DSH **web bundle**，它分为两半：

- `lib/index.js`：host（服务端）空壳插件。
- `lib/client.js`：client（前端）真正生效的部分，负责把时间线渲染进 DSH Web。

关键点：**只加一个 `--patch insert` 服务端插件行是不够的**（那只会加载 host 空壳）；要让前端组件被装载，必须让该 bundle 出现在 web profile 的 `dsh.profile.bundles` 里。本项目采用「源码入库 + 改默认装配模板」的方式，使其在全新机器上开箱即带、可复现。

## 三、代码改动清单

| 路径 | 改动 |
| --- | --- |
| `dsh/packages/bundle/history-tree/` | **新增**。vendor 上游源码（`package.json` / `lib/` / `cordis.patch.yml` / `README` / `LICENSE` / `docs`），包名保留 `dsh-history-tree` 以便后续同步上游。 |
| `dsh/apps/cli/package.json` | 在 `dependencies` 增加 `"dsh-history-tree": "workspace:^"`，使 `healProfilesModuleFallback` 自动将其 link 进 `~/.dsh/profiles/node_modules`，bare name 可被 profile 解析（与采集插件同机制）。 |
| `dsh/packages/boot/app-boot/src/profile.ts` | `PROFILE_TEMPLATES.web` 由 `[dsh-base, dsh-web-app]` 改为 `[dsh-base, dsh-web-app, dsh-history-tree]`，让**新初始化**的 web profile 自动带上该 bundle。 |
| `dsh/packages/bundle/history-tree/lib/client.js` | **适配**到本仓库 fork 前端 DOM（详见第四节）。 |

> 关于「改默认模板」的副作用：会让本 fork 的**所有** web profile 默认加载该 bundle。对本项目（源码运行的私有 fork）可接受；如不希望全局默认，可改用「启动前自动登记 bundle」的引导脚本方式（见第八节）。

## 四、客户端适配说明（为什么必须改）

原 `lib/client.js` 硬编码了 DeepSeek 网页端的**混淆 class 名**（`.Md3f7G_flowItem`、`.pI_x6G_centerCol`、`.Sxvs8a_body`、`.QWLzlG_root`、`.wSkVaW_scrollBody` 等）。本仓库的 DSH Web 前端类名不同，原样接入会因找不到消息流而**不渲染时间线**。

好消息是：本 fork 前端与插件同源，改用它暴露的**稳定的 DOM 属性**即可。适配映射如下：

| 原钩子（死代码） | 本 fork 实际（已采用） |
| --- | --- |
| `.Md3f7G_flowItem / [class*="flowItem"]` | `[data-chat-flow-kind]`（`ChatNodeSeat` 为每个会话节点渲染 `data-chat-flow-kind={node.kind}`） |
| `data-chat-flow-kind` 取值 `user/steering/turn-tail/deliverables/workflow-run` | 直接沿用（本前端取值一致，另有 `assistant-step`/`tool`/`command`/`compaction` 等） |
| `.Sxvs8a_body, …[class*="markdown"]` 取助手回复 | 仅对 `assistant-step` 节点取正文，并排除 `[data-variant="think"]`（推理）与 tool / deliverables |
| `[class*="think"]` 排除思考 | `[data-variant="think"]`（`ReasoningRow` 根元素） |
| `.Md3f7G_scroll / .wSkVaW_scrollBody` 滚动宿主 | `[data-conversation-scroll]` |
| `.Md3f7G_older button` 加载更早 | `[class*="older"] button`（原已含，兼容） |
| `.pI_x6G_centerCol` 中心列 | `[class*="centerCol"]`（CSS module 哈希后可子串命中） |
| 页脚 token 正则 `…tokens/tok`（总 token 数） | 本前端**无总 token 数**，仅有 `tok/s`，正则现读 `tok/s` |

> 若日后升级 DSH 前端或该 bundle 上游，请按上表重新核对 `client.js`，因为 DOM 契约可能变化。

## 五、全新机器复现步骤

```bash
cd <项目根>/dsh
pnpm install        # 安装 workspace（含 dsh-history-tree），生成 heal-link
pnpm bobo           # 启动，首次会自动初始化 web profile（含新 bundle）
```

打开 `http://127.0.0.1:7070`，进入任意包含多轮问答的会话，即可在左侧看到垂直居中的时间线点阵。

## 六、本机迁移说明（已完成）

`initProfile` 是「只写一次」的：已存在的 `~/.dsh/profiles/web` 不会因新模板自动更新。本次已执行：

1. 备份：`~/.dsh/profiles/web` → `~/.dsh/profiles/web.backup.<时间戳>`
2. 删除原 web profile 目录
3. 重新 `pnpm bobo`，按新模板重建，确认 `bundles` 已含 `dsh-history-tree`，且 `heal` 已为 `~/.dsh/profiles/node_modules/dsh-history-tree` 建立链接
4. 验证：`window.__DSH_BOOT__` 客户端名单中出现 `dsh-history-tree` 且 `/plugins/dsh-history-tree/client.js` 可下载（HTTP 200）

> 换机或重装后，若旧机器残留的 web profile 不带新 bundle：备份并删除该目录再启动即可，或参照约八节手动登记。

## 七、使用方式

- 打开一个含多轮消息的会话，左侧出现垂直居中时间线点阵。
- **悬停**任一刻度：鱼眼放大 + 弹出概览卡片（用户提问 / 助手回复摘要 / 时间·用时·tok/s）。
- **点击**任一刻度或卡片：平滑滚动到该轮。
- **滚到顶**或**悬停顶部刻度**：自动触发「加载更早」。

## 八、回退 / 卸载

如要移除该功能，撤销三处改动并还原 profile 即可：

1. `apps/cli/package.json` 移除 `dsh-history-tree` 依赖（并 `pnpm install`）。
2. `packages/boot/app-boot/src/profile.ts` 还原 `PROFILE_TEMPLATES.web`。
3. 删除 `packages/bundle/history-tree/`。
4. 备份并删除 `~/.dsh/profiles/web`，重启后按旧模板重建。

若只是暂时禁用（不卸载），可编辑 `~/.dsh/profiles/web/package.json`，从 `dsh.profile.bundles` 移除 `dsh-history-tree`，或把该 bundle 的 `cordis.patch.yml` 中 `history-tree` 行置 `disabled`（但仅 host 行，前端仍会被注入；彻底停用需从 bundles 移除）。

## 九、已知限制与注意事项

- **适配依赖 DOM 契约**：`client.js` 的适配针对本 fork 前端当前的 `data-*` 属性，升级前端或上游需重验。
- **无总 token 数**：本前端页脚只有 `tok/s`（吞吐），没有每轮总 token。
- **Vendored 纯 JS 包**：该包为第三方、纯 JS / 无 TS / 无测试 / 无 `./invariant`，不遵守 first-party 包约定，`pnpm run hygiene` / `test:coverage` 等门控可能需加白名单；不影响 `pnpm bobo` 运行。
- **性能**：客户端通过 `MutationObserver` 扫 DOM（原插件行为），对前端重渲染频率敏感；观察根目前为 `document.body`，如卡顿可收窄到中心列。
- 该 bundle 为 `platform: web`，只影响 web 面，不影响 headless。