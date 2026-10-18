---
description: "会话级代理控制：/proxy 命令、proxy-pool 设置条目，以及采集工具读取的 proxyMode 投影。"
kind: "package-reference"
---

# bobo-proxy-tool

[English](README.md) | 中文

## 概述

提供会话级的代理控制：开关当前会话的 `/proxy` 命令、承载代理池配置的 `proxy-pool` 设置条目，以及采集工具读取的 `proxyMode` 会话投影。宿主层为所有模式挂一份只提供设置与投影的实例；采集类模式再挂命令实例。池里没有可用源时开启会被拒绝，而不是带着必失败的代理去采集。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

宿主层挂一个实例，为所有模式提供设置表单与会话投影；需要 `/proxy` 的预设声明再挂一个只带命令的实例。

```yaml
- id: command-proxy
  name: './command-proxy/lib/index.js'
  config:
    command: false
```

### 配置项

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

完整行为说明见 [DETAILS.md](DETAILS.md)。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 — 点击展开</summary>

`/proxy [on|off] [其余内容]` 幂等地切换会话开关，然后把后续内容原样作为普通用户消息转给模型。状态取会话日志里最后一条 `proxy/enabled` 事件，所以新会话默认关闭，任何时刻的历史状态都能从日志重放。池空防呆：没有启用且 `apiUrl` 非空的源时，`/proxy on` 被拒绝。

`proxy-pool` 条目的字段是 `.volatile()` Config，经 settings 表单读写并持久化进活跃 profile 的 `cordis.patch.yml`；预设实例与采集工具通过 settings 的 describe 投影读同一份现值，而不是各自的配置默认值。`proxyMode` 把本会话最后一条 `proxy/enabled` 事件折给 `crawl_fetch` 与逆向模板脚本，它们经 `scripts/proxy_pool.py` 取 IP。

命令挂在 `crawl`、`reverse`、`workflow`、`empirical`、`report`；`modeling`、`review`、`experiment` 与上游四模式没有采集需求，不挂命令。设置展示策略与 `proxyMode` 投影是宿主单例：预设实例必须关掉 `namespace` 与 `projection`，否则挂载失败。

</details>

<a id="model-experience"></a>
## 模型体验

### 会话代理开关与代理池设置

#### 模型看到的内容

无新增：本包不注册任何工具；`crawl_fetch` 与逆向模板脚本读取 `proxyMode` 投影，逐次调用自行决定是否走代理池。

#### Token 影响

零：本包不向任何请求贡献提示词段或工具定义。

#### KV Cache 影响

无：请求前缀不含本包的任何内容；切换 `/proxy` 写的是 `proxy/enabled` 会话事件，不是请求内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 池空防呆：没有启用且 `apiUrl` 非空的源时，`/proxy on` 被拒绝并提示，会话保持关闭，必失败的代理采集不会开始。
- 状态按会话：开关只影响当前会话；即使池总开关开着，新会话也默认不走代理。
- 挂载范围：没挂本包的模式里 `/proxy` 命令根本不存在；设置表单与投影是宿主单例，不随预设重复注册。
- 脚本侧放弃：代理连续重试全部失败后，采集脚本打印提示并以退出码 3 结束，由 AI 询问用户是否改走本地网络。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
