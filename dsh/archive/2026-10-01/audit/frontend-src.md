# 前端 `src/**` — ponytail-audit

> Scope: `src/**`（git 跟踪 144 个文件，~14.5k LOC）+ `index.html`（12 行）+ `pet.html`（12 行）· 审查日期 2026-09-30 · 只读审查，未改动任何源码
> 排除面全部遵守：`docs/audit/protocol-surface.md` 的协议/IPC 豁免清单（iframe 桥 hook、`ALLOWED_INVOKE_CMDS` 信任边界、Tauri 命令名与事件名、`dsh://*` 消息通道、slot/样式 ID）；`react-if-lite` 依 `docs/specs/desktop.baisc.md:90` 保留；未读写 `src-tauri/vendor/**`、`archive/`；未运行任何构建/dev 命令。
> 范围外（仅备注、不作 finding）：正确性 bug、安全、性能。

## 方法与证据口径

- 本机 `rg`/`fd` 不在 PATH，零调用方证明统一用 ripgrep 内核的 harness `grep` 工具 + `git grep -n --fixed-strings`；搜索范围 `src/ test/ index.html pet.html`，必要时扩到全仓（排除 `pnpm-lock.yaml`）。
- 另跑了一个 `node` 静态扫描：解析全部 git 跟踪文件的 `from '…'` / `import '…'`（`@/`→`src/`、相对路径，候选后缀 `.ts/.tsx/index.ts/index.tsx`），得到「每个文件被谁导入」与「每个 `export` 在其他文件中的出现次数」两张表；`src/store/modules/*/store.ts` 的顶层方法另做了一轮「模块外零引用」扫描。
- **扫描器的两个已知盲区（本次报告已规避）**：① 后缀候选不含 `.css`，所以 `src/styles/main.css`、`src/pet/main.css`、`src/styles/components/scrollbar.css` 会被误报 0 导入方 —— 实际分别由 `src/main.tsx:11`、`src/pet/main.tsx:6`、`src/styles/main.css:6` 的 `@import` 导入，**保留，不作 finding**；② 「导出但 0 外部引用」的 63 个导出绝大多数是**同文件内部使用**（例如 `src/store/modules/harness/utils.ts:179 readServiceLogTail` 被同文件 `:200` 调用），LOC 节省为 0，**一律不作 finding**。
- 覆盖度诚实声明：`src/hooks`、`src/utils`、`src/components`、`src/config`、`src/i18n`、`src/layout/components/nav-bridge.ts` 为逐行阅读 + 符号级交叉验证；`src/ui`（3.3k LOC）、`src/layout` 的其余部分、`src/store`（4.8k LOC）、`src/pet` 只做了符号级交叉引用扫描（死文件 / 死导出 / 单消费者），**未逐行审查**，因此这几节不会出现「Lean already」这类断言。

## src/hooks

`delete: `use-zoom-level.ts` 整个文件：`useZoomLevel` 的完整实现（含重复的 `RefOrValue`/`isRefLike`/`toValue` 与 1.2 底数换算）在本仓零调用方，功能已被 `useZoomFactor` 覆盖。删文件；`src/utils/zoom.ts:43-59` 与之级联作废（见 `src/utils` 一节）。 [src/hooks/use-zoom-level.ts:1-75] (-75 LOC)`
  - `git grep --fixed-strings "useZoomLevel"` 全仓仅命中自身文件（`:8,12,13,14,28,44,48,50,51,52`）；`git grep --fixed-strings "use-zoom-level"` 全仓 **0 命中**；文件在第 4 节的全量导入表里「导入方（排除测试/main）= 0」。
  - 该文件不在 `docs/audit/protocol-surface.md` 白名单内，无字符串通道引用（它是纯 TS 函数，`ZoomLevelSetter` 是类型）。
  - ⚠ 需维护者确认的最后一点：`src/hooks/use-zoom-level.ts:8` 的自述是「签名与 `@reause/electron` 的同名 hook 完全一致」——若这是刻意保留的**迁移期 API 对齐面**（而非普通实现），按协议豁免的同类精神应降级为 `keep:`；本报告按「非协议、无调用方、仓内已有真值实现」判为 `delete:`，并把这一分歧记入「需人工确认」。

`shrink: `use-zoom-factor.ts` 里从未被触发的「ref / Webview 重载」灵活性：删 `import type { Webview }`、`import type { RefObject }`、`RefOrValue<T>`、`isRefLike`、`toValue`、`isFactorArgument` 与两个重载签名，收敛成单一签名 `useZoomFactor(factor?: number)` 并用 `webview.setZoom(factor)` 直接落地。 [src/hooks/use-zoom-factor.ts:1-2,39,55-67,106-113] (-26 LOC)`
  - 唯一调用方是 `src/layout/components/iframe.tsx:227` 的 `useZoomFactor(setting.zoom_factor)`——永远是纯 number，永远不传 ref、不传 `Webview`；全仓无第二处 `useZoomFactor(` 调用。
  - **必须保留**：`isNativeZoomSupported()`（`:79-91`）与 `MIN_MACOS_ZOOM_MAJOR = 11`（`:70`）—— macOS 11 以下 wry 的 `WKWebView.pageZoom` 不可用会崩，是平台保护不是过度设计。

`delete: `use-const.ts` 整个文件：手搓 ref 缓存的 `useConst` 在本仓零调用方。删文件；需要惰性初值的地方用 React 自带的 `useState(() => …)`。 [src/hooks/use-const.ts:1-20] (-20 LOC)`
  - `git grep --fixed-strings "useConst"` 全仓仅命中自身定义行 `:7`；`git grep --fixed-strings "use-const"` 全仓 0 命中。
  - 不在协议白名单，无字符串通道引用。

## src/utils

`delete: `backup-settings.ts` 整个文件：`BackupSettings` 接口与 `normalizeIntervalDays`/`normalizeRetentionCount` 两个纯函数在本仓（含 `src/**` 与 `src-tauri`、`packages`）没有任何生产消费者。删文件；其唯一引用方是一次自测。 [src/utils/backup-settings.ts:1-49] (-49 LOC)`
  - `git grep --fixed-strings "backup-settings"` 全仓仅 `test/backup.test.ts:1,8`；`git grep "normalizeIntervalDays|normalizeRetentionCount|BackupSettings"` 全仓仅命中自身定义行与该测试。
  - 同域的 `test/backup.test.ts:1-58` 随文件一并失去被测对象，可整段移除（上表 LOC 未含测试）。

`shrink: `toast.ts` 的 6 档 placement 机制只服务 1 个真实档位：删 `placements`（6 值）、`queues`/`linuxQueues`/`activeQueues` 三张表、`placementOrder: Map<Placement, string[]>` 的 key 维度与 `placements.forEach(p => activeQueues[p].clear())`，收敛为单个 `ToastQueue`；`placement` 选项与 `placementOrder` 的对外行为逐字不变（仍收 6 个合法值、仍按传入顺序排队）。`src/components/toast-provider.tsx` 同步只渲染 1 个 `Toast.Provider`。 [src/utils/toast.ts:24-31,39-49,51-52,67,120,181 + src/components/toast-provider.tsx:8,38-43] (-30 LOC)`
  - 全仓显式 `placement:` 共 6 处，**全部**是 `'bottom end'`：`src/layout/index.tsx:110`、`src/store/modules/desktop-updater/store.ts:142,153,160,174`、`src/store/modules/harness-updater/store.ts:115`；其余调用点走默认值 `'bottom end'`（`src/utils/toast.ts:115` 的解构默认），无一处使用 `'top start'`/`'top end'`/`'bottom start'` 等其余 5 档。
  - 收敛时**必须保留** `linuxQueues` 与 `queues` 的唯一真实差异 `wrapUpdate: fn => fn()`（Linux 下禁掉 HeroUI 的更新过渡，是平台 workaround），写成 `const queue = isLinux ? new ToastQueue({ wrapUpdate: fn => fn() }) : new ToastQueue()`。

`delete: `zoom.ts:61-84`：`ZOOM_FACTOR_DEFAULT/STEP/MIN/MAX` 四个常量与 `normalizeZoomFactor` 与设置模块的真值实现逐字重复。删这 24 行，缩放真值统一走 `src/store/modules/setting/{constants,utils}`。 [src/utils/zoom.ts:61-84] (-24 LOC)`
  - 与 `src/store/modules/setting/constants.ts:3-12`（四个常量）和 `src/store/modules/setting/utils/index.ts:1-8`（`normalizeZoomFactor`）逐字同值同实现；后者的 `normalizeZoomFactor` 被设置面板/存储路径真实消费，`src/utils/zoom.ts:78` 的这一个则 0 消费者（`normalizeZoomFactor` 全仓调用点只在 `setting` 侧）。
  - 连带 SSOT 冲突：`src/utils/zoom.ts:1` 的 `ZoomAction` 与 `src/store/modules/setting/types/index.ts:24` 重复定义，而 `src/store/modules/setting/store.ts:1` 用的是后者 ⇒ 前者删掉、改从 `@/store/modules/setting/types` 导入（-1 LOC，附带上表）。

`delete: `zoom.ts:43-59`：`ZOOM_LEVEL_BASE = 1.2` 与 `zoomFactorFromLevel`/`zoomLevelFromFactor` 的**唯一**生产消费者是已判删的 `src/hooks/use-zoom-level.ts`；删这 17 行后 `src/utils/zoom.ts` 只剩被 `src/layout/components/iframe.tsx:292,399` 真实消费的快捷键盘/桥消息解析部分。 [src/utils/zoom.ts:43-59] (-17 LOC)`
  - `git grep "zoomFactorFromLevel|zoomLevelFromFactor"`：生产侧只有 `src/hooks/use-zoom-level.ts:5,60,67,73`，其余是 `test/zoom.test.ts:6,7,61-77`（随文件一并失去被测对象）。

`delete: `close-action.ts:3` 的 `CLOSE_ACTION_DEFAULT`：常量只被测试引用，生产代码一律自带兜底值。删这一行。 [src/utils/close-action.ts:3] (-1 LOC)`
  - `git grep --fixed-strings "CLOSE_ACTION_DEFAULT"` 仅 `test/close-action.test.ts:4,11`；同文件 `CLOSE_ACTION_OPTIONS`（`:5`）与 `normalizeCloseAction`（`:9`）有生产消费者 `src/ui/config/components/close-action.tsx:6,53,58,60`，**保留**。

## src/store

`delete: `AppSetting` 接口：设置模块的一个空壳类型，全仓只在自己文件里出现，没有任何一处用它标注值。删 13 行；`src/store/modules/setting/store.ts:1` 只导入 `AppSettingUpdate, ZoomAction`，不受影响。 [src/store/modules/setting/types/index.ts:1-12] (-13 LOC)`
  - `git grep --fixed-strings "AppSetting"` 全仓命中只有该定义块本身（`src/store/modules/setting/types/index.ts:1-12`）；`AppSettingUpdate` 另有消费，不在本条。

`native: `@hairy/utils` 整条 runtime 依赖只为 `readiness` 的默认参数提供 `delay`——用平台原生的 `new Promise(resolve => setTimeout(resolve, ms))` 一行替代，然后从 `package.json` 移除该依赖。 [src/store/modules/harness/readiness.ts:1,103,178] (-0 LOC, -1 dep)`
  - `git grep --fixed-strings "@hairy/utils"` 全仓仅 `src/store/modules/harness/readiness.ts:1`、`package.json:35`（`"@hairy/utils": "catalog:utils"`）、`pnpm-workspace.yaml:212`（catalog 定义），无第二个导入方 ⇒ 依赖可整条下线。
  - 用法极窄：`import { delay } from '@hairy/utils'` 只做 `wait = delay` 的默认参数（`:103`、`:178`），实际调用是 `await wait(waitMs)`（`:162`）与 `await wait(boundedWait(...))`（`:227`），签名就是 `(ms: number) => Promise<void>`。
  - 净效果是 +1 行源码、-1 依赖，故本行按 0 行计入 `net:`（依赖数照算）。

## src/config

`yagni: `storage.ts` 单调用方中间层：6 行文件只为把 `tauriStorageDriver` 包成 `createStorage`，唯一消费者是 `src/store/modules/setting/store.ts`；把这三行合并进 `storage.driver.ts` 的出口，删掉中间文件与两层导入。 [src/config/storage.ts:1-6] (-6 LOC)`
  - `createStorage`/`tauriStorageDriver`/`storage` 三个符号的导入方各只有 1 处（`storage.driver.ts` 只被 `storage.ts` 导入，`storage.ts` 只被 `src/store/modules/setting/store.ts` 导入），符合 `docs/specs/devlopment.md` 的零中间层条款。
  - 注：`storage.driver.ts`（42 行，unstorage 自定义 driver 包 `@tauri-apps/plugin-store`）**不是**冗余——它是跨平台适配层实现在被真实使用，保留。

`delete: `query-keys.ts` 的 `logs: ['logs']`：缓存键零引用，是唯一的孤儿键。删这一行。 [src/config/query-keys.ts:13] (-1 LOC)`
  - `git grep --fixed-strings "queryKeys.logs"` 全仓 0 命中（`queryKeys.` 其余键共 31 处引用：`info` 3、`cliStatus` 2、`cores` 5、`plugins` 10、`profiles` 7、`backups` 3、`launchOnLogin` 1）。配置本身作为 SSOT 合理，只删这一个键。

## src/i18n

`delete: 两个语言文件里 39 个从未被引用的翻译键（整个 `remote.form.*` 15 个与 `remote.manager.*` 11 个子树全死，加上零散的 `backup.*`/`nav.forward`/`messages.*` 等）：这些键在 `src/**`、`index.html`、`pet.html` 中零出现，且不落在任何一种动态拼接前缀内，删除不影响运行时。 [src/i18n/locales/en-US.json + src/i18n/locales/zh-CN.json] (-78 LOC)`
  - 两文件是**扁平点号键、每行一个键**（各 496 个叶子键 / 498 行含花括号），键集完全一致（en-only 0、zh-only 0），所以每个键 2 行，39 × 2 = 78。
  - 搜索方式：脚本收集 `src/**`+HTML 中所有 `t('…')` 字面量，与两个 JSON 的键集求差；再**手工排除动态前缀**——全仓动态键模板只有 5 种：`t(\`remote.step.${phase}\`)`、`t(\`remote.state.${machine.state}\`)`、`t(\`remote.auth.${machine.authMethod}\`)`、`t(\`startup.phase.${phase}\`)`、`t(\`errors.startup_${kind}\`)`，对应 `remote.step.*` 1 个、`remote.state.*` 4 个、`remote.auth.*` 2 个、`startup.phase.*` 3 个、`errors.startup_*` 3 个，共 13 个键被排除在删除清单外。57 − 13 = 44，再扣除被测试断言钉住的 5 个（`plugins.disable_toast` / `plugins.disable_failed` / `plugins.enable_toast` / `plugins.enable_failed` 见 `test/plugin-disable.test.ts:68-71,80-83`，`profiles.clone_invalid` 见 `test/clone-profile.test.ts:166`）得到 39 个干净死键（那 5 个若要删需同步改测试，可再得 10 行，未计入）。
  - 39 个键全表：`app.expand_sidebar`；`errors.service_start_timeout`；`messages.logs_copy_failed`；`messages.zoom_failed`；`nav.forward`；`backup.title`；`backup.tooltip`；`backup.tabs_label`；`backup.settings_saved`；`backup.settings_failed`；`remote.manage_hint`；`remote.form.host`；`remote.form.name`；`remote.form.id`；`remote.form.port`；`remote.form.user`；`remote.form.remote_port`；`remote.form.password`；`remote.form.passphrase`；`remote.form.color`；`remote.form.tint_border`；`remote.form.start_command`；`remote.form.start_command_hint`；`remote.form.keep_blank`；`remote.form.host_required`；`remote.form.id_invalid`；`remote.form.id_taken`；`remote.manager.title`；`remote.manager.subtitle`；`remote.manager.add`；`remote.manager.edit`；`remote.manager.edit_action`；`remote.manager.remove_action`；`remote.manager.remove_title`；`remote.manager.remove_desc`；`remote.manager.connect`；`remote.manager.disconnect`；`remote.manager.test`；`remote.manager.empty`。
  - 附带结论（供维护者判断，不是 finding）：`remote.form.*` 与 `remote.manager.*` 两个子树**整体**死掉，说明远端机器管理表单 UI 要么从未落地，要么已废弃但 i18n 与 store 的字段定义没跟着删。

## src/layout

本次未发现可净裁项（符号级交叉引用扫描：无存活死文件、无死导出、无单消费者文件；`src/layout` 其余部分未逐行审查）。`src/layout/components/nav-bridge.ts` 看似死代码，实为协议通道，降级进 `keep:`（见下）。

## src/components

`Lean already. Ship.`（10 个文件全部逐行读过）
- `src/components/primitives.ts`（28 行）的 `button` 有 2 个消费者（`src/layout/components/loadable.tsx:5`、`src/layout/components/setup.tsx:8`），不是单调用方层；`src/components/logs.utils.ts`（45 行）的 `formatLogLine`/`pickErrorLines`/`containsInotifyLimitError`/`containsHeapOomError` 全部被 `src/store/modules/harness/utils.ts:8,202,209,212` 真实消费，不是「只给测试用」的纯函数；`src/components/panel.tsx`（124 行）把原三个文件收敛成一个复合组件，是正向简化；`modal.tsx`/`item.tsx`/`empty.tsx`/`info.tsx`/`ellipsis.tsx`/`toast-provider.tsx` 各有 ≥2 生产消费者。`toast-provider.tsx` 的 6 个 `Toast.Provider` 是本次 `shrink:` 的另一半，已计入 `src/utils` 一节。

## src/pet

本次未发现可净裁项（符号级交叉引用扫描）。
- `src/pet/hooks/use-bubble-tracker.helpers.ts`（200 行）不在「单导入方」名单里（hook 与其测试都导入它），拆分成立；`src/pet/hooks/use-bubble-tracker.ts:40-42` 消费的事件名 `session:create|update|remove` 属协议通道。
- `src/pet/utils/log.ts`（33 行，`reportPetIssue` → `log_frontend` 命令）是桌宠独立 webview 唯一日志出口，真实功能。
- `src/pet/main.css` 由 `src/pet/main.tsx:6` 导入（扫描器假阳性，见「方法与证据口径」）。

## src/ui · src/store（大文件部分）· src/types · index.html · pet.html

- `index.html`（12 行）与 `pet.html`（12 行）：`Lean already. Ship.`——只有 Vite 入口脚本与 `#root`，无冗余 meta/无未用 preload。
- `src/config/client.ts`（21 行，`QueryClient({ retry: false })` + `MutationCache.onError` 兜底打印）与 `src/pet/utils/log.ts`：真实功能，保留。
- `src/ui/config/hooks/use-core-profile-switch.tsx`（124 行）与 `use-core-breaking-confirm.tsx`（40 行）各有 3 个生产消费者（`src/layout/index.tsx:13,14`、`src/ui/config/core.tsx:18,19`、`src/ui/config/debug.tsx:18,19`），不是单调用方层。
- 覆盖度声明：`src/ui`（3.3k LOC，最大 `src/ui/config/plugin.tsx` 665、`profile.tsx` 563、`core.tsx` 530、`debug.tsx` 438）、`src/store`（4.8k LOC，最大 `src/store/modules/harness/store.ts` 845、`plugins/store.ts` 694）、`src/layout` 的其余大文件只做了符号级扫描（死文件 / 死导出 / 单消费者 / store 方法外引用），**未逐行审查**，因此这里不写 `Lean already`。可复核的扫描结果：`src/store/modules/*/store.ts` 的顶层方法**没有一个**在所属模块目录外零引用（各模块方法数：harness 10、plugins 34、recovery 3、remote 3、setting 3、desktop-updater 3、harness-updater 2、preinstall 2）⇒ 未发现死 store action。

## keep: 协议面（不计入 net）

- `keep: navBridgeOf 保留（协议通道生产者）；其内部三条 payload 与 webview 逐字重复，可收敛。`——`src/layout/components/nav-bridge.ts:32-33` 是壳层侧**唯一**构造 `dsh://settings:open` 的地方，而该消息的消费方在仓外的插件包里真实存在：`packages/dsh-tauri-ui/src/client/register/settings-open.ts:5`（`SETTINGS_OPEN_MESSAGE = 'dsh://settings:open'`，注释自述「壳层 deep-link：宿主窗口 postMessage」）与 `packages/dsh-tauri-ssh/src/client/constants/index.ts:30`。文件在导入表里只有自己的测试导入（`src/layout/components/nav-bridge.test.ts:2`），但按豁免清单「字符串通道引用 ⇒ keep」不判删除。可收敛处：`onToggleSidebar`/`onNewChat`/`onOpenFolder` 三条（`:28-30`）与 `src/layout/components/webview.tsx:91-93` 逐字重复，让 `webview.tsx` 复用 `navBridgeOf(post, true)` 可去重 3 行（不计入 net）。
- 一行备注（正确性，非 finding）：`src/layout/components/navbar.tsx:220,222,229,688` 声明并透传 `onOpenMachineManager`/`onOpenSyncToRemote` 给 `<RemoteSwitcher onManage=… onSync=…>`，但生产接线 `src/layout/components/webview.tsx:89-96` 只传 4 个回调——这两个入口当前永远是 `undefined`，即「机器管理 / 同步到远端」按钮在壳层里点不动。只有 `nav-bridge.ts:32-33` 提供过它们。
- `keep: useListen / useListenIframe / useInvoke / useInvokeIframe(+ALLOWED_INVOKE_CMDS) / useIframeMessage / useIframePost(+IFRAME_HOST_SOURCE) 全部原样保留。`——`useInvoke`（`src/hooks/use-invoke.ts:5`）与 `useListenIframe`（`src/hooks/use-listen-iframe.ts:38`，含 `:25-26` 的「目前尚无调用方……先按协议定义好」）在仓内确实 0 调用方，`useInvokeIframe` 的 15 条命令白名单是 iframe 插件越权的信任边界（`src/hooks/use-invoke-iframe.ts:39-59`，被 `src/layout/components/iframe.tsx:220` 使用，未命中时 `:66-69` 仅 `console.warn` 后忽略），均不提议删除或削弱。内部未发现值得收敛的冗余。
- `keep: src/config/hooks.ts 的两个事件钩子保留。`——`'toast.updated'`（触发 `src/utils/toast.ts:158`，消费 `src/components/toast-provider.tsx:26`）与 `'config.dialog.hidden'`（触发 `src/store/modules/harness/store.ts:694,807`、`src/store/modules/preinstall/store.ts:249`，消费 `src/ui/dialog/config.tsx:48`）都有真实两端。
- `keep: useNotificationClicked / useNotificationAction 保留。`——虽各只有 1 个调用方（`src/layout/components/iframe.tsx:235,236`），但它们绑定的是跨进程事件名 `dsh-notification-clicked` 与通知动作通道，属协议面；同理 `useSyncVisibility`（iframe 可见性 `dsh://visibility-state`）、`useListen` 的 `session:*`/`preinstall-log`/`setting_updated` 消费点（`src/pet/hooks/use-bubble-tracker.ts:40-42`、`src/hooks/use-invalidate-on-setting-updated.ts:17`、`src/ui/config/debug.tsx:51`）都不作裁剪。

## Considered and rejected

- `src/utils/silence.ts`（15 行）——22 处调用（`src/ui/config/backup.tsx:57,107,134`、`core.tsx:181,201,269`、`plugin.tsx:164-358` 共 14 处、`profile.tsx:212,281,318`、`src/ui/dialog/about.tsx:88`、`src/ui/plugin/recovery.tsx:55`），真实共用件，不是中间层。
- `src/utils/core-version.ts`（101 行）——`compareVersions`(:23)、`coreProfileName`(:44)、`isCoreUpgrade`(:64)、`isCoreBreakingVersion`(:79)、`isCoreUnsupported`(:99)、`CORE_BREAKING_BASELINE`(:7)、`MIN_SUPPORTED_CORE_VERSION`(:91) 全部有生产消费者（`src/ui/config/core.tsx:108,127,150,165,529`、`hooks/use-core-profile-switch.tsx:63,71`、`hooks/use-core-breaking-confirm.tsx:20,28`）。
- `src/utils/clipboard.ts`（27 行）——3 个生产消费者（`src/layout/components/navbar.tsx:381`、`setup-preinstall.tsx:143`、`setup.tsx:37`），且文件注释说明为何刻意不用 `@tauri-apps/plugin-clipboard-manager`（Linux Wayland 崩溃），是兼容性刚需。
- `src/utils/iframe.ts`（15 行）——`getIframeOrigin` 有 2 个消费者（`src/hooks/use-iframe-message.ts:37`、`src/hooks/use-iframe-post.ts:30`），且是 origin 校验的唯一入口，贴着协议面。
- `src/utils/logger.ts`（139 行）——劫持 `console.*` 并透传到 Rust `log_frontend`（`:81`），含全局 `error`/`unhandledrejection` 兜底（`:92-101`），真实功能。可选微裁（未计入 net，收益 2 行且需确认目标浏览器基线）：`:20` 的 `console.debug ?? console.log` 与 `:23` 的 `console.trace ?? console.log` 在现代 webview 恒非空。
- `src/utils/zoom.ts:1-42` 的 `zoomActionFromShortcut`(:16)/`zoomActionFromBridgeMessage`(:29) —— 被 `src/layout/components/iframe.tsx:292,399` 消费，保留（同文件其余两条已列 finding）。
- `src/hooks/use-theme-adaptive.ts:14`、`use-remote-machines.ts:17`、`use-sync-visibility.ts:10`、`use-window-draggable.ts:54`、`use-omit-ignore-cursor-events.ts:40`、`use-dsh-style.ts`、`use-dsh-shortcuts.ts`、`use-wakelock-release.ts`——都只有 1 个调用方，字面上符合「零中间层」，但逐个看内容后不判 `yagni:`：它们不是纯转发（含 `matchMedia` 监听、`getCurrentWindow()` 拖拽、桌宠 hitbox 的 `ignoreCursorEvents` 平台调用、wakelock 释放、全局状态 `createGlobalState`），内联只会把平台细节摊进组件。唯一勉强可算的 `use-sync-visibility.ts:10` 只做「组件卸载 → 发一条 `dsh://visibility-state`」，但它是协议消息的发送端，归入 keep 更稳妥。
- `src/config/storage.driver.ts`（42 行）—— unstorage 自定义 driver 确实只有 1 个实现、1 个使用点，但它包装的是 `@tauri-apps/plugin-store` 的跨平台适配边界（SSOT 角度它才是 `createStorage` 的真值实现），保留。
- `src/store/**` 的 `modules/<name>/index.ts` 再导出 barrel（2-9 行）——逐个人工确认**都有**生产导入方（`@/store/modules/plugins`、`harness`、`remote`、`preinstall`、`setting` 均有 import 点），删除只会换来一批 import 改写，纯增改动量 ⇒ 留。
- 63 个「导出但仅同文件使用」的导出（如 `src/hooks/use-plugins-manager.ts:20,25` 的 `UseDshPluginsManagerOptions`/`UseDshPluginsManagerResult`、`src/store/modules/harness/patch-layer.ts:19,36` 的两个错误码常量、`src/i18n/index.detector.ts:7` 的 `LANGUAGE_STORAGE_KEY`）——只是 `export` 关键字多余，LOC 节省 0（去掉关键字反而可能触发 lint 的未使用告警），不作 finding。
- `react-if-lite`——`docs/specs/desktop.baisc.md:90` 强制 `<If>/<Then>/<Else>` 且禁止 JSX 里用 `?:`/`&&`，明确保护的依赖，不提任何裁剪。
- `src-tauri/vendor/**`、`archive/`、`packages/**`——不在本次范围。
- 未提议给任何代码加解释性注释（仓库 0 注释政策），也未提议 `_legacy` 桩（`docs/specs/devlopment.md` 要求直接删）。

## 需人工确认

1. `src/hooks/use-zoom-level.ts`（75 行）的删除是本报告最大的一笔，但其 `:8` 自述「签名与 `@reause/electron` 的同名 hook 完全一致」。若这是刻意保留的迁移期 API 对齐面（而非普通实现），应降级为 `keep:`，`net` 相应减少 75（同时 `src/utils/zoom.ts:43-59` 的 17 行级联删除也随之取消，合计 −92 行）。
2. i18n 另有 5 个键（`plugins.disable_toast`/`disable_failed`/`enable_toast`/`enable_failed`、`profiles.clone_invalid`）被测试断言钉住，删除它们需同步改 `test/plugin-disable.test.ts:68-71,80-83` 与 `test/clone-profile.test.ts:166`，可再得 10 行，未计入 `net`。
3. 本报告的零调用方结论来自静态 `import`/标识符扫描（`rg` 不可用，未跑 knip：knip 任务输出落盘失败，证据不可用）。grep 只能证明「没有显式引用」，不能证明「没有约定式/反射式消费」——上述每条 finding 的删除都建议先跑一次类型检查确认。

net: -341 lines, -1 deps possible.
