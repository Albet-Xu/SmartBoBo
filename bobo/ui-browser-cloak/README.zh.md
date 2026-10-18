---
description: "右栏内置浏览器面板：渲染共享 CloakBrowser 浏览器、转发输入，并在等待人工接管时自动浮出。"
kind: "package-reference"
---

# bobo-browser-ui

[English](README.md) | 中文

## 概述

右栏「内置浏览器」面板：注册 `CloakBrowser` 标签页类型，渲染共享浏览器的 JPEG 帧，转发鼠标、滚轮与键盘输入，并在宿主报告等待人工接管时自动浮出。它镜像的正是 `crawl_fetch` 与 `browser_handoff` 操作的那台共享浏览器。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

挂载本插件即可加上面板；它对话的宿主侧桥接另行挂载：

```yaml
- id: ui-browser-CloakBrowser
  name: './ui-browser-CloakBrowser/lib/index.js'
```

面板需要 `bobo-browser-bridge` 行（`./tool-acquisition/lib/bridge.js`）及其背后的 CloakBrowser 服务；两者一起给所有模式提供同一台共享浏览器与登录态。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 — 点击展开</summary>

每项贡献各占一个 effect：标签页类型与字典对右栏的服务注册，面板体经 `slots.inject('sidebar.right.pane.tab')` 注册，因此声明方的装载顺序与本插件无关。面板全部状态留在组件内——无 store、无注入业务面——经桥接的 `POST /bobo-CloakBrowser/cmd` 完成状态、截图、输入转发与重载。

交接监视器（`handoff-watch.ts`）监听宿主待处理的人工接管并浮出面板，让用户完成验证码或登录；制造这些接管的 `browser_handoff` 工具归 `bobo-crawl-tool` 所有。

</details>

<a id="model-experience"></a>
## 模型体验

### 内置浏览器面板

#### 模型看到的内容

无：面板是浏览器侧表现层；注册标签页类型、帧渲染与输入转发都不新增提示词段、工具或会话事件——模型可见的交接流程归 `bobo-crawl-tool` 所有。

#### Token 影响

零：本包不向任何模型请求增加 token。

#### KV Cache 影响

无：任何挂载方式下，请求前缀都不含本包的内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 只有桥接行与 CloakBrowser 服务都可达时面板才渲染画面；否则它报告失败而不是显示实时图像。
- 展示是 JPEG 帧轮询加指针/键盘事件转发——没有音频，也没有直接的 DevTools 面。
- 面板状态是组件本地的，关闭或重挂标签页会重置视图；显示的页面状态不在客户端持久化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
