---
description: "经验池设置页：对 SmartBoBo 网关完成密钥激活、套餐状态展示与迁移换绑。"
kind: "package-reference"
---

# bobo-settings-experience-ui

[English](README.md) | 中文

## 概述

BoBo 定制的 Web 设置页：在 Settings 面板新增「经验池」栏目（id `experience-pool`，order 68），对接 SmartBoBo 授权网关，完成「输密钥 → 激活 → 展示套餐状态 → 管理迁移」这一段。该栏目由三张卡片组成——授权、迁移、连接诊断——每张都折叠到自己的标题；进入页面时一律收起，折叠状态不做持久化，所以每次打开设置页都是收起态。配置经活跃 profile 持久化；访问令牌与许可证密钥只存在只写不读的 credentials 域。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

挂载本插件即可把许可证流程放进设置页；宿主半声明了页面读写的 `experience-pool` volatile Config。

### 构建

```sh
pnpm install --no-frozen-lockfile --ignore-scripts   # 首装配
cd packages/bobo/ui-settings-experience
pnpm exec tsc -b tsconfig.json && pnpm exec tsdown   # 生成 lib/（运行时只读 lib/）
```

本包不在 `tsconfig.host.json` / `tsconfig.client.json` 解决方案里，自带 `tsconfig.json` 与 `tsdown.config.ts`。

### 挂载

在 `packages/bobo/cordis.patch.yml` 的 `- insert:` 段里挂一行：

```yaml
- id: experience-pool
  name: './ui-settings-experience/lib/index.js'
```

相对路径以补丁文件所在目录为基准；模块扫描读取该包 `package.json` 的 `dsh.client` 声明，再加载它的 `lib/client.js`（浏览器半）。条目 id 即 settings 表单的命名空间（`experience-pool`，浏览器半的常量与它同值）；宿主半的 Config 声明三个 `.volatile()` 字段——若该条目未挂载，页面会显示「设置未在宿主注册」的提示。该条目的声明行必须位于 profile 层或更底层（bundle 层），`--patch` 覆盖层只做 id 定向补丁，不能带 `config:`，否则表单写入会被 config-editor 以「被 home patch 或命令行覆盖」拒绝。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 — 点击展开</summary>

各值的存放位置：

| 存放位置 | 内容 | 说明 |
|---|---|---|
| profile 条目 `experience-pool` 的 volatile Config（宿主半声明） | `baseUrl` / `deviceId` / `license`（套餐缓存） | 非敏感，经 settings 表单写入活跃 profile 的 `cordis.patch.yml` 持久化 |
| credentials 域（`ctx.remote.credentials.set`） | `bobo_experience_access_token` / `bobo_experience_license_key` | 只写不读：该域只暴露 `configured/source/writable`，页面不回显 |
| 插件闭包内存 | 激活返回的 `access_token` | 刷新状态（`/v1/license/me`）在本会话内使用；页面刷新后需要重新输密钥才能恢复在线刷新 |

页面本身不读写任何客户端文件（`experience-pool.json` 属于后续的 host 侧工作）。

浏览器直连的网关接口：

- `GET /v1/health` —— 连接诊断（网关可达 / 上游 Qdrant 可达），页面挂载后自动检测一次。
- `POST /v1/license/activate` —— 携带 `device_id` 与 `client_version` 换取令牌。
- `GET /v1/license/me` —— 刷新套餐状态；剩余天数一律用响应里的 `server_time` 计算，不用客户端时钟。
- `POST /v1/license/migrate/request` —— 发送迁移确认邮件；**无论邮箱是否存在，页面只显示同一句提示**（服务端防枚举语义，前端原样照做）。
- `POST /v1/license/migrate/complete` —— 提交确认码完成迁移，成功体与 activate 相同。

所有请求 10 秒超时；错误优先展示服务端返回的 `status_description`（429/503 的中文文案原样显示），网络/超时类失败展示本地化文案。

</details>

<a id="model-experience"></a>
## 模型体验

### 经验池设置页

#### 模型看到的内容

无：`experience-pool` 页面不注册提示词段、工具或会话事件，浏览器侧 HTTP 调用也从不进入模型请求。

#### Token 影响

零：本包不向任何模型请求增加 token。

#### KV Cache 影响

无：请求前缀不含本包的任何内容，既不追加也不替换已缓存前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 只做「输密钥 → 激活 → 展示套餐状态 → 管理迁移」，不写任何客户端侧文件。
- 访问令牌在页面刷新后不可读（凭据域没有读取路径，这是刻意的防回显设计），刷新状态需要重新输密钥激活一次。
- 套餐缓存里的剩余天数由缓存时刻的 `server_time` 推算，长期未刷新会略偏保守。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
