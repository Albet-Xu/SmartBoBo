# packages/dsh-tauri-worktree + dsh-tauri-archive + dsh-tauri-pet — ponytail-audit

> Scope: packages/dsh-tauri-worktree, dsh-tauri-archive, dsh-tauri-pet · ~13k LOC · read 2026-09-30

搜索证据说明：本机 `rg` 不在 PATH，零引用证明统一用 harness grep 工具（ripgrep 内核）+ `git ls-files`，范围排除 `node_modules` / `dist`，每条的检索串写在括号里。

## Findings (ranked, biggest cut first)

- `shrink:` `handoff.complete` 把 `createInherited` 整个函数体抄了一遍（presets/seed/meta/inheritedEventCount/agentOptions/setup/agents.create/resolveByPath+attachSession/pendingWorktreeTitles），只多一句 followup。改成 `createInherited(sourceSession.id, { cwd: binding.worktreePath, parentSession: sourceSession.id, targetSessionId, attach: true })` 后再发 followup；`createInherited` 已经收 `targetSessionId`，只需把 agent handle 一并返回。 [packages/dsh-tauri-worktree/src/host/service/handoff.ts:73-119] (-45 LOC)
- `yagni:` cleaner 的进程内退避重试阶梯（`RETRY_BACKOFF_MS` 17、`timers` 22、`clearRetry` 148-154、`backoffOf` 156-159、`scheduleRetry` 162-177、settle 里 203-205）与既有的 `recover()` 巡检重复：失败任务已经由 `worktree.recover()` → `cleaner.unsettled()` → `cleaner.start(..., true)` 在每次 turn/end（`events/session-event.ts:20`）、插件启动与每 5 分钟（`host/apply.ts:36-38`）重跑。删掉退避梯子，失败态交给巡检。 [packages/dsh-tauri-worktree/src/host/service/cleaner.ts:148-177] (-35 LOC)
- `shrink:` `createKeyedThrottle` 59 行通用节流器只有 1 个调用点（`register/hydration.ts:55`），`now` 选项从未传过、`schedule` 永远是同一个 `controller.timeout`；`KeyedThrottleOptions`/`KeyedThrottle` 也只为它存在。内联成 hydration.ts 里 15 行的 `Map<string, number>` 时间戳判断。 [packages/dsh-tauri-worktree/src/client/register/hydration.utils.ts:9-58] (-30 LOC)
- `shrink:` `pet.ts` 12 个导出全是同一个 `try { await … } catch { console.error('[dsh-tauri-pet] X failed:', e); return { ok:false, error: messageOf(e) } }` 模板。换成 `guard(label, fn)` 一个 helper，12 个导出各剩 1 行。 [packages/dsh-tauri-pet/src/client/service/pet.ts:1-229] (-30 LOC)
- `yagni:` `pet.invoke.ts` 是 10 个纯转发包装（`return invoke(CMD_X, {...})`），唯一调用方就是上一层 `pet.ts`；合进 `pet.ts` 后这一整层消失。 [packages/dsh-tauri-pet/src/client/service/pet.invoke.ts:1-58] (-30 LOC)
- `shrink:` `ledger.load`、`checkoutContext.load`、`jobs.load` 各自手写「读 DSH_HOME 下的 JSON 文件 + 容忍文件缺失 + 校验形状」，而三者的 `save` 都走同一个 `storage` driver。抽一个 `readJson<T>(key, parse)`，三个 load 各剩 2 行。 [packages/dsh-tauri-worktree/src/host/service/ledger.ts:11-13, checkout-context.ts:10-17, jobs.ts:14-26] (-30 LOC)
- `shrink:` 7 个 archive route handler 的 6 行「取 body → 校验 sessionId(s) → 400」块逐字重复，只有 error 文案不同。抽 `readSessionId(event)` / `readSessionIds(event)` 放 `routes/index.types.ts`。 [packages/dsh-tauri-archive/src/host/routes/session/archive/post.ts:6-11, session/archive/delete.ts:6-11, session/workspace/archive/post.ts:6-13, session/archive/restore/post.ts, session/archive/clear/post.ts, session/workspace/archive/delete.ts, session/open/path/post.ts] (-25 LOC)
- `shrink:` `session-switch.ts` 里 `waitForSessionListed`(20-30)、`waitForInputActions`(32-42)、`openSession`(44-65) 是三个同构 `for (attempt < attempts) { …; await input.wait(delayMs) }` 重试循环（两个 `*WaitInput` interface 也只是把同一组字段抄三遍）。抽一个 `retryUntil(input, probe, delayMs)`。三个函数都是活的（`mode-select.tsx:148,167,206`、`dialog.tsx:89,97`），只是重复。 [packages/dsh-tauri-worktree/src/client/service/session-switch.ts:20-65] (-25 LOC)
- `shrink:` `pet-settings.tsx` 6 个 handler（97-162）各自重复 `if (busy) return; setBusy(true); setError(null); … if (!result.ok) setError(locale.text(key)); setBusy(false)`。抽 `run(action, errorKey)`。 [packages/dsh-tauri-pet/src/client/components/pet-settings.tsx:97-162] (-25 LOC)
- `delete:` pet 的 `toolActivity` 全链路是只产不消的死字段：`PetToolActivity` 类型、`PetSessionPayload.toolActivity`、`PetSessionState.toolActivity`、`toolActivityOf`、两处赋值、`payloadEqual` 里的一处比较。检索串 `toolActivity`（全仓 `*.ts/*.tsx`）：`src/` 只命中前端自有的 `toolActivityGroup(toolName)`（`src/pet/hooks/use-bubble-tracker.helpers.ts:62,178`），没有任何 `session.toolActivity` 读取；`src-tauri/src/**/*.rs` 检索 `toolActivity|tool_activity` 零命中（Rust 只做转发）。 [packages/dsh-tauri-pet/src/host/service/session-stream.utils.ts:207-218,373,394,541; host/types/index.ts:15,35; host/service/session-stream.types.ts:65] (-22 LOC)
- `shrink:` `RemoveDirectoryDependencies` DI 接口 + `defaultDependencies` 只有一份生产实现，替换实现只出现在它自己的测试里（检索串 `RemoveDirectoryDependencies`）。直接用 `node:fs/promises`，测试改注入模块而非选项对象。 [packages/dsh-tauri-worktree/src/host/utils/filesystem.ts:17-31,102-148] (-20 LOC)
- `native:` 用 `simple-git` 只为跑 8 个 git 子命令（`git`/stagedPatch/applyStagedPatch/carryStagedChanges/gitToplevel/shortHead/headSubject），而 `applyPatchArchive` 本来就要自己落 patch 文件。改成 `node:child_process` 的 `execFile('git', args)`（git 已是硬依赖）。 [packages/dsh-tauri-worktree/src/host/utils/git.ts:5-6] (-20 LOC, -1 dep)
- `shrink:` session 列表快照类型被抄了 4 份：worktree 内两份（`session-switch.types.ts:16-19` 与 `hydration.types.ts:1-5`，后者多一个 `phase?`），archive `types/runtime.ts` 一份，pet `pet.utils.ts:10-13` 一份。收敛成一处导出。 [packages/dsh-tauri-worktree/src/client/service/session-switch.types.ts:16-19] (-20 LOC)
- `shrink:` `archive-panel.tsx` 里三个并列 `<Modal>`（`confirm.kind` 分别为 single/all/workspace）共用同一个 `footer` 与 `closeLabel`，只有 title/description 不同。合成一个由 `confirm.kind` 计算文案的 Modal。 [packages/dsh-tauri-archive/src/client/components/archive-panel.tsx:212-235] (-18 LOC)
- `stdlib:` 三个包里用 `lodash-es` 的地方基本只有 `get` / `isString` / `compact` / `filter` / `map` / `find` / `isEmpty`，全都有原生等价物（`?.` + `??`、`typeof x === 'string'`、`Array.prototype.filter/map/find`、`Object.keys(x).length === 0`）。替换后 worktree 16 个文件 + archive 3 个文件的 import 行消失，且这两个包可以去掉 `lodash-es`。 [packages/dsh-tauri-worktree/src/**; packages/dsh-tauri-archive/src/**] (-19 LOC, -2 dep entries)
- `shrink:` `pet-settings.tsx` 的 `petsPanel`(197-231) 与 `codexPanel`(233-251) 把同一组 `<PetCard>` props 逐字映射两遍（215-227 与 237-249 仅来源数组不同）。抽一个 `<CardList items actionLabel/>`。 [packages/dsh-tauri-pet/src/client/components/pet-settings.tsx:215-249] (-15 LOC)
- `shrink:` `worktree-section.ts` 与 `worktree-context.ts` 结构逐行相同（`{ name, order: WORKTREE_SECTION_ORDER, text(context) { 取 scope.session.id → ledger.load → 调文案函数 } }`），只差 `name` 和文案函数；合成一个 `promptProvider(name, build)` 工厂。 [packages/dsh-tauri-worktree/src/host/prompts/worktree-section.ts:1-18, worktree-context.ts:1-18] (-12 LOC)
- `delete:` `loadJobStatus` 在两个 client service 里逐字重复，保留一处导出即可。 [packages/dsh-tauri-worktree/src/client/service/hydration.ts:269-279 与 client/service/worktree.ts:112-122] (-11 LOC)
- `shrink:` `workspace.ts` 里 `registryOf()`(39-46) 与 `workspaceOf(path)`(48-54) 是同一个 `getCurrentHostInstance().workspaceRegistry` 之上的两个访问器，合一个。 [packages/dsh-tauri-worktree/src/host/service/workspace.ts:39-54] (-8 LOC)
- `delete:` 三个纯死类型/字段（检索串 `CheckoutContexts`、`\bLedger\b`、`SessionSummaryLike`、`firstSeqAt`）：worktree `CheckoutContexts` 只在定义处命中，`Ledger` 只在定义处命中（另有一个局部测试别名 `worktree.recover.test.ts:21`，与本类型无关）；archive `SessionSummaryLike` 本包零引用（rightclick 有自己的一份）；pet `firstSeqAt` 只在 `session-stream.types.ts:66` 声明、`session-stream.utils.ts:166` 置 0，从不读取。 [packages/dsh-tauri-worktree/src/host/types/index.ts:21,30; packages/dsh-tauri-archive/src/client/types/runtime.ts:11; packages/dsh-tauri-pet/src/host/service/session-stream.types.ts:66] (-7 LOC)
- `delete:` worktree 的两个 link 选项没人设：`linkDependencyDirectories`（`EnsureOptions` 与 `CheckoutOptions` 各一份）全仓只被 `worktree.ts:69,213` 读、没有任何调用方传入（检索串 `linkDependencyDirectories`）；`linkDependencies` 只有 `worktree.test.ts:419,424,463` 传，生产恒取 `LINK_DEPENDENCIES = true`（检索串 `linkDependencies`）。删选项后 `normalizeLinkDirectories`/`removalLinkDirectories` 也可退化为常量。 [packages/dsh-tauri-worktree/src/host/types/index.ts:41-42,48; src/host/service/worktree.ts:52,69-70,213] (-7 LOC)
- `shrink:` `create-worktree.ts` 与 `checkout-worktree.ts` 结尾各有一份逐字节相同的私有 `textBlock(text)`。留一份共享 util。 [packages/dsh-tauri-worktree/src/host/tools/create-worktree.ts:89-91, tools/checkout-worktree.ts:68-70] (-6 LOC)
- `shrink:` `archive.delete(sessionId)` 与 `archive.deleteSelected(sessionIds)` 都是 3 行转调 `permanentlyDelete`。留一个收数组的入口（路由层各自包一层即可省掉一个 service 方法与一对 DTO）。 [packages/dsh-tauri-archive/src/host/service/archive.ts:36-43] (-6 LOC)
- `yagni:` 三个包的 `client/store/index.ts` 都是同构单字段包装（`export const store = { worktree }` / `{ archive }` / `{ pet }`），store 模块本身已是具名导出；直接导出模块。 [packages/dsh-tauri-worktree/src/client/store/index.ts:3-5; packages/dsh-tauri-archive/src/client/store/index.ts:3-5; packages/dsh-tauri-pet/src/client/store/index.ts:4-6] (-6 LOC)
- `delete:` `liveActivity.command` / `liveActivity.path` 只声明不产出、也无人读：`toolActivity()` 只返回 `{ kind, name, args }`，`payloadEqual` 里对 `command`/`path` 的比较恒为 `undefined === undefined`；前端 `use-bubble-tracker.helpers.ts:149` 只解构 `kind/text/name/args`。 [packages/dsh-tauri-pet/src/host/types/index.ts:36-42; host/service/session-stream.utils.ts:529-558] (-6 LOC)
- `shrink:` `routes/bindings/get.ts:16` 与 `routes/post.ts:41` 各自内联 `` `${hash}/${dirname}` ``，而 `utils/paths.ts` 已有 `worktreeKey()`；改调它。 [packages/dsh-tauri-worktree/src/host/routes/bindings/get.ts:16, routes/post.ts:41] (-3 LOC)
- `yagni:` `WorktreeParams` 同时收 `worktreeHashDirname` 与 `worktree_hash_dirname`（`create` 里 `??` 兜底），但每条调用链永远只有一种拼法（tools 传 snake_case，client/routes 传 camelCase）。删掉别名，各层按自己那一种传。检索串 `worktree_hash_dirname|worktreeHashDirname`。 [packages/dsh-tauri-worktree/src/host/types/index.ts:67-68; src/host/service/worktree.ts:206] (-3 LOC)
- `delete:` `SIDEBAR_ATTACH_POLL_MS` / `SIDEBAR_ATTACH_MAX_TRIES` 是两处无人读的数值轮询常量（检索串 `SIDEBAR_ATTACH_` 全仓只命中定义行；不是字符串通道 ID，属协议文件内部的多余配置）。 [packages/dsh-tauri-archive/src/client/constants/index.ts:17-18] (-2 LOC)
- `shrink:` `session-context.resolve` 里 `if (!isString(cwd) || !cwd) return null`（24-25）与紧接的 `if (!cwd) return null`（26-27）是同一个判空的两次写法。 [packages/dsh-tauri-worktree/src/host/service/session-context.ts:26-27] (-2 LOC)
- `delete:` pet payload 的 `activity` 是 `status` 的逐字节副本（`foldPetPayload` 同一变量写两次），前端读的是 `session.status ?? session.activity ?? session.phase`。 [packages/dsh-tauri-pet/src/host/service/session-stream.utils.ts:194-195] (-3 LOC)
- `delete:` worktree 声明了却从没被 import 的依赖：`hookable`（检索串 `hookable` 在本包内只命中 `package.json:60`）。 [packages/dsh-tauri-worktree/package.json:60] (-1 dep)
- `keep: pet 的 @deepseek-ai/dsh-skill-filesystem 保留。` — Lead 复核修正：原报告按「`packages/dsh-tauri-pet/src` 零命中」判为可删，但它是**字符串通道引用**——`packages/dsh-tauri-pet/cordis.patch.yml:3` 以 `name: '@deepseek-ai/dsh-skill-filesystem'` 把官方 skill provider 作为一行插进运行时插件图（`package.json:62` 在 `dependencies` 中声明；`THIRD_PARTY_NOTICES.md:14` 说明 `includeDefaultRoots: false` + `customSkillDirs` 指向本包 `skills/`）。按 `docs/audit/protocol-surface.md` §1「字符串通道引用 ⇒ keep」保留，不计入依赖裁剪。**教训：本仓的零调用方证明必须覆盖 `cordis.patch.yml` 等配置型字符串面，只检索 `src/` 不足以定论。**

## Considered and rejected

- `canonicalPath` 的「逐级上溯到存在的父目录再拼接」实现（`worktree.ts:506-529`）— 不是手写 realpath 的重复：`fs.realpathSync.native` 对尚未创建的工作树路径会抛 ENOENT，上溯回退正是它的用途。
- cleaner 的 `jobs.load/save` + `restore()` 落盘 — 进程重启后继续删上一次没删完的队列是这个功能的语义，不是在造持久层。
- `worktree-section/worktree-context/checkout-context` 三个 prompt provider、`defineRoutes` 的每条路由、`*_EFFECT` tag、slot id、`CMD_*` 命令名、`SESSION_STREAM_PATH`、`SSE_STATE_LOST_COMMENT`、`PET_HATCH_PROMPT` — 协议/字符串通道面，仓内无调用方是发布型插件的正常状态，一律保留（只裁它们内部的重复，见 findings）。
- `src/client/apis/index.ts` + `index.type.ts`（worktree、archive 各一份）— @swagger genapi 生成物，排除在审查外。
- `handoff.handback`、`worktree.detach`、`status.resolve`、`workspace.unregisterLegacy` 这些单调用方服务 — 各自是对外的生命周期/IPC 入口，不是「一个实现的抽象」。
- pet payload 的 `phase`、`pending`、`pendingInteraction`、`description`、`name`、`task`、`workStatus` — 前端气泡确实在读（`src/pet/hooks/use-bubble-tracker.helpers.ts:91,95,104-105,186`），属活协议字段；`src-tauri` 只做原样转发（`*.rs` 检索这些字段名零命中），删任何一项都会打断 webview。
- `pathe` — 故意用 POSIX 归一化的 join，产物会进 git 命令与 ledger key；换 `node:path` 会在 Windows 上回退。
- `unstorage` + `fsAtomicDriver`（`src/host/storage/index.ts`）— 原子写没有标准库替代。
- `session-icons.ts` 的 MutationObserver + React fiber 上溯找 sidebar 行 — 平台没有「定位宿主渲染的行」的 API，400ms 自取消轮询有上界。
- `RETRY_BACKOFF_MS` 的 5 档是否可达 — 可达（`backoffOf` 按 `attempts/3` 取档，每轮失败后重排，5 档都会命中），不是死配置；要裁它只能连整条自愈重试一起裁（见 findings 第 2 条）。
- `session-switch.types.ts` 的 `ListSessions/InputSessions/SwitchSessions` 三层窄化 — 三个都被 `session-switch.ts` 与其测试用到，是活类型，只是形状冗余（记在 shrink 项里）。
- 三个 `client/register/*.ts` slot 注入适配器（21/33/17 行）— `defineRegister` 是框架注册面，不是包装层。

## net: -490 lines, -4 deps possible.

> Lead 复核修正：原 net 的 -5 deps 含 pet 的 `@deepseek-ai/dsh-skill-filesystem`（实为 `cordis.patch.yml:3` 字符串通道引用，已降级 `keep:`）。当前 -4 deps = worktree `hookable` + worktree/archive 的 `lodash-es` 原生化 + worktree `simple-git` → `node:child_process`。

## 执行复核（2026-10-01）

- **已实施**：handoff 仅共享创建 agent 的步骤，保留 pending 捕获的 sourceAgent、不同 workspace 挂接路径、标题登记与 followup/失败清理；复用 prompt provider、loadJobStatus（两个导出路径均保留）、textBlock、worktreeKey 与包内 session 快照类型；删除重复 cwd 判空及未发布的 Ledger/CheckoutContexts 内部类型。
- **已实施**：worktree Git 调用改用原生 execFile，保留参数数组、stdout trim、无小容量输出限制、Windows 隐藏窗口及取消/超时选项。预取消信号不启动命令，运行中取消必须等待子进程 close 后返回，避免回滚与仍在执行的 Git 并发。静默非零退出现在明确返回失败，而非 simple-git 的空输出成功；调用方已复核并由真实临时仓库回归覆盖。
- **已实施**：archive 六个 handler 共享运行时校验，readBody 泛型、400 状态、错误文本与原先 String 转换/重复项/顺序均保留；删除确认合为一个 Modal；三处宿主 lodash 使用改原生集合操作。pet 合并同语义动作错误处理、内联私有 invoke 层、共享设置 busy 流程与 Chat/Codex 卡片映射，仅删除内部 firstSeqAt。
- **不实施**：cleaner 退避并不等同每五分钟巡检，删除会延迟失败恢复；hydration 节流还负责末次请求补发和取消，时间戳 Map 不等价；三个 JSON loader 的非缺失 I/O 错误处理不同；session 重试的刷新/探测时序不同；filesystem 的依赖注入用于隔离故障回归，均保留。
- **协议保留**：WorktreeParams 两种拼写、link 选项、pet toolActivity/activity/liveActivity 字段、archive delete/deleteSelected 服务与 DTO、已有公开类型/常量/方法、所有路由与生命周期注册；store 聚合入口是客户端规范要求，不删除。不同插件的快照类型不引入跨插件依赖。
- **依赖实绩**：移除 worktree simple-git、archive lodash-es 及其 @types/lodash-es 三个声明；worktree 仍需 lodash 的 isPlainObject/isString/uniqBy 等非简单等价语义。hookable 已在先前依赖 PR 删除，不重复计数；simple-git 的孤立 catalog 条目同步移除，pet skill provider 与仍被其他包使用的 catalog/锁文件依赖保留。
- **验证**：三包真实源码别名回归五轮乱序各 350 项通过，取消时序补强后另五轮各 29 文件 / 352 项通过；完整根 TypeScript、三包源码 TypeScript 与 ESLint 通过（仅三条既有 warning）；冻结锁文件校验通过。Git 失败吞掉、取消提前返回、archive 400→200、pet enable 条件反转的变异均被回归捕获，随后恢复实现。未执行本地插件构建。
