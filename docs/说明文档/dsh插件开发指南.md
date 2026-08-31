# dsh插件开发指南

---

## 0. 一句话总览

dsh（DeepSeek Harness）是一个**基于 Cordis 的插件式 Agent 框架，一切皆插件**。你要“在 dsh 里做一件事”，本质上就是**写一个插件**（一段 TypeScript 模块），这段插件向某个 **Service** 注册贡献（如向 `ctx.tools` 注册一个工具、向 `ctx.on()` 挂一个事件监听、向 `ctx.effect()` 装一个副作用），然后在某个 **cordis 装配文件**（例如 preset 的 `agent.cordis.yml`、或 `--patch` 指向的 yml）里加上一行把它启用，最后重启/启动 dsh 生效。

SmartBoBo 的采集能力 `crawl_fetch` 就是这样实现的：`dsh/packages/acquisition/tool-acquisition/src/index.ts` 是一个插件，它 `inject` 了 `tools` 服务，用 `ctx.tools.register(defineTool(...))` 注册了 `crawl_fetch` 工具，并在 `apps/cli/config/agent-presets/*/agent.cordis.yml` 或 `dsh/patch/web-acquisition.yml` 里用一行 `name: '@deepseek-ai/dsh-tool-acquisition'` 启用。

---

## 1. 前置准备与开发环境

进入 dsh 目录并安装依赖：

```sh
cd dsh
pnpm install            # pnpm workspace，Node ^22.19 或 >=24
```

BoBo 的常规启动脚本（在假设你已经配好 `~/.dsh/settings.yaml` 的模型等前提下）：

```sh
cd dsh && pnpm bobo
```

`pnpm bobo` 实际等于（见根 `package.json` 的 scripts）：

```sh
node --import tsx/esm apps/cli/src/bin.ts web \
  --patch packages/bobo/cordis.patch.yml \
  --patch patch/web-acquisition.yml
```

也就是说：以 **web** 形态启动 dsh CLI，并叠加两个装配补丁（`bobo` 的端口等 + `web-acquisition.yml` 把采集工具注入 Web 装配）。这个 `bobo` 命令就是你日常“在 dsh 里运行插件”的入口之一（详见第 8 节）。

> 开发时常用到几个命令：
> - `pnpm run typecheck` / `pnpm run lint` —— 类型与 lint 检查（会先 `build:lib:host`）
> - `pnpm run build:lib:host` —— 编译 Host 面（新增的纯后端包加入的是 Host aggregate，见第 9 节）
> - `pnpm run test` —— vitest 单测

---

## 2. 核心概念（先把地基打牢）

对插件作者首先要懂 5 个概念（来源：`dsh/docs/cordis-primer.zh.md`）：

1. **插件是“提供 Service 的对象”**。可以是一个带可选 `inject` 和 `apply(ctx)` 的函数，也可以是一个 `Service` 子类。
2. **上下文（Context / ctx）是服务的容器**。一个服务占据一个稳定的 `ctx.<key>`（如 `ctx.tools`、`ctx.llm`、`ctx.sessions`）。其他插件通过 key 查找服务，而不是 import 具体实现。
3. **用 `inject` 声明服务依赖**。插件声明它需要的服务后，会等这些服务就绪才启动；加载顺序由依赖表达，不靠手动编排。
4. **类型化事件用于通信**。服务通过 TypeScript 声明合并注册事件名，再以 `emit` / `waterfall` / `parallel` / `serial` 分发（详见第 7 节）。
5. **注册是可逆的副作用**。提示词片段、工具 schema、监听器都通过 `ctx.effect()` / `ctx.on()` 安装，reload 和 teardown 时自动撤销。

### 2.1 插件的三种形态

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. 函数形态（最常见，也是初学首选）
export function apply(ctx: Context) {}

// 2. 对象形态：一个带 apply 方法的对象
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. 类形态：Service 子类（需要对外公开服务时才用，见第 6 节）
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

> 原则：**在你需要“公开一个服务”之前，一律用函数形态**。函数形态足够完成绝大多数工具类、Hook 类插件。

### 2.2 最小插件长什么样

```ts
// hello.ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'          // 可选显示元数据，诊断信息用它标识插件
export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

配合装配文件 `cordis.yml`：

```yaml
- name: './hello.ts'     # 模块指定符：相对路径或 NPM 包名
```

加载器会并发挂载每个配置项；**加载先后由服务依赖（inject）决定，不是文件里的顺序**。

> 错误规则：`apply` 抛异常 → 进程/加载失败，会明确报错而不是安静跳过；但插件**模块无法被解析**（路径/包名拼错）时，只通过 logger 报错不崩溃——如果“加了配置没效果”，先检查拼写。

---

## 3. 插件开发的两种路径

在 dsh monorepo 里做插件，有两种标准做法，按需求轻重选择：

| 路径 | 适用场景 | 改动位置 | 构建方式 |
|---|---|---|---|
| **A. 最简：单文件插件** | 学习、原型、临时工具 | 在任意目录写一个 `.ts`，用任务里任意一个 patch 或 preset 行指向它 | 无需登记进 workspace，直接被 loader 按相对路径加载（走 tsx） |
| **B. 正式：新增 workspace 包** | 要交付、要复用、要被 `@deepseek-ai/dsh-*` 包名引用 | `packages/<group>/<pkg>/`，并登记进 root tsconfig 等 | 进 `tsconfig.host.json` references，随根 `tsc -b`+tsdown 统一构建 |

**路径 A 最快上手**：参照官方教程 `docs/cordis-tutorial/01-first-plugin.zh.md` 和 `docs/user/develop/basic/tool.md`，写一个 `greet` 工具插件文件，然后用 `--patch ./my-plugin/cordis.yml` 启动即可看到效果。

**本项目的正式插件都走路径 B**：`packages/acquisition/tool-acquisition` 就是模板。下面第 4、5 节以路径 B 为主轴；如果你只是快速试，直接跳到第 4.3 节用 fl 函数形态写完后用 path A 跑。

---

## 4. 编写一个工具插件（defineTool 全解）

“工具”是最常见、也最适合做采集/操作类扩展的插件类型。下面是研读 `docs/cookbook/adding-a-tool.zh.md` 后整理的完整写法。

### 4.1 最小形态

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',          // 模型看到的描述
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                     // 不写 required 即可选
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args 已被 schema 校验过、类型准确：{ path: string; limit?: number }
      // exec 携带不可变身份 + token；exec.signal 是常做取消的唯一操作信号
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

- `inject: ['tools']` 让 Cordis 等工具注册表就绪。
- `defineTool` 会在 `execute` 前按统一的 `ParameterSchemaSpec` 校验模型生成的 `arguments`，因此 execute 里拿到的 args 是可信且类型正确的。
- 注册是副作用：插件 fiber 被 dispose 即自动注销该工具；工具 schema 自动流入系统提示词组装。

### 4.2 execute() 的硬性规则

- **参数已帮你校验**，但 schema DSL 表达不了的约束（如“非空字符串”“正数”“跨字段”）仍要自己在 execute 里检查。
- **注册借用你的只读定义**，注册后别改 schema 或替换回调。
- **把 args 当只读输入**；身份（`exec.token`、`callId`、`signal`）全程不可变。
- **声明并返回一个规范的 JSON 值**（`output.schema`）。execute 只返回推导值，注册表做无损校验后交给 `output.render(args, value)` 生成**模型可见**内容。不要在工具主体里直接返回内容块。
- **抛出抛异常或返回无效值 = isError**。基础设施故障就抛异常；不理想但成功的领域结果写成规范值，由渲染器解释（如进程非零退出）。
- **遵守 `exec.signal`**：信号触发就取消进行中的工作。
- **可选 `output.presentationMeta(args, value)`**：派生可回放的持久化卡片数据。
- **可选 `exec.agent.inject({...})`**：追加持久化上下文让下一次请求看到（不是唤醒）。
- 长时间运行的工作用 `ctx.jobs.start({...})` 注册后台任务（参照 `dsh-tool-bash`）。

### 4.3 工具在 UI 里怎么渲染（presentCall / presentResult）

每个工具可额外声明两个**纯函数**投影方法（不做事、不读状态、不用时钟），返回一个 `card` 标签的渲染意图：

- `presentCall(args)` → 一个 PENDING 卡片：
  - `{ card: 'generic', title, kind?, rawInput?, content?, locations? }` 默认通用卡片；设 `kind` 得到图标（`read`/`search`/…）；`locations: [{path, line?}]` 供编辑器跳转。
  - `{ card: 'terminal', title, description?, cwd? }` —— 调用本身就是 shell 命令。
  - `{ card: 'diff', title, diffs, locations? }` —— 创建/修改文件。
- `presentResult(args, { content, isError, meta? })` → 完成后的卡片（`generic`/`terminal`/`diff`/`search`/`web`）。

硬性规则：
- **纯函数**：流式输出和日志回放都会执行，不能作 I/O、读会话状态、用时钟。
- **UI 格式不进模型结果**：console 围栏、diff、相对化路径不要塞进规范值或 Native 内容；`output.render` 管模型可见的自然语言，`presentationMeta`+卡片管可回放的 UI。
- **展示绝不能导致回放崩溃**：`defineTool` 对展示路径做软校验，格式错误时回退通用卡片而非抛异常。

本项目 `tool-acquisition` 就是这么做的（`presentCall` 返回 `{card:'generic', kind:'fetch'}`，`presentResult` 返回 `{card:'generic'}`），把它作为参照。

---

## 5. 插件的配置（Config 与 schemastery）

插件可以声明自己的配置，装配文件里通过 `config:` 传入。用 `@deepseek-ai/schemastery` 定义类型并校验（本项目 `tool-acquisition` 的 `Config` 就是模板）：

```ts
import z from '@deepseek-ai/schemastery'

export interface Config {
  pythonBin?: string
  scriptsDir?: string
  dataDir?: string
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  pythonBin: z.string(),                    // 可选，不填由插件自动定位
  scriptsDir: z.string(),
  dataDir: z.string().default(''),
  timeoutMs: z.natural().min(1000).default(120_000),
})

// apply 第二个参数就是解析后的配置
export function apply(ctx: Context, config: Config): void {
  // 用 config.timeoutMs ?? 180_000 等取值
}
```

装配时：

```yaml
- id: tool-acquisition
  name: '@deepseek-ai/dsh-tool-acquisition'
  config:
    dataDir: ''
    timeoutMs: 120000
```

工程规则（`AGENTS.md`）：**不要在插件里硬编码可调参数**——凡是部署时可能变化的取舍，都做成 `Config` 字段、能从 cordis.yml 改；协议常量、外部规范和安全性不变量保持固定。配置加载失败要“大声失败”，绝不静默跳过缺失的引用。

---

## 6. 事件与服务（高级扩展点）

如果你要做的不只是“加一个工具”，而是要**拦截/包装别的插件的动作**或**对外提供能力**，就要用到事件与服务。

### 6.1 注册副作用 always via effect

```ts
ctx.effect(() => {
  // 返回 disposer（释放函数）；reload/teardown 时被调用
  return () => { /* 撤销注册 */ }
})
ctx.on('some/event', (payload) => { /* 监听 */ })
```

### 6.2 事件的四种分发模式

| 模式 | 是否 await | 顺序 | 是否有返回值 |
|---|---|---|---|
| `emit` | 否 | 按注册顺序观察 | 否 |
| `waterfall` | 否 | 按注册顺序观察 | 是 |
| `parallel` | 是 | 并行观察 | 否 |
| `serial` | 是 | 按注册顺序观察 | 是 |

关键注意：
- **waterfall 语义**：`ctx.waterfall` 是“环绕中间件”，监听器收到 `(...args, next)`。调用 `next()` 继续下游；不调用直接返回则**短路**。协作式监听器改共享对象再委托；有决策权的策略监听器可以不 next 直接返回，而只做标注的监听器必须委托。只在必须早于普通监听器运行时才用 `prepend: true`。
- 类型化事件用 **TypeScript 声明合并**注册事件名（事件表在本项目是 `SessionEventMap` 等，新增模型可见信息必须同时补会话事件——`model-visible ⟺ logged` 规则）。

### 6.3 面向能力的设计：Service / 事件 / Hook 放哪层

实践原则（`cordis-primer.zh.md`）：工具流水线事件归 `ctx.tools`，模型流式输出归 `ctx.llm`，实时 agent 协调归 `ctx.agents`。**拦截与策略优先用事件，直接能力调用优先用服务方法。**

一个“能力接缝（capability seam）”由 **Service Definition / Service Provider / Consumer** 三个角色组成，是完整的，缺一不可；多个实现时拆到不同包（shell 的 `tool-bash` 就是三组件模板）。对大多数扩展，你只需要：写一个提供实现的 Provider（或直接注入一个 Consumer 去消费现有服务），不必重造整套 Definition。

---

## 7. 新增一个 dsh workspace 包（路径 B 完整清单）

参照 `docs/cookbook/adding-a-package.zh.md`（逐文件清单）与 `packages/acquisition/tool-acquisition` 这个实际模板。

### 7.1 建包骨架

```
packages/<group>/<pkg>/
  package.json     # 抄 packages/core/tools 的，改 name/description/deps
  tsconfig.json    # extends ../../../tsconfig.base.json；rootDir src、outDir lib/types
                   # references 加 vendor/cosmokit、vendor/cordis（用 Config 加 schemastery），
                   # 以及每个 dsh 依赖的 <group>/<dep>
  src/index.ts     # 服务默认导出 或 插件（name/inject/apply/Config）
  README.md        # 服务 API、事件、扩展点、设计说明
```

package.json 必须满足的约束（由 `pnpm run constraints` 强校验）：`private: true`、版本与根一致、`type: module`、`main: "lib/index.js"`、`types: "lib/types/index.d.ts"`、`@deepseek-ai/cordis` 同时出现在 peerDependencies 和 devDependencies、每个 dsh peer 在 dev 里镜像、`@deepseek-ai/schemastery` 放 dependencies。源码内部相对导入用显式 `.ts` 后缀。

> 分组（`core`/`llm`/`bash`/`subagent`/`todo`/`session-persistence`/`ui`/`util`/`support`）是纯容器，选已有匹配的分组；不匹配才新建。本项目把采集放进了 `packages/acquisition/tool-acquisition`。

### 7.2 登记进根配置

| 文件 | 变更 |
|---|---|
| `tsconfig.base.json` | 已有分组无需动；新分组要加 `./packages/<group>/*/src` 候选路径 |
| `tsconfig.host.json`（Host/后端包）或 `tsconfig.client.json`（前端包） | 在 `references` 加 `{ "path": "./packages/<group>/<pkg>" }`，**二选一** |
| `knip.json` | 仅当有仓库发现机制未覆盖的入口时 |

其余（root workspaces、`tsdown.config.ts`、`check-workspace-constraints` 等）都会被 glob 或 package.json 自动发现，不用手动改。

> ⚠️ 采集头注释里特别强调：**这种不带 tsdown.config.ts 的工具包，必须先登记进根 `tsconfig.host.json` 的 references，才能被 `tsc -b` + tsdown 统一构建**。漏了这一步，包不会产出 `lib/`，运行时报找不到模块。

### 7.3 验证（新增包后跑一遍）

```sh
pnpm install
pnpm run constraints && pnpm run typecheck && pnpm run lint
pnpm run build
```

如果只是像本项目这样新增一个采集工具包，`typecheck`（其内部会先 `build:lib:host`）是关键的一步：它会把 `src/index.ts` 编译进 `lib/`，并让 `@deepseek-ai/dsh-tool-acquisition` 裸包名可被解析。

---

## 8. 对接与装配 —— 在 dsh 中如何“跑起来”

写好的插件要“接进” dsh 运行链路，方法有几种，按场景选。**核心概念是 cordis 装配文件（cordis.yml）**：它是一份插件行列表，loader 一条条挂载。

### 8.1 方式一：Agent 预设（agent-presets）——为“模式”加插件

每个模式 = `dsh/apps/cli/config/agent-presets/<name>/` 下的两个文件：

- `preset.yml`：展示元数据，`name`/`description`/`order`。
- `agent.cordis.yml`：Agent 实际装配——一个 `persona` 行 + 一堆工具行。

`agent.cordis.yml` 里的每行就是一个插件行，例如 workflow 预设里这样启用采集工具和数据库 MCP：

```yaml
# 采集工具（core）
- id: tool-acquisition
  name: '@deepseek-ai/dsh-tool-acquisition'
  config:
    dataDir: ''
    timeoutMs: 120000

# 数据库读操作（MCP 常驻）
- id: mcp-dbx
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: dbx
    transport: stdio
    command: E:/SmartBoBo/BoBo/.venv/Scripts/python.exe
    args: ['E:/SmartBoBo/BoBo/scripts/dbx_mcp_server.py']
    cwd: !!js process.cwd()
```

- **persona 行**（`@deepseek-ai/dsh-persona`）把“模式行为规则”写进 system prompt；`text` 里 `{{model}}`/`{{cwd}}` 等变量在渲染时解析。
- **`!!js` 表达式**只在 config/disabled 下用（如按平台启用 bash/pwsh：`disabled: !!js process.platform === 'win32'`）。
- 工具行用裸包名 `@deepseek-ai/dsh-tool-acquisition`：该包已声明在 `apps/cli` 的 dependencies 里，dsh 会自动 link 到 `~/.dsh/profiles/node_modules`，跨机器可解析。

**预设的发现与切换**：dsh 启动扫描 `agent-presets/`；`preset.yml` 的 `order` 决定 roster 排序；Web 端“设置 → Agent 预设”切换。**修改/新增预设需重启**（`cd dsh && pnpm bobo`）。预设机制细节见 `docs/preset/agent-presets/README.zh.md`（常驻挂载 + scope 认父，所有已加入会话共享同一份工具/提示词实例）。

> 想“调一个模式的行为”优先改它对预设的 `agent.cordis.yml`；想让插件在**所有/多个**模式可见，再考虑用 `--patch`（方式二）。

### 8.2 方式二：`--patch` 装配补丁 —— 注入全局 / 覆盖已有行

`pnpm bobo` 已经带上了 `packages/bobo/cordis.patch.yml` 和 `patch/web-acquisition.yml`。补丁文件语法（本项目踩过坑，`patch/web-acquisition.yml` 里有注释）：

- **`- insert:` 用于“新增插件行”**。只有 `- insert:` 才会注入新行；裸 `- id:` 只会**覆盖已存在的行**，若 id 不存在会被静默跳过、工具根本不加载。
- 裸 `- id: webserver` 那种写法只适用于“覆盖已有行的配置”这种场景（如端口补丁）。

示例（`patch/web-acquisition.yml`）：

```yaml
- insert:
    - id: tool-acquisition
      name: '@deepseek-ai/dsh-tool-acquisition'
      config:
        dataDir: ''
        timeoutMs: 120000
```

如果你想让某个工具对所有模式都可用，就在某个 `--patch` 或 `~/.dsh/cordis.patch.yml` 里 `- insert:` 它。

### 8.3 方式三：user 级配置（`~/.dsh/`）——个人/全局插件

`~/.dsh/cordis.patch.yml` 里可以直接挂 MCP 服务器（本项目的 js-reverse 就是这么挂的）：

```yaml
- insert:
    - id: mcp-js-reverse
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: js-reverse
        transport: stdio
        command: npx
        args: [js-reverse-mcp]
```

`~/.dsh/settings.yaml` 则管“非插件行”的全局配置：provider/model、`skill-library`（技能登记）、`agent-presets.default`（默认模式）、`mcp-tools` 等。**用户级 skill 和 MCP 修改即时发现，一般无需重启**；预设行为提示词在 `agent.cordis.yml`，改动需重启。

### 8.4 方式四：作为 MCP 客户端挂外部工具

在插件行为外，dsh 也能通过 `@deepseek-ai/dsh-mcp-client` 挂载外部 MCP Server（`stdio` 或 HTTP），把 MCP 工具当普通工具注入。本项目把 `dbx-mcp`（读 DBX 连接/表结构）和 `js-reverse`（逆向分析）都挂成了 MCP 工具。适合“已有现成的 MCP server、不想写 dsh 插件”的场景。

### 8.5 方式五：技能库（skills）扩展 —— 不需要动 Node 代码

`~/.dsh/skills/<name>/SKILL.md`（或其附带脚本/模板）会被 `skill-filesystem` 扫描，在 `settings.yaml` 的 `skill-library` 登记即启用；模式需显式挂 `skill-filesystem` + `tool-skill` 才能调用技能。本项目的 `db-extraction`、`reverse-crawler` 就是技能。**技能发现即时生效、无需重启**，非常适合“让模型按 SOP 作业 + 复用 Python 脚本/模板”这类扩展。

### 8.6 对照表：选哪种方式挂你的插件

| 你的目标 | 推荐方式 |
|---|---|
| 让某个**模式**拥有新工具/行为 | 在对应 `agent-presets/<name>/agent.cordis.yml` 加一行 |
| 让某工具**所有模式**都可见 | `--patch` yml 里 `- insert:` |
| 只改**你自己的个人环境** | `~/.dsh/cordis.patch.yml` |
| 挂现成 MCP Server | `@deepseek-ai/dsh-mcp-client` 一行 |
| 只给模型“作业规程 + 脚本模板”，零 Node 改动 | `~/.dsh/skills/` 技能 |
| 全新、可交付、可复用的复杂插件 | 新增 package 路径 B + 上面任一种装配 |

---

## 9. 构建与运行闭环（一个完整走一遍的例子）

下面把“新增一个工具 → 构建 → 在 dsh 里跑起来”完整串一遍，用一个人人可做的 `greet` 场景（也即官方 `docs/user/develop/basic/tool.md` 的搬移），再说明它对采集类工具的推广。

### 9.1 用路径 A（最快）：单文件工具

1. 写 `scratch-plugin/src/my-plugin.ts`：

   ```ts
   import type { Context } from '@deepseek-ai/cordis'
   import { defineTool } from '@deepseek-ai/dsh-tools'

   export const name = 'greet-tool'
   export const inject = ['tools']

   export function apply(ctx: Context) {
     ctx.tools.register(defineTool({
       name: 'greet',
       description: 'Greet someone by name.',
       parameters: {
         name: { type: 'string', required: true, description: 'The name to greet' },
       },
       output: {
         schema: { type: 'string' },
         render: (_args, value) => [{ type: 'text', text: value }],
       },
       async execute(args) {
         return `Hello, ${args.name}!`
       },
     }))
   }
   ```

2. 写装配 `scratch-plugin/cordis.yml`（一行 `- name: './src/my-plugin.ts'` 或直接把插件按第 8.2 节的 `- insert:` 写法放进某个 patch）。

3. 启动并测试：

   ```sh
   pnpm dsh web --patch ./scratch-plugin/cordis.yml
   ```

   打开 `http://127.0.0.1:3080`（或按你在 `packages/bobo/cordis.patch.yml` 里钉的端口），对模型说“Use the greet tool to greet Ada.”，模型即可调用 `greet` 并收到 `Hello, Ada!`。

### 9.2 用路径 B（交付级）：新增 package，参考 tool-acquisition

如果你是要给 SmartBoBo 长期加一个像 `crawl_fetch` 这样的正式采集/操作工具：

1. 照第 7 节建 `packages/<group>/<pkg>/`（复制 `tool-acquisition` 的 `package.json`/`tsconfig.json` 改名字）。
2. 写 `src/index.ts`：`inject` 你需要的服务（通常是 `tools`），`ctx.tools.register(defineTool({...}))`。需要调 Python/外部程序就用 `node:child_process` 的 `execFile`/`spawn`；需要随插件生命周期善后（如关闭长驻浏览器）就用 `ctx.effect(() => () => {...})` 注册 disposer（`tool-acquisition` 的 `ctx.effect(() => killServer)` 是模板）。
3. 在根 `tsconfig.host.json` 的 `references` 加 `{ "path": "./packages/<group>/<pkg>" }`（**必须**，见 7.2 的坑）。
4. 如果要在 `apps/cli` 让裸包名可解析、并把它注入某个 preset，把 `@deepseek-ai/dsh-<pkg>` 加进 `apps/cli` 的 dependencies，再在 preset 的 `agent.cordis.yml`（或某个 patch）加一行 `name: '@deepseek-ai/dsh-<pkg>'`。
5. 在根目录跑：

   ```sh
   pnpm install
   pnpm run build:lib:host      # 编译出 lib/
   # 或直接 pnpm run typecheck   # 内含 build:lib:host
   ```

6. `cd dsh && pnpm bobo` 启动，在 Web 端切到对应模式，就能用了。

> 改完前端（client 包）要 `pnpm run build:lib:client`（+ `build:web`）；改的是预处理/后端包则 `build:lib:host`。启动后用对你 prefetch 的模式把新工具调用一遍验证。

---

## 10. 常见问题与排错

| 现象 | 原因/解决 |
|---|---|
| “加了配置没效果” | 行没有被加载。检查 ① 拼写（路径/包名）② 用的是不是 `- insert:`（裸 `- id:` 对不存在的 id 会被静默跳过）③ 是否已重启 |
| 找不到 `@deepseek-ai/dsh-xxx` 模块 | 包没进 `apps/cli` dependencies，也没被 link 到 `~/.dsh/profiles/node_modules`；或新包漏登记进 `tsconfig.host.json` references、没产出 `lib/` |
| `apply` 抛错 | 插件加载失败会明确报错（不静默），按报错改；模块无法解析时才只走 logger |
| 工具 schema/行为不生效 | 装配文件改了要重启；预设行改了要重启；`~/.dsh/skills` 与 MCP 一般即时 |
| Windows 下 Python 子进程残留 | 参照 `tool-acquisition` 用 `taskkill /T /F` 清进程树；路径用 `.venv/Scripts/python.exe` |
| 想让模型能解释/展示结果 | 别把 UI 格式塞进 `output.render`，用 `output.schema`（规范值）+ `render`（模型可见文本）+ `presentCall/presentResult`（UI 卡片）三层分离 |
| 想拦截别的工具的权限 | 用 `ctx.tools.register` 之外的事件 seam：`tools/pre-execute`（允许/拒绝/询问）、`ctx.tools.guard()`（最终拒绝）、`tools/execute`（截止时间/重试/指标）、`tools/post-execute`（替换展示）、`tools/result`（只读观测）——见 `adding-a-tool.zh.md` |

---

## 11. 工程规范与约定（写进仓库前必读）

dsh 仓库的 `AGENTS.md` / `docs/` 对新的插件/包有硬性约定，正式提交前要遵守：

- **命名**：`@deepseek-ai/dsh-<name>`；角色名贴近职责（`Provider`/`Consumer`/`Service` 见 `adding-a-package` 的表），别根据“想当然的未来扩展”命名。
- **注册是副作用**：一律走 `ctx.effect()`/`ctx.on()`，`register()` 返回 disposer。
- **配置不硬编码**：部署差异做成 `Config` 字段；加载失败大声报错。
- **模型可见 ⟺ 已记录**：任何到达模型请求的输入都能从会话日志重建；新增模型可见输入要补会话事件。
- **README**：包要有包 README，含服务 API/事件/扩展点/设计说明；面向模型/UI 的变更要补“Model Experience”条目和快照测试。
- **测试**：非平凡模型/产品可见行为变更，要提供可运行的 keyless 快照（见 `docs/testing.md`）；遵循仓库测试政策。
- **文档随改随更**：改动机制要同步 `docs/architecture.md` 等相关文档与注释（采集头注释里就提醒过“装配方式见 patch 注释”）。
- **不改未要求的东西**：保持 diff 聚焦，别顺手重构无关代码。

---

## 12. 参考文档索引

| 主题 | 官方文档 |
|---|---|
| Cordis 核心概念 / 分发 / waterfall / loader | `dsh/docs/cordis-primer.zh.md` |
| Cordis 教程（首插件/生命周期/服务/事件/配置/装配/HMR） | `dsh/docs/cordis-tutorial/index.zh.md` |
| 写一个工具的完整参考（含 UI 卡片/后台任务/策略钩子） | `dsh/docs/cookbook/adding-a-tool.zh.md`，分步版 `docs/user/develop/basic/tool.zh.md` |
| 新增 workspace 包的逐文件清单 | `dsh/docs/cookbook/adding-a-package.zh.md` |
| 插件配置 | `dsh/docs/user/develop/basic/config.zh.md` |
| 事件与服务开发 | `dsh/docs/user/develop/framework/{events,service}.zh.md`、`docs/cordis-api/*` |
| 预设机制（agent-presets） | `packages/preset/agent-presets/README.zh.md`、`packages/preset/persona/README.zh.md` |
| 本项目采集插件实例 | `dsh/packages/acquisition/tool-acquisition/src/index.ts` |
| 本项目装配与端口补丁 | `dsh/patch/web-acquisition.yml`、`dsh/packages/bobo/cordis.patch.yml` |
| 本项目各模式预设 | `dsh/apps/cli/config/agent-presets/*/agent.cordis.yml` |
| 用户级配置 / MCP / 技能 | `~/.dsh/cordis.patch.yml`、`~/.dsh/settings.yaml`、`~/.dsh/skills/` |

---

### 一句话收尾

> 插件开发 = 写一个模块，向某个 Service 注册贡献（工具/监听器/效果），再在某个 cordis 装配文件里加一行启用。先在路径 A（单文件）上验证想法，再升级成路径 B（正式 package）并注入对应模式的 preset 或 `--patch`；改装配要重启（`pnpm bobo`），改技能/MCP 多半即时。模板看 `tool-acquisition`，机制看官方 cookbook 与 cordis 教程。