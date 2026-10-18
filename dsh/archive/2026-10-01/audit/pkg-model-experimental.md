# packages/dsh-tauri-model + dsh-tauri-experimental — ponytail-audit

> Scope: packages/dsh-tauri-model, packages/dsh-tauri-experimental · ~13.4k LOC · read 2026-09-30

方法：每个 `delete:` / `yagni:` 都用全仓检索证明零调用方（本会话 `rg` 不在 PATH，全部用同等的全仓正则检索，检索式写在各条末尾）。判定沿用 `docs/audit/protocol-surface.md`：被 `src/index.ts` / `client/index.ts` / `host/routes/index.ts` 导出、或被字符串通道引用的符号属协议面，只做 `shrink:`（保留同名对外形状）或 `keep:`。

## Findings (ranked, biggest cut first)

### dsh-tauri-model

`shrink: modelStyles / welcomeStyles / onboardingStyles / onboardingDialogStyles 是 84 行人工维护的「键 → 哈希类名」映射表，必须与上面的 CSS 模板字符串手工对齐；四张表都能从 CSS 文本推导。` 写法：`const modelStyles = Object.fromEntries([...MODELS_CSS.matchAll(/\.(zGbnIq_(\w+))/g)].map(([, className, key]) => [key, className]))`（`prefix` 换成 `zGbnIqw_`/`zGbnIqo_`/`zGbnIqd_` 各 1 行；`hiddenLabel` 这类驼峰键与类名本来就一一对应）。漂移已经发生过：`org`/`w3` 两个键指向的类名在 CSS 里根本不存在，`hiddenLabel`/`switchThumb` 两个键（规则在 `styles.ts:611`、`styles.ts:622` 的 media 块内）零消费者。 [packages/dsh-tauri-model/src/client/models/styles.ts:779-868] (-80 LOC)

`shrink: packages/dsh-tauri-model/src/client/types/remotes.ts 前 10 行 + LlmModelDiscoveryRequest + LlmDiscoveredModel 是对 packages/dsh-tauri-ui/src/client/types/remotes.ts 的逐字重复。` `dsh-tauri-ui/client` 已经发布这几张类型（`packages/dsh-tauri-ui/src/client/index.ts:23` 的 `export * from './types/remotes'`），且已是本包的直接依赖（`packages/dsh-tauri-model/package.json:73`）与本包 src 里到处在 import 的入口（`ModelInputTypes.tsx:4` 等 13 处）。改成 `export type { JsonValue, RemoteFailure, RemoteResult, LlmModelDiscoveryRequest } from 'dsh-tauri-ui/client'`，`LlmDiscoveredModel` 换成 `interface LlmDiscoveredModel extends UILlmDiscoveredModel { inputModalities?: readonly string[] }`（本包只多这一个字段）。检索式：`JsonValue|RemoteFailure|RemoteResult|LlmModelDiscoveryRequest`（全仓）。 [packages/dsh-tauri-model/src/client/types/remotes.ts:1-10,52-57] (-14 LOC)

`delete: model-extras 的 MODEL_EXTRAS_KEYS —— 17 项字面量数组 + barrel 转出，唯一读者是它自己的测试。` 测试只是断言「每条 key 在字典里非空」，删 key 列表后该断言对 UI 无意义。检索式：`MODEL_EXTRAS_KEYS`（全仓，命中 translate.ts:4 声明、index.ts:9 转出、model-extras.test.tsx:7,59,60）。 [packages/dsh-tauri-model/src/client/ui/model-extras/translate.ts:4-21, packages/dsh-tauri-model/src/client/ui/model-extras/index.ts:9] (-19 LOC)

`yagni: createSettingsSchemaOperations —— 20 行工厂里 7 个成员全是纯转发 lambda（rehydrate/validate/nodeAtPath/getPath/hasPath/setPath/deletePath 逐个 `=> service.x(...)`），全仓唯一构造点是 register/models.ts:48。` 直接传 `ctx.settingsSchema`：`SettingsSchemaOperations = Pick<SettingsSchemaService, …>` 是结构类型，赋值即成立；工厂没有任何运行时行为可保留。检索式：`createSettingsSchemaOperations|SettingsSchemaOperations`（全仓）。 [packages/dsh-tauri-model/src/client/models/schema-operations.ts:10-20] (-11 LOC)

`delete: 同一批类型被声明两遍 —— ModelDiscoveryOutcome 在 service/model-config.ts:21 与 models/operations.ts:15 各写一份；ServiceLookup 在 models/remote.ts:3 与 models/settings-forms.ts:24 各写一份。` 各自只保留一份、另一处 import。检索式：`ModelDiscoveryOutcome`、`ServiceLookup`（全仓）。 [packages/dsh-tauri-model/src/client/models/operations.ts:15, packages/dsh-tauri-model/src/client/models/settings-forms.ts:24] (-10 LOC)

`delete: 三个只被自己的测试读到的导出 —— withPath（model-config.utils.ts:69-71，生产只用 withDetail/withCount/modelConfigNotice）、presetTableSize（model-presets.ts:42-44）、PRESET_FIXTURE 整个文件（model-preset-fixtures.ts:1-12，测试夹具却躺在 src/ 里、会被打进产物）。` `withPath` 直接删；`presetTableSize` 删（测试改成 `Object.keys(PRESET_FIXTURE).length`）；夹具搬进 `model-presets.test.ts`。检索式：`withPath`、`presetTableSize`、`PRESET_FIXTURE`（全仓，三者的非测试命中数均为 0）。 [packages/dsh-tauri-model/src/client/service/model-config.utils.ts:69-71, packages/dsh-tauri-model/src/client/service/model-presets.ts:42-44, packages/dsh-tauri-model/src/client/service/model-preset-fixtures.ts:1-12] (-20 LOC)

`yagni: model-extras 的 *.types.ts 拆包 —— auto-config-all-button.types.ts（5 行，导出 AutoConfigAllButtonProps）与 model-fetch-config-button.types.ts（5 行，导出 ModelFetchConfigButtonProps）各自只被同目录的一个 .tsx 消费一次，再加 index.ts 一行转出。` 类型内联进对应 .tsx（`model-compat-fields.tsx:21`、`model-config-toolbar.tsx:21` 就是这么做的，格式本来就不统一）。 [packages/dsh-tauri-model/src/client/ui/model-extras/auto-config-all-button.types.ts:1-5, packages/dsh-tauri-model/src/client/ui/model-extras/model-fetch-config-button.types.ts:1-5] (-9 LOC, -2 files)

### dsh-tauri-experimental

`delete: 整个客户端「摘要重试调度」机器 —— 它唯一的 arm 开关（`awaitingTurn`）从来没被扳过。` `awaitingTurn` 只由 `service/summary.ts:38-49` 的 `expectTurn` 写入，而 `expectTurn` 全仓零调用方（检索式：`expectTurn`，命中 summary.ts:38 的声明与其文档；无任何 import）；于是 `register/summary.ts:36-37` 的判定永远走 `forget/continue`，重试循环 20 行永不执行，`attempts`/`nextAt` 两个 Map 恒空。删除面：`register/summary.ts:23-53`、`service/summary.ts:32-49`、`session.types.ts:8-12` 的 `awaitingTurn`、`constants/index.ts` 的 4 个 `RUNNING_CHANGES_SUMMARY_*`、`utils/format.ts` 的 `summaryRetryDelayMs`（唯一调用点 register/summary.ts:49）。行为等价：`awaitingTurn` 恒为 `null` 时该循环就是 no-op。 [packages/dsh-tauri-experimental/src/client/register/summary.ts:23-53, packages/dsh-tauri-experimental/src/client/service/summary.ts:32-49, packages/dsh-tauri-experimental/src/client/store/modules/session.types.ts:8-12] (-62 LOC)

`delete: host/utils/paths.ts 的「撤销/回滚写盘」整块能力 —— assertSafeParents + removeCreatedPath + PathSafety 类型 + 三个为此存在的 reason 码，生产调用方 0。` 唯一消费者是 `paths.test.ts`（检索式：`removeCreatedPath|assertSafeParents|REASON_NON_EMPTY_DIR|REASON_UNSAFE_PATH`，非测试命中只有 `config/constants.ts:13` 的 import 自己、`paths.ts` 自身、以及 `shared/constants.ts:34` 的码值声明）。连带 `host/config/constants.ts:12-13,68-72` 与 `shared/constants.ts:34`。保留 `resolveInsideWorkspace`（retention.ts:81 在用）。注意 `REASON_WORKSPACE_CHANGED` 不在此列 —— capture.ts:136,149,376 真用。 [packages/dsh-tauri-experimental/src/host/utils/paths.ts:28-80, packages/dsh-tauri-experimental/src/host/utils/paths.types.ts:1-2] (-62 LOC)

`delete: 七个只被自家测试碰过的服务/工具成员。` 全部检索式均为「符号名 + 全仓」，非测试命中数为 0：
- `capture.begin` —— `capture.ts:88-93`，注释自己写着「这里保留合并形态」；只有 capture.test.ts（22 处）。（检索式：`capture.begin`）
- `capture.pending` —— `capture.ts:229-246`；只有 capture.test.ts（9 处）。（检索式：`capture.pending`）
- `snapshot.generation` —— `snapshot.ts:82-86`；只有 snapshot.test.ts:413,421。（检索式：`snapshot.generation`）
- `snapshot.read` —— `snapshot.ts:208-216`；只有 snapshot.test.ts:423。（检索式：`snapshot.read`）
- `retention.describe` —— `retention.ts:145-154`；只有 retention.test.ts:156,163。（检索式：`retention.describe`）
- `queue.size` —— `queue.ts:42,113`；只有 queue.test.ts（8 处）。（检索式：`\.size\(\)`）
- `lock.lockPath` —— `lock.ts:148` + `lock.types.ts:32-33`，注释自己写着「诊断与测试用」；只有 lock.test.ts（11 处）。（检索式：`\.lockPath`）

[capture.ts:88-93,229-246 / snapshot.ts:82-86,208-216 / retention.ts:145-154 / queue.ts:42,113 / lock.ts:148, lock.types.ts:32-33] (-56 LOC)

`shrink: src/client/types/index.ts 把两个路由的线上类型整套手写了一遍，而同一份形状已经由 src/client/apis/index.type.ts 生成。` 该文件被 `client/index.ts:23` 的 `export type * from './types'` 转出，属协议面 —— 保留对外名字，把 40 行声明换成 `export type { LiveSnapshot, TurnFileChange, TurnFileStatus, TurnSummary } from '../apis/index.type'` + 本文件仅留 `SessionSummary`/`LocaleKey` 的别名。检索式：`TurnFileStatus|TurnFileChange|SummaryPayload|LiveSnapshot`（全仓）。 [packages/dsh-tauri-experimental/src/client/types/index.ts:1-49] (-40 LOC)

`delete: CaptureLimits 这套「可注入上限」—— CaptureOptions.limits 的生产调用方 0，唯一注入点是 snapshot.test.ts:245,264。` 生产 `capture.ts:358` 只传 `{exclude, nestedDirs}`，于是 `snapshot.ts:107-111` 的 `options.limits?.x ?? MAX_*` 三行退化为常量，`types/index.ts:41-49` 的接口与 `:58` 的字段一起删。检索式：`CaptureLimits|limits\?\.`（全仓）。 [packages/dsh-tauri-experimental/src/host/types/index.ts:41-49,58, packages/dsh-tauri-experimental/src/host/service/snapshot.ts:104-111] (-16 LOC)

`delete: host/config/constants.ts 的 16 行「孤儿文档注释」—— 注释还在，被注释的常量早已不存在。` 具体行：`17`（快照 ref 前缀）、`39-43`（聚合字节/文件数/预扫排除/仓库容量四项上限）、`46-51`（资格探测超时、工作区缓存 TTL/条目上限、摘要文件上限、未纳入快照路径上限、实时刷新间隔六项）、`55`（PATH 无 git 的原因码）、`59-61`（快照文件数/聚合字节/超限文件三项原因码）。同文件现存声明只有 18 个（19/22/25/28/31/37/44/53/57/63/66/69/72/75/78/88/91/94 行），其余注释无对应代码。 [packages/dsh-tauri-experimental/src/host/config/constants.ts:17,39-43,46-51,55,59-61] (-16 LOC)

`stdlib: retention.measure 手写递归目录遍历（19 行 walk + 逐文件 stat），Node 20+ 的 fs.promises.readdir 自带递归。` 换成 `const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])`，再对 `entry.isFile()` 取 `stat(join(entry.parentPath, entry.name)).size`（原本就 best-effort、每个 stat 各自吞异常）。函数名：`fs.promises.readdir(path, { recursive: true, withFileTypes: true })`（Dirent.parentPath）。 [packages/dsh-tauri-experimental/src/host/service/retention.ts:117-143] (-10 LOC)

`yagni: hookable 事件总线只服务一个自产自销的 hook —— runningChangesHooks 的唯一 emit 点是 capture.ts:181，监听方 0（只有 capture.test.ts:65,70 注册过）。` 该模块不在包入口（`src/index.ts` 只导出 `apply`，`package.json` 的 `exports` 只有 `.` 与 `./client`），仓外插件拿不到它。把 `await runningChangesHooks.callHook('turn:captured', …)` 换成直接调用/删掉这一行，`host/events/index.ts:1-9` 与 `hookable` 依赖一起退场。检索式：`runningChangesHooks|turn:captured|from 'hookable'`（全仓；其他包各自有自己的 hooks，与本包无关）。 [packages/dsh-tauri-experimental/src/host/events/index.ts:1-9] (-9 LOC, -1 dep)

`shrink: snapshot.ts:469 的 store.commonDir ?? await resolveSourceCommonDir(store.worktree) 是防御一个不可能发生的分支。` `snapshot.resolve` 的三个生产调用点里，`capture.ts:338` 传的 `probe.commonDir` 在 ok 分支上必然是 string；`resolveSourceCommonDir`（git.ts:98-108）除这一行外零调用方，`SnapshotStore.commonDir?` 的可选性也随之可以收紧。检索式：`resolveSourceCommonDir`（全仓，命中 snapshot.ts:469 与 git.ts 定义）。 [packages/dsh-tauri-experimental/src/host/service/snapshot.ts:469, packages/dsh-tauri-experimental/src/host/utils/git.ts:98-108] (-12 LOC)

`yagni: 客户端 store 的三层壳 —— store/index.ts 只包了一个成员、session.utils.ts 的泛型只有一个实例化形状、service/summary.ts 的 messageOf 只有一个调用点。` `store/index.ts:1-5` 的 `{ runningChanges }` 命名空间可以直接 export 那个 store（`store.runningChanges.$state` 的中间层消失）；`session.utils.ts:17` 的 `<C extends { bySession: Record<string, unknown> }>` 收成具体参数类型；`messageOf`（summary.ts:53-56）内联进唯一调用点 summary.ts:28。 [packages/dsh-tauri-experimental/src/client/store/index.ts:1-5, packages/dsh-tauri-experimental/src/client/store/modules/session.utils.ts:17-24, packages/dsh-tauri-experimental/src/client/service/summary.ts:53-56] (-10 LOC)

## Considered and rejected

- `packages/dsh-tauri-model/src/client/models/styles.ts` 的 870 行哈希 CSS —— 看着像「上游 CSS 的复制品」，实际不是：`packages/dsh-tauri-model/THIRD_PARTY_NOTICES.md:49` 明写「Styling runs on this repo's css-render stack；upstream `.module.css` files are not copied」，`.zGbnIq_*` 的哈希名是为对齐上游 DOM 的 `className` 而保留。本仓没有第二份 `.zGbnIq_` 定义（检索式 `zGbnIq`；`packages/dsh-tauri-ui/src/client/components/action.tsx:1` 只是登记上游来源的注释），所以它是本插件唯一样式来源，不删。（可删的是上面那条：人工映射表 + 4 个死键。）
- `packages/dsh-tauri-model/src/client/models/styles.overrides.ts:1-39` —— `.{x}.{x}` 双写选择器提权到上游样式之上，是刻意的、也只 39 行，没有更短的可移植写法。
- `packages/dsh-tauri-model/src/client/models/locales.ts` 的 131 个 key —— 全仓逐个核对，**零未使用**（检索式：每个 key 在全仓 `.ts/.tsx` 的出现次数，统计脚本见下）。265 行不是冗余。
- `packages/dsh-tauri-model/src/client/service/model-presets.ts` 的 13 条家族正则表 + `FAMILY_RULES`/`GRADED`/`combine` —— 与 host 侧 litellm 表是两套互补来源（表命中就查表，未命中才退正则），不是重复实现。
- `packages/dsh-tauri-experimental/src/host/utils/lock.ts` 的 TCP 监听锁 —— 用内核持有的监听句柄做跨进程互斥、且**刻意不做 TTL 抢占**（`config/constants.ts:80-88` 有完整理由），Node 没有等价的跨进程锁原语，`native:` 不成立。
- `packages/dsh-tauri-experimental/src/host/utils/queue.ts` 的双闸设计（FIFO 尾链 + 锁超时预算 `waitDeadline`）—— `capture.ts` 真的两个都传，`waitDeadline` 不是死配置。
- `packages/dsh-tauri-experimental/src/host/utils/git.ts:66-71` 的 `child.stdin?.on('error', () => {})` —— 针对 Linux EPIPE 的已知 workaround，删了会偶发崩，保留。
- `packages/dsh-tauri-experimental/src/client/register/paste-collapse.types.ts` 的 13 个结构类型 —— 描述 `ctx.inject(['inputTriggers'])` 的跨包契约（`inputTriggers` 是协议面），虽然 5 个类型只在同文件内被引用，仍属对外形状，只算 export 关键字多余，不值得动。
- `packages/dsh-tauri-experimental/src/client/register/running-chip.ts:5,12` 的 3 处 `as never` —— 类型逃逸难闻，但换成正确的槽位泛型要引入跨包类型耦合，代价大于收益。
- `pathe` / `unstorage` —— 两者都是实验包 host 侧的真实实现依赖（`host/storage/index.ts:2-3`、`host/utils/lock.ts:23` 等），`fsAtomicDriver` 来自 `dsh-tauri` 而非本包手搓；`pathe` 提供 posix 语义的路径运算，正是 git 子进程需要的，`node:path` 在 Windows 上不等价。
- `packages/dsh-tauri-model` 的 `react-if-lite` devDependency + `tsdown.config.ts:6` 的 `noExternal` —— 已由 `docs/audit/dependencies.md:16` 记录在案，本文件不重复计数。
- `packages/dsh-tauri-model/package.json:42-52` 的 `dsh.client.inject` 与 `src/client/index.ts:17-26` 的 `inject` —— 名字撞车但语义不同：前者是客户端 bundle 的模块依赖（`@deepseek-ai/*` 包名），后者是内核服务名，不是同一份声明的两处副本。
- `packages/dsh-tauri-experimental/src/host/service/workspace.ts` 的 60s 缓存 + stale-while-revalidate —— 把 30s 的 git 资格探测从 pre-step 屏障上摘下来是这个设计的全部理由，不是为了抽象而抽象。

统计脚本（用于 locales / styles 的未使用 key 判定，`rg` 不在 PATH 时的替代）：

```powershell
$files = git ls-files "packages/dsh-tauri-model/src"
$body = ($files | Where-Object { $_ -notmatch 'styles\.ts$' -and $_ -notmatch '\.test\.' } | ForEach-Object { Get-Content $_ -Raw }) -join "`n"
# 对每个候选 key 判 $body -notmatch "\b$k\b"
```

## 执行复核（2026-09-30）

- 已执行：CSS 派生类名映射、复用远端/领域类型、组件 props 就地声明、测试夹具迁入 test-only 目录、删除内部 `withPath`/`presetTableSize`；既有组件类型出口名称保留。
- 已执行：删除从未 arm 的客户端摘要重试及其孤立的 service/store 子树（`fetchSummary` 唯一调用者是该调度器和无人调用的 `expectTurn`）；保留实时读数轮询、`getSummary` HTTP API 及宿主账本能力。
- 已执行：删除无生产调用的回滚写盘辅助实现、`capture.begin/pending`、`snapshot.generation/read`、`retention.describe` 与孤儿注释；测试改走生产 `start/awaitBegin`、账本、refs 与持久化结果，未删除生产行为断言。
- 协议修正：`TurnSummary.hasBaseline` 现有契约为可选，而生成 DTO 为必选。复用 DTO 时仍保留可选字段和 interface 形状；不得按原建议直接 alias 收窄。增加旧/新载荷编译检查。
- `keep:` `MODEL_EXTRAS_KEYS` 与组件 props 类型仍有 UI barrel 出口；`runningChangesHooks`/`turn:captured` 注释明确承诺扩展生命周期事件；共享原因码 `RUNNING_CHANGES_REASON_UNSAFE_PATH` 仍保留协议定义，`hookable` 依赖不删。
- `keep:` `createSettingsSchemaOperations` 提供可脱离接收者调用的函数，原 service 的 `hasPath/deletePath` 使用 `this`。直接替换会破坏公开注入面的调用语义。
- `keep:` `CaptureLimits` 用小夹具验证真实容量边界；`queue.size`/`lock.lockPath` 守护尾链清理与旧锁围栏安全；`commonDir` 省略值确有调用/测试，fallback 负责继承源仓排除规则。
- `keep:` `retention.measure` 的原逐目录 best-effort 遍历。原建议递归 `readdir` 后只取 `isFile()` 会改变符号链接计量与子目录读取失败语义，已有回归覆盖，不为少几行改行为。

原 `net: -456 lines, -2 deps possible` 是审计预估（包含上述撤回项及重叠），不是执行结果；本次未删依赖。
