# packages/dsh-tauri (+ tsdown / ui-playground / bundle) — ponytail-audit

> Scope: packages/dsh-tauri, dsh-tauri-tsdown, dsh-tauri-ui-playground, dsh-tauri-bundle, packages/.test · ~6.7k LOC · read 2026-09-30
> Exclusions honoured: `docs/audit/protocol-surface.md` §1/§2.2 (entry-exported symbols, `defineAdapter`/`adapter.has(...)` capability names, IPC/route/event/slot/constant protocol) are never proposed for deletion. Only over-engineering *inside* them is reported.

## Findings (ranked, biggest cut first)

`shrink: controller 用 hookable 事件总线只为承载一个 dispose 钩子；`add()` 的返回注销 = `Set.delete`，`dispose()` 的顺序触发 = 迭代，`removeAllHooks` = `clear`。换成 `Set` 清理队列，删掉 `createHooks` 接线；`LifecycleHooks` 经客户端入口导出，属于协议面，必须保留。迭代前取快照，保留回调执行中注销其他回调时的既有清理语义。公开 API（`add/timeout/interval/listen/observe/isDisposed/dispose`）逐字不变。 [packages/dsh-tauri/src/client/controller/index.ts:9,12-14,58,62-75,140-153] (-10 LOC)`
  - rg `createHooks` → `controller/index.ts:9`、`modules/hookable.ts:1`；`controller/index.ts` 直连 `'hookable'`，不经自己的 shim。
  - rg `callHook|removeAllHooks|hooks\.hook` → 仅 `controller/index.ts`，唯一钩子名 `'dispose'`。

`delete: `defineDshConfig` 的 `client: false` 分支（"只要 server half"）全仓无人设置、docs 无记载。删 `client?: ... | false` 联合、`options.client === false` 三元与提前 return。 [packages/dsh-tauri-tsdown/src/index.ts:15,80,97-100] (-6 LOC)`
  - rg `client: false` 于 `packages/*/tsdown.config.ts` → 0 命中（14 个 `defineDshConfig(...)` 调用点全部保留 client half）。
  - rg `client: false|defineDshConfig|publint` 于 `docs/` → 0 命中。

`delete: `click(selector)` 只包一层 `clickIfPresent` 并丢弃返回值，全仓零调用方（实际使用者都直接用 `clickIfPresent`）。删函数，`utils/browser.ts` 只剩 `clickIfPresent`。 [packages/dsh-tauri/src/client/utils/browser.ts:17-19] (-3 LOC)`
  - rg `click\(` → 71 命中，全部是 DOM `.click()`、`fireEvent.click`、`controller.click`；`clickIfPresent` 的唯一调用方是 `src/client/register/index.adapter.ts` 的退级阶梯。

`delete: `dshClientInline` 白名单里的 `pathe`：仓内 `pathe` 只被宿主侧文件导入，客户端 bundle 从不需要内联它。从正则可选分支移除即可。 [packages/dsh-tauri-tsdown/src/index.ts:73] (-1 LOC)`
  - rg `from 'pathe'` → 66 命中，路径全部为 `packages/*/src/host/**`（含 host 侧测试），`src/client/**` 0 命中。

## keep: 协议面（不计入 net）

> Lead 复核：以下三条原为 `yagni:` 裁剪项，但其符号经 `packages/dsh-tauri/src/client/index.ts` 出口（`export * from './register'`、`export * from './service/invoke'`、`export * from './service/listen'`、`export * from './hooks/use-invoke'`、`export * from './hooks/use-listen'`、`export type * from './types/tauri'`），仓外插件的既有调用会因签名单方面收窄而编译失败。按 `docs/audit/protocol-surface.md` §1「本仓无调用方 ≠ 死代码」，降级为 `keep:`。

- `keep: defineRegister(ctx, setup) 双参重载保留；其内部 boundCtx 解析可收敛（例如改由调用方显式传 ctx）。` — 该重载是**文件内自述的对外签名**：`packages/dsh-tauri/src/client/register/index.ts:23-24`「若调用方不使用 `ctx.effect`，可用双参形式显式传入：`defineRegister(ctx, setup)`」，实现 `:76-85` 还带 `throw new TypeError('defineRegister: 缺少注册回调，签名是 defineRegister([ctx,] setup)')` 守卫；两参形式在 `packages/dsh-tauri/src/client/register/index.test.ts:145` 有覆盖。
- `keep: defineAdapter(ctx, options) 第二参保留；其内部默认值（DEFAULT_DSH_MIGRATIONS / defaultWarn）可收敛。` — 文档承诺在 `packages/dsh-tauri/src/client/register/index.adapter.ts:664`「消费方可用 `defineAdapter(ctx, { migrations })` 追加，追加项在最后执行」，签名 `:796`；`DefineAdapterOptions` 定义在 `packages/dsh-tauri/src/client/types/adapter.ts:225-229`（出口类型）。
- `keep: invoke/listen/useInvoke/useListen 的 options 形参保留；其内部可收敛。` — `InvokeOptions`（`packages/dsh-tauri/src/client/types/tauri.ts:4-6`）与 `Options { target? }`（`:16-18`）都被出口函数签名引用，删形参即改对外契约；顺带记录：这两个字段当前是**静默 no-op**（下划线形参），属正确性问题，应走普通 review 而非 ponytail 裁剪。

## Considered and rejected

- `host/modules/h3.ts:1-2` 的 `HTTPError` / `readRawBody` / 类型 `EventStreamMessage` / `EventStreamOptions` — 仓内零消费者（rg：这些标识符只出现在该重导出行；`EventStream` 有消费方 `packages/dsh-tauri-pet/src/host/routes/session/stream/get.ts:2`）。但这行经 `src/index.ts` 出口，属协议面 ⇒ `keep: h3 重导出面保留；其内部 4 个零消费符号可收敛，但不得删导出本身。` 不计入 net。
- `client/types/harness.ts:61-62` `SlotEntryLike = StoredEntry` / `SlotEntryOptions = StoredEntry['options']` — rg `SlotEntryLike|SlotEntryOptions` 全仓仅这 2 行声明。是 `export type * from './types/harness'` 的出口面 ⇒ `keep:`，不删。
- `client/types/tauri.ts` 的 `InvokeOptions` / `Options` 接口本体（4 行）——出口面类型，同上，只删实现里的无效参数。
- `client/register/index.ts:98-103` 的"返回 cleanup / cleanup 数组"兜底分支 — 生产 setup 无返回值，仅 `index.test.ts:34 return []` 触发；但文件注释写明是既有插件的"老写法兜底"（跨仓兼容），保留成本 6 行 < 破坏在仓外插件的风险 ⇒ 留。
- `client/modules/*`（css-render / hookable / tailwind-variants / date-fns / lodash-es / reause / valtio-define）单行重导出 — 不是冗余：`docs/specs/plugin.client.md:132` 规定客户端依赖必须经 `dsh-tauri/client` 隔离（`export *` 会把 reause 的 306 个导出灌进 client.cjs，941KB → 70KB）。`modules/hookable.ts` 与 `modules/date-fns.ts` 仓内暂无插件消费，但同属该白名单契约 ⇒ 留。
- `client/modules/lodash-es.ts` 38 名字白名单 — 部分名字仓内暂无消费者，但该表按规范是"按需追加"的对外 surface（规范明确要求缺方法时补进此文件）。剪枝会静默破坏仓外插件 ⇒ `keep: lodash 白名单保留；其内部未被消费的名字由维护者按发布节奏收敛。` 不计入 net。
- `client/types/index.ts` = `export * from './harness'`（单行 barrel）— 是"只导出一行"，但被 8 处 `from '../types'` 依赖，删它只换来 8 个文件的 import 改写，纯增改动量 ⇒ 留。
- `host/config/runtime.ts` `defineHostRuntime<C>()` 单调用点 — 注释声称"每插件各调一次"，本仓仅 1 次；但 `getCurrentHostInstance/setCurrentHostInstance` 被 7 个包消费（`packages/dsh-tauri-*`），是跨包协议 ⇒ 留。
- `host/service/index.ts` `defineService` 6 行恒等函数 — 编译期宏，`docs/specs/plugin.host.service.md:11-16` 强制，~30 个服务文件消费 ⇒ 留。
- `host/routes/index.ts` 的 401/403、OPTIONS 204、405+allow、loopback、`cross-origin-request`、`cache-control: no-transform` 分支 — 每条都对应宿主版本漂移/压缩中间件的实错，非投机 ⇒ 留。
- `host/service/gate.ts`（双 gate 接管 + restore 记账）、`host/utils/atomic.ts`（Windows EPERM rename 重试）、`host/utils/open.ts:27-42`（刻意不复用 `spawnDetached`，避免 explorer 首窗被 SW_HIDE）、`client/locale/index.ts` `installations` 引用计数 — 均为已记录的兼容性刚需 ⇒ 留。
- `dsh-tauri-bundle/package.json`（11 个 `workspace:*` 的私有聚合包）、ui-playground（`src/host/apply.ts:2` 故意空实现、constants/locale/panel 每条常量都有消费方）、`packages/.test/test-utils.ts` — 无过度设计。
- 依赖：`h3`/`hookable`/`ofetch`/`unstorage` 四个 runtime dep 全都被真实调用，devDeps 全部被 `src/client/modules/*` shim 或测试消费 ⇒ 无可删依赖。

## net: -20 lines, -0 deps possible.

> Lead 复核修正：原 net -44 含三条协议面裁剪（-10/-8/-6），已移入上方 `keep:` 小节并不计入 net。剩余裁剪项：controller hookable→Set (-10)、`defineDshConfig` client:false 分支 (-6)、`click` (-3)、`dshClientInline` 白名单里的 `pathe` (-1)。
