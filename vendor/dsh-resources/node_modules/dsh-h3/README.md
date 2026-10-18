# dsh-h3

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![coverage][coverage-src]][coverage-href]
[![License][license-src]][license-href]

⚡️ **dsh-h3** 仅适用于插件作者，为 DeepSeek Harness 插件提供 [h3](https://github.com/h3js/h3) 路由服务，通过 Cordis 管理注册与卸载。

## 📦 安装

```sh
pnpm add dsh-h3 h3
```

<details>
<summary>Are you an AI?</summary>

You can run <code>npx skills add omdsh-dev/dsh-h3 --skill dsh-h3 -y</code> to install the skills!

Remember to ask your owner which <a href="https://github.com/vercel-labs/skills?tab=readme-ov-file#supported-agents">Agents</a> need to be supported (using the <code>--agent</code> parameter of skills) to avoid installing too many default <code>agents</code> directories.

</details>

## 特性

- **原生 H3**：支持中间件、路由参数、子应用、路由选项和链式调用
- **宿主路由**：仅使用原生 H3 字符串路径，自动推导宿主的 exact/prefix 匹配
- **上下文与选项**：在服务外部或 [h3](https://github.com/h3js/h3) 处理器中读取本次激活的 Context 和选项
- **生命周期清理**：通过 Cordis effect 卸载路由，注册失败时回滚本次改动
- **复用宿主服务**：使用 `ctx.webServer`，不启动额外服务器、不占用 fallback
- **客户端 API**：可通过 [GenAPI](https://github.com/hairyf/genapi/blob/main/README_CN.md) 静态生成请求函数和类型，不执行宿主代码

> ⚠️ 使用 H3 v2。插件激活前，宿主必须提供 `webServer`。

## 🚀 快速开始

### 1. 定义与激活路由服务

定义路由服务并在插件的 `apply` 函数中激活：

```ts
// src/host/server/routes/health.ts
import { defineEventHandler } from 'h3'

export const health = defineEventHandler(() => ({ status: 'ok' }))
```

```ts
import { defineWebServer } from 'dsh-h3'
// src/host/server/index.ts
import { defineEventHandler } from 'h3'
import { health } from './routes/health'
import { version } from './routes/version'
import { inspect } from './routes/inspect'

export const server = defineWebServer((app) => {
  app.get('/api/health', health)
  app.get('/api/version', version)
  app.get('/api/inspect/**', inspect)
})
```

```ts
// src/host/apply.ts
import type { Context } from '@deepseek-ai/cordis'
import { server } from './server'

export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => server(ctx), 'custom-label')
}
```

**注意事项：**

* `server(ctx)` 调用后将返回卸载函数（可手动调用，重复调用安全）。通过 `ctx.effect` 激活时，插件卸载时会自动移除相应路由。
* 若注册失败，系统仅回滚本次激活的路由，不会影响已存在的路由。

---

### 2. 读取上下文与配置选项

可以通过 `server(ctx, options)` 的第二个参数注入配置选项或运行时依赖：

```ts
// src/host/server/index.ts
import { defineWebServer } from 'dsh-h3'
import { status } from './routes/status'

export interface Options {
  startedAt: number
}

export const server = defineWebServer<Options>(app => app.get('/api/status', status))
```

```ts
// src/host/server/routes/status.ts
import type { Options } from '../index'
import { getServerContext, getServerOptions } from 'dsh-h3/utils'
import { defineEventHandler } from 'h3'

export const status = defineEventHandler((event) => {
  const ctx = getServerContext(event)
  const options = getServerOptions<Options>(event)

  return {
    port: ctx.webServer.port,
    uptimeMs: Date.now() - options.startedAt,
  }
})
```

```ts
// src/host/apply.ts
import type { Context } from '@deepseek-ai/cordis'
import { getServerContext, getServerOptions } from 'dsh-h3/utils'
import { server } from './server'

export const inject = ['webServer']

export function apply(ctx: Context): void {
  const options = { startedAt: Date.now() }
  ctx.effect(() => server(ctx, options), 'status:routes')

  // 在处理器外部读取上下文与选项（仅在服务激活期间有效）
  getServerContext(server) // 返回已传入的 Context 实例
  getServerOptions(server) // 自动推断为 Options 类型
}
```

> **隔离机制**：每次激活独立捕获 `Context` 与选项。当同一个服务在多个宿主中被多次激活时，事件处理器始终绑定其所属激活的数据，不会被后续激活覆盖。

---

### 3. Node.js 原生 HTTP 处理器

Node.js HTTP 回调函数必须先通过 H3 的 `fromNodeHandler` 显式转换：

```ts
import { defineWebServer } from 'dsh-h3'
import { fromNodeHandler } from 'h3'

const server = defineWebServer((app) => {
  app.get('/api/text', fromNodeHandler((req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(req.method)
  }))
})
```

> ⚠️ **提示**：不会根据回调参数数量自动转换 Node 处理器。显式转换后的 Node 处理器可在运行时使用，但 GenAPI 不支持分析这类处理器。

---

## 🛠️ 生成客户端 API

`dsh-h3/genapi` 提供了 [GenAPI](https://github.com/hairyf/genapi/blob/main/README_CN.md) 的 `original` 构建阶段。它通过静态分析服务入口中的路由定义与 H3 处理器，直接构建客户端 API，**过程中无需加载插件或执行宿主代码**。

### 1. 安装开发依赖

```sh
pnpm add -D @genapi/core @genapi/pipeline @genapi/presets
```

### 2. 配置文件 (`genapi.config.ts`)

```ts
import { defineConfig } from '@genapi/core'
import { fetch } from '@genapi/presets'
import { original } from 'dsh-h3/genapi'
import pipeline from '@genapi/pipeline'

export default defineConfig({
  preset: pipeline(
    fetch.ts.config,
    original,
    fetch.ts.parser,
    fetch.ts.compiler,
    fetch.ts.generate,
    fetch.ts.dest
  ),
  input: './src/host/server/index.ts',
  output: {
    main: 'src/client/apis/index.ts',
    type: 'src/client/apis/index.type.ts',
  },
})
```

### 3. 代码生成

```sh
pnpm exec genapi
```

### 规则与限制

* **输入要求**：`input` 文件必须是在模块顶层直接声明 `defineWebServer` 的入口文件。
* **支持的语法**：
  * 支持 `app.get/post/...`、`app.on('POST', ...)` 及链式调用。
  * 支持静态字符串路径和静态前缀下的简单 `:parameter` 路由；`'/api/users/:id'` 会生成必填路径参数。
  * 唯一的通配符例外是非根、完全静态前缀后的末尾 `/**`：`'/api/inspect/**'` 仅生成固定端点 `/api/inspect` 的请求函数，不生成通配符或子路径客户端。
  * 通过 `getQuery<Query>(event)` 或 `readBody<Body>(event)` 自动推导 Query/Body 类型。

* **命名规范**：函数名与生成的类型名均由路径与 HTTP 方法合成（如 `/api/health` -> `getApiHealth`、`GetApiHealthResponse`）；若需自定义函数名，可配合 `patch.operations` 使用。
* **暂不支持**：动态条件、循环、子应用挂载、根级 `/**`、带参数前缀后的 `/**`、其他通配符或复杂正则模式、Node 处理器（包括 `fromNodeHandler` 包装）、递归类型及非 JSON 契约（解析遇到不支持的语法时将打印准确的源码位置）。

---

## 💡 示例项目

仓库提供了完整的 [basic 示例](<playground/README.md>)，展示了按服务入口与独立路由文件组织的插件、
[GenAPI 配置](<playground/genapi.config.ts>)和[生成的客户端 API](<playground/src/client/apis/index.ts>)，包含真实宿主请求与生成一致性检查。

```sh
# 安装与构建示例
pnpm install
cd playground
pnpm genapi
pnpm build

# 运行（需在仓库根目录执行，需提前安装 dsh CLI）
dsh web --patch ./cordis.patch.yml
```

---

## 📚 API 参考

### `defineWebServer<Options>(setup)`

```ts
import type { H3 } from 'h3'

function defineWebServer<Options = undefined>(
  setup: (app: H3) => void | H3,
): HostService<Options>
```

每次激活都会创建一个全新的 H3 实例。`setup` 函数必须同步执行，返回 `undefined` 或传入的 `app`。传入的是原生 H3 实例，`app.on` 不会被改写；路由注册沿用 H3 的字符串路径、处理器类型与链式调用。

### `getServerContext(server | event)`

导入自 `dsh-h3/utils`。获取当前激活时传入的 `Context` 对象。

### `getServerOptions<Options>(server | event)`

导入自 `dsh-h3/utils`。获取当前激活时传入的选项对象。从 `server` 提取时支持自动类型推导；从事件提取时显式传入选项类型。

`server.__host_instance` 指向最近一次成功激活的实例。卸载旧实例不会清除新实例；卸载当前实例后不回退到更早的实例。服务未激活或事件不属于本库时，这两个工具会抛出 `TypeError`。

### `original(configRead)`

导入自 `dsh-h3/genapi`。用于 GenAPI pipeline 中，负责填充路由与其类型元数据。

### H3 字符串路径与宿主匹配

路由仅接收原生 H3 字符串路径；宿主匹配规则由内部适配器推导：

| 路径声明方式 | 宿主端注册匹配规则 |
| --- | --- |
| `'/api/version'` | 精确匹配（exact） `/api/version` |
| `'/api/users/:id'` | 前缀匹配（prefix） `/api/users`，具体参数由 H3 解析 |
| `'/api/inspect/**'` | 前缀匹配（prefix） `/api/inspect`，通配符由 H3 解析 |

静态路径推导为 exact；动态模式推导为其首个动态片段之前的静态前缀，并由 H3 完成实际匹配。根级动态模式（如 `/:id`、`/**`）不支持。宿主前缀按路径片段匹配，不会将 `/api/inspection` 交给 `/api/inspect` 路由组。

每个宿主路由组独立约束方法与路径所有权：已匹配路径上未允许的方法返回带 `allow` 响应头的 `405`，`HEAD` 可回退到 `GET`；`all`、`HEAD` 与模式路由不会越过所属路由组。宿主已占用的 `(kind, path)` 会导致重复注册失败，并仅回滚本次激活。

> 🔐 **安全建议**：身份认证、鉴权以及 Body 大小限制等系统安全职责应由插件自身保障。请务必为敏感路由事先配置好对应的 H3 中间件。

---

## 🛠️ 开发与贡献

```sh
pnpm install     # 安装依赖
pnpm lint        # 代码风格检查
pnpm knip        # 冗余代码/依赖检查
pnpm test --run  # 执行单元与集成测试
pnpm typecheck   # TypeScript 类型检查
pnpm build       # 项目构建
pnpm coverage    # 执行测试、生成覆盖率报告并校验 90% 阈值
```

---

## 📜️ 许可证

MIT

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/dsh-h3?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/dsh-h3
[npm-downloads-src]: https://img.shields.io/npm/dm/dsh-h3?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/dsh-h3
[bundle-src]: https://img.shields.io/bundlephobia/minzip/dsh-h3?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=dsh-h3
[license-src]: https://img.shields.io/github/license/omdsh-dev/dsh-h3.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/omdsh-dev/dsh-h3/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/dsh-h3
[coverage-src]: https://codecov.io/gh/omdsh-dev/dsh-h3/graph/badge.svg
[coverage-href]: https://codecov.io/gh/omdsh-dev/dsh-h3
