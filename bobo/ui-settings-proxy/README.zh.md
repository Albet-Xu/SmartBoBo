---
description: "代理池设置栏目：经共享 settings describe 投影编辑宿主 /proxy 命令读取的 proxy-pool 命名空间。"
kind: "package-reference"
---

# bobo-settings-proxy-ui

[English](README.md) | 中文

## 概述

设置页里的「代理池」栏目：经共享 settings describe 投影编辑 `proxy-pool` 命名空间——代理源、取 IP 策略、总开关、重试与超时。该命名空间的数据模型、宿主侧属主与会话投影都住在 `bobo-proxy-tool`；本包只拥有页面。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

在注册该命名空间的宿主行之后挂页面：

```yaml
- id: ui-settings-proxy
  name: './ui-settings-proxy/lib/index.js'
```

宿主的 `command-proxy` 行必须先在，否则栏目没有可读写的 `proxy-pool` 命名空间。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 — 点击展开</summary>

栏目经 `slots.inject` 注册进上游 `ui-settings` 声明的 `settings.section` 槽位，栏目排位 `70`，因此与槽位属主的装载顺序无关。`src/client/proxy-pool.ts` 把一份 settings 镜像快照折成页面视图状态（`loading` / `unavailable` / `absent` / `read` / `section`），并构造把整份编辑后对象写回命名空间的写操作；组件渲染该状态并就地报告保存失败。

文案放在 `settings.proxy` locale 命名空间；视图类型经 `bobo-proxy-tool` 的 `ProxyPoolSettings` 类型与宿主共享，页面编辑的正是宿主对外服务的那个对象。

</details>

<a id="model-experience"></a>
## 模型体验

### 代理池设置栏目

#### 模型看到的内容

无：页面写的是 `crawl_fetch` 与代理脚本在调用时读取的设置；它自身不注册提示词段、工具或会话事件。

#### Token 影响

零：本包不向任何模型请求增加 token。

#### KV Cache 影响

无：请求前缀不含本包的内容；保存的池配置改变的是工具行为，不是请求文本。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 栏目依赖宿主 `command-proxy` 行提供 `proxy-pool` 命名空间；缺了它页面报告命名空间不可用，而不是给出表单。
- 保存经 settings 表单写入活跃 profile 的 `cordis.patch.yml`，若 home patch 或命令行覆盖层钉住了这些字段，写入会被拒绝——页面如实展示拒绝，而不是静默无效。
- 页面只编辑池配置；某个会话是否真的走代理，仍由 `bobo-proxy-tool` 所有的会话级 `/proxy` 开关决定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
