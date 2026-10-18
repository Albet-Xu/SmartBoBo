---
id: bobo-proxy-tool
type: tool
version: 1.0.0
author: 许建波
lang: zh
tags: [代理, 采集, 设置]
minAppVersion: 2.1.1
requires: []
---
## 功能介绍

代理命令工具包：提供会话级的 `/proxy` 开关命令、承载代理池配置的 `proxy-pool` 设置 profile 条目和 `proxyMode` 会话状态投影——开启后，采集类工具的请求改走代理池取到的出口 IP。

## 提供的能力

- `/proxy`（命令）— 开关当前会话的代理模式；
  - 裸 `/proxy` 或 `/proxy on` 为开启、`/proxy off` 为关闭，状态幂等；
  - 命令后面可以直接带后续指令（如 `/proxy 抓一下 https://…`），先切状态、再把内容作为普通用户消息转给模型处理；
  - 池不可用时开启会被拒绝，并回落到关闭状态，不会带着必失败的代理去采集。
- `proxy-pool`（设置 profile 条目）— 代理池字段（代理源、取 IP 策略、总开关、重试与超时）是该条目 Config 的 `.volatile()` 字段，在设置页经 settings 表单读写、随 profile 的 Cordis patch 持久化；宿主层挂一份，所有模式共用；
  - 源条目字段：`name`（名称）、`apiUrl`（取 IP 接口地址）、`enabled`（是否启用）；
  - 总开关与会话开关分层：池开着，单个会话仍可不开代理。
- `proxyMode`（会话投影）— 把会话日志里最后一条 `proxy/enabled` 事件折成"当前是否开代理"，供采集工具读取；日志里没有事件即为关闭。
- **对模型侧无新工具**：本包注册的是命令 / 设置 / 投影，模型看不到 `mcp__…` 形式的新工具；`crawl_fetch` 等工具读取会话代理状态决定是否走代理。

## 适用模式与范围

"适用范围"指哪些模式挂载了本包——未挂载的模式里 `/proxy` 命令不存在：

- 挂 `/proxy` 命令（预设内 `namespace: false` / `projection: false`，只挂命令）：`crawl`、`reverse`、`workflow`、`empirical`、`report`；
- 宿主层另挂一份（`command: false`，条目 id 为 `proxy-pool`，提供设置表单与投影），供设置页配置代理池、对所有模式生效；
- `modeling` / `review` / `experiment` 与上游四模式不挂命令——它们没有采集需求；
- `requires` 中列出本工具的预设才会带上 `/proxy`；设置展示策略与投影属宿主单例，不由预设重复注册。

## 配置项

| 字段 | 默认值 | 说明 |
|---|---|---|
| `sources` | `[]` | 代理源列表，每项含 `name`、`apiUrl`（取 IP 接口地址）、`enabled` |
| `fetchStrategy` | `cache` | 取 IP 策略：`cache` 批量取后轮换 / `realtime` 每次请求现取 |
| `enabled` | `false` | 代理池总开关（与会话 `/proxy` 是两层开关） |
| `maxRetries` | `3` | 单次请求放弃前的最大重试次数 |
| `timeoutMs` | `30000` | 单次请求超时（毫秒） |
| `namespace` | `true` | 本实例是否拥有 `proxy-pool` 条目的设置页展示策略（宿主实例为 true，预设实例为 false） |
| `projection` | `true` | 本实例是否注册 `proxyMode` 会话投影 |
| `command` | `true` | 本实例是否注册 `/proxy` 命令 |

## 注意事项

- **池空防呆**：没有启用且 `apiUrl` 非空的源时，`/proxy on` 被拒绝并提示"代理池没有可用代理，退出代理模式"。
- **状态按会话**：开关只影响当前会话，取会话日志里最后一条 `proxy/enabled`；新会话默认关闭。
- **与采集工具的关系**：`crawl_fetch` 与逆向模板脚本（`--proxy`）读取该状态，走 `scripts/proxy_pool.py` 取 IP、轮换与重试。
- **脚本侧行为**：代理连续重试全部失败时，脚本打印提示并以退出码 3 结束，由 AI 询问你是否改走本地网络。
- **单例约束**：`proxy-pool` 条目的设置展示策略与 `proxyMode` 投影各只能由宿主注册一次，预设实例必须关掉对应开关，否则挂载失败。
- **设置落点**：代理池配置存在 `proxy-pool` profile 条目的 volatile Config 里（活跃 profile 的 `cordis.patch.yml`），可在设置页随时编辑；预设实例与采集工具通过 settings 服务的 describe 投影读同一份现值，不读自己的配置默认值。
- **命令参数**：`/proxy [on|off] [其余内容]`——其余内容原样转给模型处理，不会被命令吞掉。
- **对模型无副作用**：本包不向模型工具目录添加新工具，开关前后工具清单不变。
- **状态可回放**：开关变化以 `proxy/enabled` 事件写入会话日志，任何时刻都能从日志重放状态。
- **关闭后回落**：`/proxy off` 之后，本会话的采集回落到本地网络。
- **权限**：本包只注册命令与设置，不执行网络请求；实际走代理的请求由采集工具发起，按其审批策略执行。
