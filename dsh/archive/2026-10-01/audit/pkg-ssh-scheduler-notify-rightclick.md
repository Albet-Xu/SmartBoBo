# ponytail-audit · dsh-tauri-{ssh, scheduler, notification, rightclick}

> Scope：`packages/dsh-tauri-ssh` / `packages/dsh-tauri-scheduler` / `packages/dsh-tauri-notification` / `packages/dsh-tauri-rightclick` 的过度设计审查（level full）。只读审查，未改动任何被审查代码，未跑任何构建命令（只做静态阅读与只读 `git grep`）。
> 豁免：协议面按 `docs/audit/protocol-surface.md` 处理——凡从 `src/index.ts` / `client/index.ts` / `host/routes/index.ts` 出口、或经字符串通道（route `path`、Tauri command 名、slot 名、`ctx.effect` 标签、事件名）被引用者一律不判死；此类若内部确有冗余，写成 `keep:` 且**不计入 net**。正确性 bug / 安全 / 性能明确不在范围（仅必要时一句话注记）。
> 方法说明：对 ~70 个 ssh 导出名逐个跑了「定义行 / 非定义行」分离的 `git grep`（排除 `*.test.*`），除自设哨兵名外**没有任何 0 非测试消费者的导出**，故本报告不含「无人调用的函数」类发现，全部条目均为「有消费者但结构冗余」。
> 定位口径：`(-N LOC)` 是删掉该结构后净减少的行数（含随之消失的 import/空行），不含测试行数的二次收益。

## packages/dsh-tauri-ssh

- `delete: client/store/index.ts:172-200 / 203-231 / 234-259 / 335-369 四个手写 wire 解析器 machineEventsOf(29 行) + syncPreviewOf(29) + syncApplyResultOf(26) + machineRowOf(35). 把 this.callApi<unknown>(...) 的类型参数换成 host 响应类型后直接消费响应，删掉这四个函数及其校验分支. 证据：调用点 :634 / :814 / :844 全部写 `callApi<unknown>('machine.events'|'sync.preview'|'sync.apply')` 再手工 parse；同仓 scheduler 客户端（client/service/scheduler.ts:14-20）对同类生成物 wire 零运行时校验；且 host 侧 routes/index.ts 的 saveRowOf/listItemOf 已经校验过同一份数据。若坚持保留运行时校验，可用本包**已有依赖** `schemastery`（host/storage/index.ts:14 在用）声明式表达，仍远短于 119 行. (-119 LOC)`
- `shrink: client/styles/index.ts:22-110 的 cls 表 87 条手写字面量（'rowCard': 'dshp-ssh-row-card' 这类）. 键名保留为 as const 元组（类型仍是 keyof，错拼照样报错），值用派生式生成：'dshp-ssh-' + (k.replace(/([A-Z])/g,'-$1').replace(/(\d+)/g,'-$1')).toLowerCase(). 证据：pwsh 逐条比对 87 条（脚本用 -creplace 保证大小写敏感）→ entries=87 mismatches=0，span3→dshp-ssh-span-3、remoteIcon→dshp-ssh-remote-icon 均成立；cssr 侧 100 处 dshp-ssh- 字面量不动，语义不变. (-84 LOC)`
- `shrink: client/types/sync.ts:37-88 的 SshMachineEvent / SyncPluginItem / SyncSkillItem / SyncPreview / SyncItemResult / SyncApplyResult 与 host/types/index.ts:199 / 266 / 278 / 285 / 303 / 324 逐字同形（client 版仅把 stage 放宽成 string）. 把这 6 个 wire 类型收进 src/shared/types.ts，两侧 import（src/index.ts 继续 re-export 以保住协议面），客户端文件退化成一行 re-export. 证据：client/types/sync.ts 的唯一消费者是 client/types/index.ts:42-52 的 re-export；两侧字段名可逐字对齐. (-50 LOC)`
- `native: client/store/index.ts:134-137 的 SnapshotStore<T> 与 :140-156 的 createSnapshotStore<T> 是平台已提供的原始件的手写副本. 改用 @deepseek-ai/dsh-client-store 的 createSnapshotStore / SnapshotStore；或按同仓另两个插件的做法改用 dsh-tauri/client 的 defineStore + useStore，顺带去掉机器/同步/外壳三处的 useSyncExternalStore 手接. 证据：git grep -n "createSnapshotStore" -- packages 命中 dsh-tauri-model/src/client/models/welcome-store.ts:2、store.ts:13+131、store.account.test.ts:9；dsh-tauri-notification/src/client/store/modules/settings.ts:2+5、dsh-tauri-scheduler/src/client/store/modules/prefill.ts:2+4 用 defineStore；ssh 包内 git grep "defineStore|useStore" 命中 0；useSyncExternalStore 出现在 machines-section.tsx:684、ssh-section.tsx:44、sync-panel.tsx:43. (-21 LOC)`
- `delete: client/utils/retry.ts:1-19 整个文件（retrySecondsOf 是单表达式 Math.max(0, Math.ceil((nextRetryAt - nowMs) / 1000)），19 行的模块只服务一个调用点）. 把表达式内联进 machines-section.tsx:538 并删文件与 import. 证据：git grep -n retrySecondsOf -- packages/dsh-tauri-ssh/src 只命中定义行与 machines-section.tsx:538（另 :13 附近的 import）——单消费者、无测试引用. (-17 LOC)`
- `shrink: host/service/host-keys.ts:35-46 writeFileAtomic（async）与 host/storage/index.ts:178-189 writeStateFile（sync）是同一套原子写配方抄了两遍：mkdir(0o700) → `${file}.${randomBytes(6).toString('hex')}.tmp` → write(0o600, flag 'wx') → rename → 失败 rm. 抽一个同目录共享的原子写 helper，两处都调它. 证据：两段逐行对照，仅 fs/promises 与 fs 同步 API 之差；功能无差异. (-12 LOC)`
- `delete: host/apply.ts:105-111 传给 SshManager 的 emitStatus 钩子（唯一生产实现是空函数体，注释自述「no live consumers」）+ manager.ts:83 的 deps 声明 + manager.ts:955 的调用. 删掉钩子，状态一律走 settings 页轮询 /api-ssh. 证据：git grep -n emitStatus -- packages/dsh-tauri-ssh/src 命中 apply.ts:108（真实实现为空）、manager.ts:83/955、bootstrap.e2e.test.ts:114（测试传空函数）、manager.test.ts:313（测试自记一份）——即无生产消费者，删后测试里那两处也可一并去掉. (-7 LOC)`
- `yagni: host/service/events.ts:29 构造参数 capacity（外加 :25-28 的 JSDoc）. 生产端恒用默认值，改成模块级常量 EVENT_RING_CAPACITY 直接引用；裁剪逻辑用默认容量即可覆盖（现有测试 events.test.ts:65-67 就是这么测的）. 证据：git grep -n "new SshMachineEvents(" 命中 apply.ts:88（无参）、routes/index.test.ts:23、manager.test.ts:299、bootstrap.e2e.test.ts:107、events.test.ts 多处——只有 events.test.ts:53 传了 3. (-5 LOC)`
- `delete: client/locales/index.ts 的 hero.loadFailed（:12 与 :137）与 log.title（:66 与 :191），zh + en 各一份. 删这 4 行. 证据：pwsh 从 locales 文件抽键集合，与 git grep -n -o -E "'[A-Za-z][A-Za-z0-9._]*'" -- packages/dsh-tauri-ssh/src（剔除 /locales/ 路径）求差 → keys=118 deadKeys=2；逐键复核 git grep -c "'hero.loadFailed'" 等 occ=2（仅 zh/en 定义处，无任何 t(...) 调用点）. (-4 LOC)`
- `shrink: client/store/index.ts:159 与 client/components/machines-section.tsx:549 各有一份逐字相同的 messageOf(error)（error instanceof Error ? error.message : String(error)）. 留一份导出给两处用（scheduler 的 client/service/scheduler.ts:100 是第三份，见该包）. 证据：两处代码逐字相同；git grep -n "function messageOf" -- packages 命中 3 处. (-3 LOC)`
- `shrink: client/constants/index.ts:33 的 SSH_API_PATH = '/api-ssh' 与 src/shared/constants.ts:16 的 SSH_API_PREFIX = '/api-ssh' 同值同名不同家；client/components/machines-section.tsx:13 的 DEFAULT_REMOTE_PORT = 3080 又与 host/storage/index.ts:18 重复（host 侧同值还散在 apply.ts:177、routes/index.ts saveRowOf 的默认值里）. 按 docs/specs/plugin.baisc.md 的跨侧归属：SSH_API_PREFIX 与 DEFAULT_REMOTE_PORT/DEFAULT_SSH_PORT 收进 src/shared/constants.ts，客户端 import. 证据：git grep -n "SSH_API_PATH|SSH_API_PREFIX|DEFAULT_REMOTE_PORT" 显示两侧各写一份；route path 字面量例外不适用于这类数值/前缀常量. (-2 LOC)`
- `shrink: host/service/plugins-sync.ts:36-37 自己声明 const REMOTE_ROOT = '.dsh-desktop'（注释自述 mirrors bootstrap REMOTE_ROOT）. 改成从 './bootstrap' import（host/service/manager.ts:24 已经这么做）. 证据：bootstrap.ts:32 export const REMOTE_ROOT = '.dsh-desktop'，plugins-sync.ts:39/193/194/198 用同一值；两处一旦漂移就是远端路径错配. (-1 LOC)`
- `shrink: host/service/sync.ts:29 const REMOTE_PLUGIN_PROFILE = DEFAULT_REMOTE_PROFILE（纯同值别名）. 直接用 DEFAULT_REMOTE_PROFILE. 证据：git grep -n REMOTE_PLUGIN_PROFILE 只命中 sync.ts:29 定义与 sync.ts:119 的默认参数. (-1 LOC)`
- `keep: host/routes/index.ts:40-53 的 13 个 SshApiMethod 字面量与 :156 createSshApiHandler 的分派、:343-405 的 payload 解析器（machineIdOf/saveRowOf/secretsOf/pluginRefsOf/skillRefsOf）保留；其内部 saveRowOf 的 22/3080 内联默认值可收敛到 src/shared/constants.ts 的常量. (keep，不计 net)`
- `keep: host/apply.ts:56 SshRemoteService 类、src/index.ts 的 barrel（apply/Config/default/inject/name/SshRemoteService 与 4 个类型 re-export）、client/service/bridge.ts:9-12 的两个 Tauri command 名、client/constants 的 slot/样式 ID 保留——均为协议出口，仓内调用方多少与死活无关. (keep，不计 net)`

ssh 小计：**-326 行**（13 条）。

## packages/dsh-tauri-scheduler

- `delete: client/locales/index.ts 的 20 个死键（zh 与 en 各一份，共 40 行）：active、followGlobal、loading、menu.aria、module、moduleDefault、perDay、perWeek、perWorkday、providerDefault、refresh、sort、sortCreatedAsc、sortCreatedDesc、sortPlannedAsc、sortPlannedDesc、triggerManual、triggerSchedule、wakeHint、workspaceDaily（zh 侧 :9-15、:60、:66-69、:73、:81、:102-104、:122-124，en 侧 :134-140、:185、:191-194、:198、:206、:227-229、:247-249）. 键与两种语言的文案一并删；这些是已消失的排序菜单 / 触发来源列 / 按天-按周标签的残骸. 证据：pwsh 抽键后与「排除 /locales/ 路径后的全部字符串字面量」求差 → keys=120 deadKeys=20；逐键 git grep -c "'sort'" 等全部 occ=2（仅 zh/en 定义处）；另单独核过动态调用点 t(WEEKDAY_KEYS[day]) / t(STATUS_KEYS[...]) / t(PERMISSION_LABEL_KEYS[...]) / t(rec.nameKey) / t(errorKey)——其值都来自带字面量的映射表，不在死键集合内. (-40 LOC)`
- `shrink: client/types/index.ts:15-19 / 21-25 / 27-30 / 32-39 / 41-45 的 PermissionOption / ModelReasoningEffort / ModelReasoning / ModelOption / ModelCatalogFailure 与生成物 client/apis/index.type.ts:30-56 逐字同形（仅 readonly 与 Array<> 之别），而 client/types 里其余类型是真正的客户端视图. 删这 27 行，改成从 '../apis/index.type' re-export 这几个 wire 类型. 证据：两文件逐字段比对（provider/providerLabel/model/label/description/reasoning 完全一致）；service/scheduler.ts:2-13 本来就从 '../apis' 引入并已在依赖生成物. (-27 LOC)`
- `shrink: client/components/recommendations.tsx:22-41 的 2 个条目各自同时带 schedule 字面量与 form(t) 工厂，而 form 内部把同一份 schedule 又抄一遍（如 form: t => ({ name: t('recReviewName'), schedule: { kind: 'weekly', weekdays: ['FR'], time: '16:00' }, prompt: t('recReviewPrompt'), ... })）. 条目只留 id/nameKey/promptKey/schedule/accent/icon，form 由一个共享 builder 按这三项生成. 证据：每个条目的 schedule 与 form().schedule 字面量重复一次（2 处）；TaskFormState 其余字段全是常量默认值. (-9 LOC)`
- `delete: client/register/hydrate.ts:1-7 整个文件（只把一次性的 void recoverScheduler() 包成 defineRegister 中间层）. 把这一行挪进 client/index.ts 的 apply（与 :25 现有 effect 同处），删文件与 import. 证据：git grep -n hydrateFeature 只命中定义行与 client/index.ts:12、:25 两处——单调用方的 register 层，违反 docs/specs/devlopment.md 的零中间层. (-7 LOC)`
- `delete: client/hooks/use-scheduler.ts:1-6 整个文件（useScheduler() 只是 return useStore(store.scheduler)）. 组件内直接 useStore(store.scheduler)，删文件与 import. 证据：git grep -n useScheduler 只命中定义行与 scheduler-panel.tsx:8（import）、:41（调用）——单消费者中间层. (-7 LOC)`
- `delete: host/types/index.ts:89-90 的 SchedulerTask.module? / agentPreset?（以及生成物 client/apis/index.type.ts:71-72 与 client/types/index.ts:58 的对应行）无可达写入点；executor.ts:72 的 const agentPreset = task.agentPreset?.trim() || SCHEDULER_AGENT_PRESET 因此恒为 'standard'. 删字段，executor.ts:72/80/207/214/217 直接用 SCHEDULER_AGENT_PRESET. 证据：task.ts:137 的 OPTIONAL_FIELDS 不含这两项、update-task.ts 的 TEXT_FIELDS 不含、host/routes/index.types.ts 的 TaskCreateBody/TaskUpdateBody 不含；module 全仓只出现在类型声明与 locale 键里（无任何读取）. (-5 LOC)`
- `delete: host/utils/session-title.ts:1-3 整个文件（schedulerSessionTitle(taskName) 是恒等函数）. executor.ts:237 直接 title?.rename?.(session, taskName)，删文件与 :18 的 import. 证据：git grep -n schedulerSessionTitle 只命中定义行与 executor.ts:18、:237——单消费者且无变换. (-4 LOC)`
- `shrink: host/service/task.ts:161-163 的 merge(current, patch) 只是 return defaults({}, patch, current). 调用点 :39 直接写 defaults({}, patch, current)（或对象展开），删掉这个单调用点包装. 证据：git grep -n "merge(" -- packages/dsh-tauri-scheduler/src/host 只命中定义与 :39. (-4 LOC)`
- `delete: client/store/modules/prefill.types.ts:1-3（PrefillState 只被同目录 prefill.ts:1 的 type import 用）. 把 interface 移进 prefill.ts（同侧单文件消费的常量/类型归属规则）. 证据：git grep -n PrefillState 只命中 prefill.types.ts:1 与 prefill.ts:1、:5. (-3 LOC)`
- `yagni: client/components/schedule.utils.ts:61-63 的 isTaskPaused(task) 只返回 !task.enabled. 调用点 scheduler-panel.tsx:161 直接写 paused={!task.enabled}，删函数. 证据：git grep -n isTaskPaused 只命中定义行与 scheduler-panel.tsx:13（import）、:161（调用）. (-3 LOC)`
- `native: 11 个文件里的 lodash-es 调用点（executor.utils.ts:2、options.ts:3、recovery.ts:2、runs.ts:3、scheduler.ts:3、task.ts:4、utils/agent-runtime.ts:2、utils/schedule.ts:3、utils/waiting.ts:2、routes/history/get.ts:4、routes/tasks/get.ts:4）换成原生：filter/map/find/isEmpty/isString/isNil/isArray/isObject/isFinite/isInteger/isFunction 有同名 Array/typeof/Number.isFinite 等价物，orderBy→sort、takeRight(_,200)→slice(-200)、take(_,n)→slice(0,n)、uniq/sortBy→Set 去重 + sort、castArray(x)[0]→Array.isArray 判断、head→[0]、isEqual→Object.is. 行数基本持平——只有 runs.ts:isRun 与 task.ts:isTask 两处 conformsTo 需要改写成手写形状校验（约 +10 行），与删掉的 11 行 import 相抵；**真正的收益是删掉 lodash-es 与 @types/lodash-es 两个依赖**. (0 LOC，-2 deps)`

scheduler 小计：**-109 行**（10 条），另 -2 deps。

## packages/dsh-tauri-notification

- `delete: client/register/notify.ts:339 的 let statusAttached = false、:350 的 statusAttached = true、:355 的 void statusAttached. 三行全删（写进去只为了被 void 掉，没有任何读取分支）. 证据：git grep -n statusAttached -- packages/dsh-tauri-notification/src 只有这 3 处命中. (-3 LOC)`
- `delete: client/types/index.ts:24 的 SessionSummaryFace.updatedAt、:53 的 PendingQuestionFace.multiSelect、:86 的 PendingInteractionFace.callId、:98 的 SessionStatusFace.completionUnread. 删这 4 个字段（结构面只留真正被读的成员）. 证据：逐字段 git grep -n -E "\b字段名\b" -- packages/dsh-tauri-notification/src 剔除 types/index.ts 与 *.test.* 后 0 命中；同文件其余字段（toolName/reason/answerable/detail/header/silent/requireInteraction/displayReason…）均有命中，故只列这 4 个. (-4 LOC)`
- `keep: client/types/index.ts 头部自述「只声明结构类型…用最小结构面读取」（官方 dsh-client-ui 系列包不在本仓依赖内）、client/service/sound-assets.ts:15-16 的 SOUNDS_REQUEST_MESSAGE/SOUNDS_MESSAGE 桥消息名、以及 client/index.ts:8/14/16 的 name/inject/apply 出口保留——结构面与字符串通道都是协议. (keep，不计 net)`

notification 小计：**-7 行**（2 条）。除此之外这个包是干净的连线层，注释里给出的理由（内嵌 WebView2 原生 confirm 不随主题、原子写、Windows toast 静音标志）都站得住，不编发现。

## packages/dsh-tauri-rightclick

- `native: 12 处 lodash 别名（client/register/locate.ts:7 的 compact/filter/find/includes/map、client/register/official-menu.ts:2 的 find、client/register/context-menu.menu.ts:9 的 reject、client/service/menu.ts:9 的 difference/filter/get、client/service/registry.ts:3 的 sortBy、client/utils/url.ts:1 的 includes）与 2 处直连（host/routes/open/path/post.ts:4 的 isEmpty/isString/trim、host/routes/open/url/post.ts:4 的 get）换成原生：compact→filter(Boolean)、map→map、filter→filter、find→find、includes→includes、reject→filter(x => !f(x))、difference→filter + Set、get(o,'url')→o?.url、sortBy→[...].sort((a,b)=>f(a)-f(b))、isEmpty/isString/trim→trim() + typeof；host 侧三连判空可收成一处 typeof 判断. 删掉 lodash-es 与 @types/lodash-es 两个依赖. 证据：git grep -n "from 'lodash-es'" -- packages/dsh-tauri-rightclick/src 命中 2 行（host 路由）；git grep -n "dsh-tauri/client'" 显示 6 个客户端文件从这里取别名（同一份 lodash 再导出）；无一处用到 lodash 的独有能力（深比较、防抖、复杂迭代）——全部等价于原生一行. (-8 LOC，-2 deps)`
- `delete: client/types/index.ts:14 的 export type SessionSummaryLike = SessionSummary 与 :27 的 export type WorkspaceViewLike = WorkspaceView（纯同类型别名）. 直接用被导入的 SessionSummary / WorkspaceView，删这 2 行并替换引用（引用点共 15 处，改名不改行数）. 证据：两行右侧就是同文件 :2-9 导入的同名类型，别名不携带任何附加约束（同文件其余 *Like 别名都带 Pick/& 收窄，不是这一类）. (-2 LOC)`
- `keep: client/types/index.ts:62 的 ContextMenuEventDetail 与 client/service/registry.types.ts 的 ExtensionRegistry、client/constants/index.ts 的 CONTEXT_MENU_EVENT/EXTENSIONS_REGISTRY_KEY 保留——仓内 0 引用但均为跨插件字符串通道（globalThis 注册表键与 CustomEvent 名）的载荷形状，第三方插件在仓外消费. (keep，不计 net)`

rightclick 小计：**-10 行**（2 条），另 -2 deps。

## Considered and rejected（看过但认为不该动）

- `packages/dsh-tauri-ssh/src/client/components/machines-section.tsx`（1023 行）：EditPanel(:136) 与 AddMachineDialog(:569) 是两套机器字段表单（同一批 name/host/port/user/remotePort/profileName 字段），合并成一个受控表单能省 ~40 行，但两处的状态模型不同（Draft 缓冲 + 脏值/密钥状态 vs 局部 useState + id 自动派生 freeIdOf/slugOf），合并会把 id 派生与密钥态耦进同一个组件——收益不值这个风险，故不计入 net。
- `packages/dsh-tauri-ssh/src/host/routes/index.ts:110 readBody` 的 64KB 上限与 :97 isLoopbackPeer、:132 SHELL_ORIGINS CORS：属信任边界与前置拦截，按协议豁免清单与 ponytail 规则不简化。
- `packages/dsh-tauri-scheduler/src/host/config/runtime.ts:8 withWriteQueue`（5 行手写串行队列，2 个同侧消费者 task.ts:101/113、runs.ts:23/35）与 rightclick 的 `host/service/mutation-queue.ts`（16 行）、`host/service/opener.ts` 的 `warn` 薄封装：都是「一次交互不能并发拉起多个写入/OS 打开」的显式串行化，注释给了理由，保留。
- `packages/dsh-tauri-rightclick/src/client/register/official-menu.ts:33` 的双 `requestAnimationFrame` 等待（带 `// keep:effect` 注释）与 `src/client/service/registry.ts` 的 globalThis 注册表：前者是官方按钮 hover 后渲染的既知时序，后者是跨插件协议。
- `packages/dsh-tauri-notification/src/client/service/sound-assets.ts` 的桥消息握手、`client/register/settings.ts`、`client/register/notify.ts`：只做静态阅读，未发现可证明的冗余；该包 29 个 locale 键 0 死键。
- 三个包的 locale 表（notification 29 / rightclick 69）经脚本比对无死键；只有 scheduler 20 个与 ssh 2 个是死的（已列）。

## 覆盖度（诚实交代）

- 逐行通读：ssh 的 `src/index.ts`、`src/shared/constants.ts`、`client/index.ts`、`client/constants/index.ts`、`client/types/**`、`client/styles/index.ts`、`client/components/ssh-section.tsx`、`client/service/bridge.ts`、`client/utils/{retry,error}.ts`、`host/service/host-keys.ts`、`host/service/events.ts`；host/apply.ts、host/routes/index.ts、client/store/index.ts、client/components/machines-section.tsx、host/storage/index.ts 读了大部分（解析器、构造器、方法体、表单区段）。
- 只做声明面扫描（`git grep` 导出清单 + 逐名消费者计数），未逐行精读：ssh 的 `host/service/{manager,transport,bootstrap,sync,ssh-config,allowlist,plugins-sync,version,assets,sync-local,boot-html}.ts`、`client/components/sync-panel.tsx`、`client/locales/index.ts`、`client/styles/index.cssr.ts`（后面两个用脚本核过键/类名）。这几个文件里可能还有未发现的行数级冗余，但**没有**「导出但无消费者的函数」（已用专门脚本证明），故未列推测性条目。
- 另：`packages/dsh-tauri-ssh/package.json` 把 `yaml`（被 `host/service/allowlist.ts:21` 运行时 import）声明在 `catalog:testing` 分组——这是依赖归属问题，不是行数问题，交给 `dependencies.md` 口径处理。

net: -452 lines, -4 deps possible.

## scheduler / notification / rightclick 执行复核（2026-09-30）

以下结论覆盖原审计的对应建议；SSH 单独提交，不混入此批次。

- 已执行：删除 notification 的写后不读变量 `statusAttached`；scheduler 私有 `merge` 就地调用 `defaults({}, patch, current)`，恢复扫描改用原生数组过滤；删除仅内部消费的 `useScheduler`、恒等 `schedulerSessionTitle`、`isTaskPaused`，并将 `PrefillState` 就地声明。
- 已执行：rightclick 的 URL 协议白名单、扩展可见性过滤与会话排除改用原生数组/Set，保留顺序、重复项、不修改快照和 `visible(...) !== false`；宿主 URL 入口仍由 `safeWebUrl` 校验。
- `keep:` 持久化/线上的 `SchedulerTask.module`、`agentPreset`、notification 结构字段、rightclick 类型别名及路由/事件出口。已有配置的 agent preset 仍可覆盖默认值，不因 UI 无写入口删掉协议字段。
- `keep:` scheduler DTO 的接口与 readonly 约束、公开 recommendation.form 和 locale 词典；hydrate 注册仍承载生命周期，入口规范禁止把初始化请求移到 client entry。
- `keep:` lodash 的深比较、默认值合并、形状校验及其余仍使用的方法与依赖。`Object.is` 不等价于 `isEqual`，对象展开不等价于跳过 undefined 的 `defaults`；原 -4 deps 预估不作为本次结果。
- 验证：新增任务更新/恢复与快照顺序回归；三包 22 文件 / 203 用例连续六次乱序通过，深比较变异被测试拒绝。合并内部包装精简后，与 UI/extension 一起运行 52 文件 / 386 用例通过，限定源码别名类型检查通过，Lint 零错误。

## SSH 执行复核（2026-09-30）

以下结论覆盖原 SSH 建议；独立于另外三包提交。

- 已执行：SSH/远端端口默认值收口至共享常量，保留 storage 的既有导出；`SSH_API_PATH` 与 `REMOTE_PLUGIN_PROFILE` 保留名称但改为同值重导出；复用 `REMOTE_ROOT` 和错误文本转换，私有 `retryHintOf` 内联。
- `keep:` 四个 wire 解析器、路由输入/CORS/回环校验。TypeScript 泛型不校验运行时数据，host 校验不能替代客户端容错。
- `keep:` 客户端与宿主 wire 接口并非逐字同形：除 stage 外，machineId 的品牌类型及 skill root 的开放 string/封闭 union 也不同；不收窄宽容读取契约。
- `keep:` 本地 snapshot store 每次浅复制通知的语义，平台的 Immer store 不是直接等价替换；sync/async 原子写保持各自调度、权限和失败清理语义。
- `keep:` `emitStatus` 生命周期注入面、事件 ring 的测试容量、已有 retry 工具和公开 `SshKey` 词典。仓内少消费者不足以删除协议或真实边界测试能力。
- 撤回类名派生：保留现有 literal/readonly 类型需要额外类型级转换器，实际只减少少量注释行；不为审计预估引入第二套转换逻辑。
- 验证：受影响源码 6 文件 / 170 用例五次独立乱序通过，插件同步命令另 3 用例通过；端口 22→23 的变异被新回归拒绝并已恢复。仓库和限定源码类型检查、SSH Lint 均通过。
- 环境限制：完整 SSH unit 仍有与原始基线相同的 16 项失败（Windows/POSIX shell、路径、文件权限与缺少部署树）；现有组件套件因本地 primitives 缺少 `simple-icons` 无法收集。未构建插件、未弱化断言、未提交临时测试配置；CI 结果另行记录。
