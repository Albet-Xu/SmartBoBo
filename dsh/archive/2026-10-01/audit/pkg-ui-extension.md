# packages/dsh-tauri-ui + dsh-tauri-extension — ponytail-audit

> Scope: packages/dsh-tauri-ui, packages/dsh-tauri-extension · ~12k LOC · read 2026-09-30

Over-engineering only. Protocol/bridge surface (`useListen*`, `useInvoke*`, `defineAdapter`, IPC command names, route paths, slot names, effect/constant entries, entrypoints) is never proposed for deletion; where it is unused in-repo it is tagged `keep:`. Vendored `packages/dsh-tauri-extension/skills/**` (third-party) and generated code were not audited.

## Findings (ranked, biggest cut first)

`shrink:` `UI_COMPONENT_REGISTRY`'s 19 `reforkVariant(...)` rows (registry.ts:90-209) each repeat `package` / `availableAt` / `upstreamPath` / `mappedClass` on 7 lines; a 6-field tuple table plus the existing mapper emits the same `UiComponentEntry[]`. [packages/dsh-tauri-ui/src/client/components/registry.ts:90-209] (-110 LOC)
  - Only consumer: the dev playground (`packages/dsh-tauri-ui-playground/src/client/ui/components-playground/ui-components.tsx:1,25,66,222,227`). Search string: `UI_COMPONENT_REGISTRY|UiComponentEntry`. `THIRD_PARTY_NOTICES.md:18` is prose only.

`stdlib:` `rmtree`'s `clearReadOnly` hand-walks the tree chmod-ing dirs `0o777` / files `0o666` with per-call try/catch; `chmodSync(path, 0o777, { recursive: true })` is the Node API for exactly this. [packages/dsh-tauri-extension/src/host/service/rmtree.ts:20-48] (-24 LOC)

`shrink:` `clearReadOnly`'s three sibling MCP scanners `scanClaudeMcp` / `scanCursorMcp` / `scanGeminiMcp` are the same `existsSync → JSON.parse (try/catch) → isObject(parsed.mcpServers) → compact(Object.entries(...).map(map…))` block three times; one `scanJsonMcp(home, file, agent, mapper)` covers all three (the two mappers `mapMcpServersEntry` / `mapAgentEntry` stay). [packages/dsh-tauri-extension/src/host/service/agents.ts:106-154] (-20 LOC)

`keep: Card.Header / Card.Icon / Card.Content / Card.TitleRow / Card.End 保留；其内部 tv slot 可按需收敛。` — 仓内确无调用方（search string: `Card\.(List|Header|Icon|Content|TitleRow|Title|Description|End)` → 全仓命中只有 `Card.List` / `Card.Title` / `Card.Description`，位于 extension `skills-tab.tsx:247,254,258`、`mcp-tab.tsx:346,350,355`、`mcp-import-dialog.tsx:68,73`、scheduler `task-card.tsx:99,103`、`runs-tab.tsx:41,56,61`、`scheduler-panel.tsx:153`），但 `Card` 是 `Object.assign(CardBase, {...})`（`packages/dsh-tauri-ui/src/client/components/card.tsx:37`），经 `components/index.ts` → `packages/dsh-tauri-ui/src/client/index.ts:17` 出口，且 `dsh-tauri-ui/client` 是**跨包公共 UI 面**（`packages/dsh-tauri-extension/src/client/components/mcp-tab.tsx:5`、`mcp-import-dialog.tsx:4` 等直接 import `Card`）⇒ 删成员即收窄出口契约，按 `docs/audit/protocol-surface.md` §1 不计入 net。（Lead 复核修正：原为 `delete:` -20。）

`shrink:` `mcp-tab.tsx` and `skills-tab.tsx` are the same remote-resource UI written twice: the load effect (`mcp-tab.tsx:38-57` ≈ `skills-tab.tsx:45-62`), the outcome `Notice` block (`mcp-tab.tsx:322-327` = `skills-tab.tsx:224-229`), the error-text builder `` `${t('failed')}: ${error instanceof Error ? error.message : String(error)}` `` (`mcp-tab.tsx:50,73,93,107,237,254`, `skills-tab.tsx:55,100,130,148,156,164,191`), and skills-tab's two polling loops (`refreshUntil` 77-91 vs the inline `IMPORT_REFRESH_DELAYS_MS` loop 184-189). Four small shared helpers (`OutcomeNotice`, `failText(t, error)`, `useRemoteResource`, one `pollUntil`) collapse all of it. [packages/dsh-tauri-extension/src/client/components/mcp-tab.tsx, .../skills-tab.tsx] (-40 LOC)

`shrink:` `new-session.ts` is two ~20-line features that differ only in the button matcher (`newSessionButtonFrom` vs `ungroupedCreateButtonFrom`) and one warn string; one factory taking `(matcher, warnText)` emits both. [packages/dsh-tauri-ui/src/client/register/new-session.ts:14-36,44-66] (-20 LOC)

`yagni:` `market-tab.tsx` is a file whose whole body is `return <>{market.render({ preferredSubsectionId: 'installed' })}</>`; inline it at the one call site. [packages/dsh-tauri-extension/src/client/components/market-tab.tsx:15-17, used at .../extension-panel.tsx:27-33] (-14 LOC)

`delete:` `SettingsSidebarProps` is declared but never read — the component is `SettingsSidebar(_props)` and touches no prop; and `useWorkspaces?: unknown` is declared in two prop interfaces and never read. [packages/dsh-tauri-ui/src/client/ui/settings-sidebar.tsx:21-24,39, packages/dsh-tauri-ui/src/client/ui/settings-trigger.tsx:37 with `SettingsTrigger({ wide, useSessions })` at :45] (-6 LOC)
  - Search string: `useWorkspaces` → only those two declarations plus the real use in `ui/hero-workspace.tsx:45` / `ui/hero-workspace.types.ts:27`.

`shrink:` `loadSections` / `loadOnboardingSteps` are `async` with no `await` in either body; drop `async` and the two `void` at the call site. [packages/dsh-tauri-ui/src/client/service/sections.ts:7,14, callers packages/dsh-tauri-ui/src/client/register/sections.ts:8-9] (-6 LOC)

`shrink:` `useMountStyle`'s `disposerRef` retread is what `useEffect` cleanup already gives: `useEffect(() => mountStyle(cnode, id, owner), [cnode, id, owner])`. [packages/dsh-tauri-ui/src/client/hooks/use-mount-style.ts:6-12] (-6 LOC)

`shrink:` `PlatformModuleLoader` (ui) and `PlatformPluginLoader` (extension) are line-for-line copies of `HostPluginLoader`, already exported from `dsh-tauri`'s root. `import type { HostPluginLoader } from 'dsh-tauri'` deletes both. [packages/dsh-tauri-ui/src/host/types/index.ts:5-8, packages/dsh-tauri-extension/src/host/service/provider.types.ts:1-4, source packages/dsh-tauri/src/host/types/harness.ts:47-50 re-exported at packages/dsh-tauri/src/index.ts:28] (-8 LOC)

`shrink:` `SessionResumeResponse` / `UngroupedResponse` are hand-written twice, once per side of the wire; `src/shared/` exists for exactly this. [packages/dsh-tauri-ui/src/client/apis/index.type.ts:3-12 vs packages/dsh-tauri-ui/src/host/routes/index.types.ts:1-4] (-6 LOC)

`shrink:` `startProvider` exists only to `void remountProvider(); return clearHostRuntime` for its single caller one line above. [packages/dsh-tauri-extension/src/host/apply.ts:41-44, caller :32] (-5 LOC)

`shrink:` `restartHost` declares `Promise<{ ok: boolean, error?: string }>` and returns `{ ok: true }` on all three paths; the only caller is `void restartHost()`. Return `Promise<void>`. [packages/dsh-tauri-extension/src/client/service/restart.ts:4-14, caller packages/dsh-tauri-extension/src/client/components/mcp-tab.tsx:265] (-5 LOC)

`shrink:` `profile.peek(name)` is a one-line alias of `profileDir(name)` from the same package's utils; the service adds nothing. [packages/dsh-tauri-extension/src/host/service/profile.ts:13-15, caller packages/dsh-tauri-extension/src/host/apply.ts:31] (-4 LOC)

`shrink:` `localButton`'s `size: { md: '', sm: '' }` variants are empty strings that exist only so the single `compoundVariants` entry can match `size: 'sm'`; inline that clause on `variant === 'danger' && size === 'sm'`. [packages/dsh-tauri-ui/src/client/components/button.tsx:23,26] (-3 LOC)

`shrink:` the host writes only `scope` (`host/service/mcp.ts` list path), never `layer`; both client expressions carry a dead fallback. [packages/dsh-tauri-extension/src/client/components/mcp-tab.tsx:347,351, field at packages/dsh-tauri-extension/src/host/routes/index.types.ts:72] (-2 LOC)

`delete:` `@deepseek-ai/cordis` is a devDependency with zero imports anywhere in the package; the `cordis.patch.yml` bundle patch is a separate `dsh.bundle` field and stays. [packages/dsh-tauri-extension/package.json:71] (-1 dependency)
  - Search string: `cordis` → only `package.json:71`, `THIRD_PARTY_NOTICES.md:40`, `host/config/constants.ts:9` (the file name string), `host/service/mcp.utils.test.ts:57` (a filename).

`keep:` `SEAT_EFFECT` and `TURN_NAVIGATION_LABEL_ZH/EN` + `TURN_NAVIGATION_SELECTOR` + `TURN_NAVIGATION_SLOT_SELECTOR` have no in-repo reader (search strings `SEAT_EFFECT`, `TURN_NAVIGATION_` → definitions only), but they are entries in the plugin's public constants module. [packages/dsh-tauri-ui/src/client/constants/index.ts:55,65-68]

`keep:` `restartNeeded` is hard-coded `true` by six routes and never read by the TS client, but the e2e suite asserts it. [packages/dsh-tauri-extension/src/host/routes/index.types.ts:89,95,100,116; writers mcp/get.ts:7, mcp/post.ts:22, mcp/delete.ts:21, mcp/toggle/post.ts:22, mcp/copy/post.ts:28, import/apply/post.ts:45; asserted at test/e2e/plugins/dsh-tauri-extension.e2e.ts:32,51,115,371]

`keep:` `src/client/types/remotes.ts` (24 LOC) restates five types that already exist verbatim in `packages/dsh-tauri-model/src/client/types/remotes.ts:1-19` and has no in-repo consumer — but it is re-exported from the package's client entrypoint. [packages/dsh-tauri-ui/src/client/types/remotes.ts:1-24, re-export packages/dsh-tauri-ui/src/client/index.ts:18]

`keep:` `stepSegment` is exported but has exactly one caller, in the same file, and no test. [packages/dsh-tauri-ui/src/client/components/segmented-control.tsx:37, internal call :70]

## Considered and rejected

- `packages/dsh-tauri-ui/src/client/styles/index.ts` — 2205 lines of generated Tailwind v4.1.11 in one template literal, but it is generated output of `scripts/taiwindcss.ts` (excluded category), and its only consumer is `register/styles.ts:12`.
- `utils/style.ts` `mountCounts` refcount — load-bearing: `useMountStyle` mounts the same cnode from independent component instances (playground `ui-components.tsx:26,92`, experimental `running-changes-chip.tsx:10,20`).
- `components/official.tsx` (112), `components/icons.tsx` (49), `components/index.ts` — re-export barrels with a documented constraint (only members present in both `0.1.5-rc.1` and `0.1.7-*` may be forwarded, else React #130).
- `components/checkbox.tsx`, `components/dot.tsx` — reforked copies of upstream members added in 0.1.7; needed while the 0.1.5 kernel is supported.
- `Select` props `icon` / `chevron` / `variant` — exercised by the playground, and `variant="composerTrigger"` is used in production (`dsh-tauri-scheduler/.../task-create-dialog.tsx:318,325`, `dsh-tauri-model/.../model-config-toolbar.tsx:67`).
- `Action` variants `search|model|round|row|help` — only the playground renders them, but they are the documented refork surface for the official buttons.
- `Button` variants `add` / `addGhost` / `elevated` — used outside this package (`dsh-tauri-scheduler/.../scheduler-panel.tsx:103,106`); `Chip.badge` used at `dsh-tauri-scheduler/.../model-picker.tsx:185`.
- extension `locales/index.ts` (234 lines, 113 keys ×2) — every suspect key resolves to a caller (`importIntro` mcp-import-dialog:30, `editorJsonTab`/`formatPaste` mcp-editor-form:38,47,57, `scopeAll`/`checkLabel`/`checkRunning` mcp-tab:305,362, `transportStdio` mcp-editor-form:27, `restartConfirmBody` mcp-tab:427, `skillUserOnly`/`skillModelOnly` via `policyTag` skills-tab.utils.ts:10-12). No dead keys.
- extension `client/apis/index.ts` wrappers with no caller (`postMcpCopy`:34, `getRoots`:64, `deleteRoots`:74) — swagger-generated file; the routes are protocol surface.
- `host/service/tar.ts` (146 lines hand-rolled ustar/gzip reader) — no tar/unzipper dependency exists anywhere in the workspace catalog, so this is a deliberate zero-dep implementation.
- extension `register/settings.ts:53-100` `publishLauncherShortcut`/`shortcutOf`/`CatalogLike` — has a real consumer (`ui/settings-trigger.tsx` forwards `settingsShortcut` into `SETTINGS_LAUNCHER_SLOT`).
- `registry.ts:60-88` primitives rows — one line per member, already minimal; only the `reforkVariant` rows are worth collapsing.
- `styles/global.cssr.ts`, `ui/hero-workspace.cssr.ts`, `register/obstructions.ts`, `register/composer-resume.ts` — host-UI override logic keyed to official class suffixes; the size is the compatibility surface, not dead weight.

## net: -265 lines, -1 dependency possible.

> Lead 复核修正：原 net -285 含 `Card.*` 五成员删除（-20），已按协议面出口契约降级为 `keep:`（见上），不计入 net。findings 计数相应为 17 条裁剪 + 5 条 `keep:`（原 18 + 4）。

## 执行复核（2026-09-30）

以下执行结论覆盖原审计建议；原 net 为估计，不是实际删除承诺。

- 已执行：20 条（原报告误记 19 条）refork 元数据行改成现有函数的紧凑参数行，不增加中间表；保留全部字段、版本、顺序和 primitive 行。两组新建会话监听共用内部工厂，仍在点击时探测能力，每次注册独立抑制告警。`useMountStyle` 直接使用 effect cleanup，保留样式引用计数和 owner 隔离。
- 已执行：复用 `HostPluginLoader`，保留原 `PlatformModuleLoader` / `PlatformPluginLoader` interface 名称及声明合并能力；内联私有 `MarketTab` / `startProvider`，共享九处相同错误文案；移除 extension 无引用的 cordis devDependency 和 lock importer 声明，保留 bundle patch 与真实传递依赖。
- 已执行：仅 Cursor/Gemini 共用 JSON 扫描；Claude 必须先按文件顺序合并原始配置再校验，较晚无效条目仍覆盖较早有效条目，不能统一成逐文件过滤后合并。保留映射差异、agent 顺序及原有异常语义。
- `keep:` `clearReadOnly`。原建议 `chmodSync(path, mode, { recursive: true })` 不是 Node API；逐路径 chmod、文件/目录模式与 best-effort 错误处理不删。
- `keep:` Card 全部成员、SettingsSidebar/SettingsTrigger 槽位 props、异步 Query 签名、生成 DTO、restartHost 返回契约、profile.peek 服务方法、scope/layer 兼容字段、Button 由 tv 派生的尺寸类型及公共常量/类型出口。
- 未新增 `useRemoteResource` / `pollUntil` / `OutcomeNotice`：生命周期、轮询与标记并不完全相同；仅复用实际相同的文案，避免为预计几行收益引入抽象或行为变化。
- 验证：UI metadata、style cleanup/refcount、点击时能力检查和独立注册告警回归；extension 配置合并/扫描、市场参数、provider 生命周期、loader 契约及文案回归。各范围至少五次乱序通过并做变异验证；最终五包汇总 52 文件 / 386 用例通过，限定真实源码别名类型检查通过，Lint 零错误（仅既有警告）。
