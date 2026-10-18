# ponytail-audit · 全仓过度设计审查

> 仓库 `dsh-tauri-desk/deepseek-harness-desktop` · 审查日期 2026-09-30 · **只读审查，未改动任何被审查代码**（`git status --porcelain` 全仓仅 `?? docs/audit/`）
> 规则集：`ponytail-audit`（level full）—— 只裁「过度设计 / 复杂度」，正确性、安全、性能明确不在范围
> 硬约束（用户指定）：**协议类方法即使本仓无调用方也不得标记为删除**（`useListen`、`useListenIframe`、`useInvoke` 等）

## 怎么读这份报告

- 每条 finding 一行：`<tag> <裁什么>. <换什么>. [path:line]`，按可裁剪行数从大到小排序，每条结尾给出 `(-N LOC)`。
- tag 含义：`delete:` 死代码/无人设的开关/投机能力，替换为「无」。`stdlib:` 手写了标准库已有的东西，点名函数。`native:` 依赖或代码在做平台已经做的事，点名平台特性。`yagni:` 只有一个实现的抽象、没人设的配置、只有一个调用方的层。`shrink:` 逻辑不变、行数更少，给出更短的写法。
- 每份报告末尾的 `net: -N lines, -M deps possible.` 是该域的净收益；本 README 末尾是汇总。
- 搜索证据：本机 `rg` 不在 PATH（`Get-Command rg` 失败），零调用方证明统一改用 ripgrep 内核的 harness grep 工具与 `git grep`，搜索范围排除 `node_modules` / `dist` / `target`。**grep 只能证明「没有显式引用」，不能证明「没有被隐式消费」**（例如构建工具的约定式自动发现、配置文件里的字符串引用）——这类条目一律进「需人工确认」或降级为 `keep:`。

## 排除面（不参与裁剪，且在每份报告中被显式保护）

1. **协议面 / IPC 面** —— `docs/audit/protocol-surface.md` 是本次审查的唯一豁免清单，所有 agent 都被要求遵守。要点：从 `src/index.ts` / `client/index.ts` / `host/routes/index.ts` 出口的符号、`docs/specs/plugin.*.md` 里点名的 API、注释自述「协议 / 先定义好 / 暂无调用方」的符号、以及任何通过**字符串通道**（事件名、Tauri command 名、slot 名、route path、capability 名、**`cordis.patch.yml` 里的包名**）被引用的符号，一律不删；只有「纯实现内部、未出口、且无字符串引用」的私有符号才允许 `delete:`。仓内无调用方 ≠ 死代码：消费者在仓外（iframe 里的 dsh 核心 GUI、第三方 cordis 插件、上游 dsh、未来版本）。
2. **信任边界** —— `src-tauri/src/service/fs_guard.rs`、`src/hooks/use-invoke-iframe.ts:31-37` 的 iframe invoke 白名单、`recovery/mod.rs` 的包名校验、tar 安全阶梯、`perm.rs` 提权提示等，明确不因「看起来多余」而删。
3. **`src-tauri/vendor/**`** —— 第三方 vendored 代码，不属于本仓可裁范围。
4. **`source/`** —— 13 个 git submodule（BongoCat、deepseek-harness、dsh-market…），仓内 0 字节，是外部移植参考，不审。
5. **`archive/`** —— AGENTS.md 禁止读取。

## 报告索引

| 域 | 报告 | findings | net |
| --- | --- | --- | --- |
| 依赖层（根 + 各包） | [dependencies.md](dependencies.md) | 9 | -0 行，-9 deps（去重后见汇总） |
| 构建/配置/测试/脚本 | [tooling-config-tests.md](tooling-config-tests.md) | 8 | -496 行 |
| Rust · 插件服务 | [rust-plugin-service.md](rust-plugin-service.md) | 23 | -508 行 |
| Rust · 核心服务 | [rust-service.md](rust-service.md) | 39 | -855 行（含 1 项建议加依赖的 -128，纯裁剪 -727） |
| Rust · 壳层/IPC/配置 | [rust-shell.md](rust-shell.md) | 32 | -397 行 |
| 包 · dsh-tauri 核心 | [pkg-core.md](pkg-core.md) | 4 cuts + 3 keep | -20 行 |
| 包 · ui + extension | [pkg-ui-extension.md](pkg-ui-extension.md) | 17 cuts + 5 keep | -265 行，-1 dep |
| 包 · model + experimental | [pkg-model-experimental.md](pkg-model-experimental.md) | 17 | -456 行，-2 deps（与 pkg-core 重叠，见汇总） |
| 包 · worktree + archive + pet | [pkg-worktree-archive-pet.md](pkg-worktree-archive-pet.md) | 31 | -490 行，-4 deps |
| 包 · ssh + scheduler + notification + rightclick | [pkg-ssh-scheduler-notify-rightclick.md](pkg-ssh-scheduler-notify-rightclick.md) | 27（ssh 13 / scheduler 10 / notification 2 / rightclick 2） | -452 行，-4 deps（去重后见汇总） |
| 前端 `src/**` | [frontend-src.md](frontend-src.md) | 12 | -341 行，-1 dep |
| **协议豁免清单** | [protocol-surface.md](protocol-surface.md) | —（豁免规则） | — |

合计 **213 条 finding**（不含 dependencies 的 9 条依赖项）。

## Lead 复核修正（agent 报告经复核后改动的地方）

review 阶段发现 5 处 agent 判断按 `protocol-surface.md` §1 需要降级或修正，均已直接改进对应报告：

1. `pkg-core.md`：`defineRegister(ctx, setup)` 双参重载（文档在 `packages/dsh-tauri/src/client/register/index.ts:23-24`，实现 `:76-85` 带 `TypeError` 守卫）、`defineAdapter(ctx, { migrations })` 第二参（文档在 `packages/dsh-tauri/src/client/register/index.adapter.ts:664`，签名 `:796`）、`invoke/listen/useInvoke/useListen` 的 `options` 形参——三者都被 `packages/dsh-tauri/src/client/index.ts` 的 `export * from './register'` 等出口面引用，收窄会让仓外插件编译失败 ⇒ 降级 `keep:`，net 由 -44 改为 **-20**。
2. `pkg-ui-extension.md`：`Card.Header/Icon/Content/TitleRow/End` 由 `delete:` 降级 `keep:` —— `packages/dsh-tauri-ui/src/client/components/card.tsx:37` 是 `Object.assign(CardBase, {...})`，经 `components/index.ts` → `packages/dsh-tauri-ui/src/client/index.ts:17` 出口，且已被 `packages/dsh-tauri-extension/src/client/components/mcp-tab.tsx:5`、`mcp-import-dialog.tsx:4` 消费 ⇒ net 由 -285 改为 **-265**。
3. `pkg-worktree-archive-pet.md`：pet 的 `@deepseek-ai/dsh-skill-filesystem` 由 `delete:` 降级 `keep:` —— 它在 `packages/dsh-tauri-pet/src` 内零命中，但是**字符串通道引用**：`packages/dsh-tauri-pet/cordis.patch.yml:3` 的 `name: '@deepseek-ai/dsh-skill-filesystem'` 把它作为 skill provider 行插进运行时插件图（`THIRD_PARTY_NOTICES.md:14` 记载 `includeDefaultRoots: false` + `customSkillDirs`）⇒ deps 由 -5 改为 **-4**。**这条判例推出一条通用教训：本仓的「零调用方」证明必须覆盖 `cordis.patch.yml` 等配置型字符串面，只检索 `src/` 不足以定论**——据此对全仓 `packages/**/*.yml` 做了依赖名扫描，确认其余待裁依赖名无配置型引用。
4. `tooling-config-tests.md`：`test/e2e/probe-wdio.ts` 实为 212 行（原报告写 251），且文件头自述「保留为不依赖 WDIO 的最小诊断通道之一」⇒ 移入「需人工确认」；`postcss.config.js` 因 Vite 的隐式自动发现不可 grep ⇒ 同样移入「需人工确认」；net 由 -535 改为 **-496**。
5. `pkg-ssh-scheduler-notify-rightclick.md`：rightclick 的 `SessionSummaryLike` 声明行 `:18` → 实为 `client/types/index.ts:14`（已改）；并在该条注明引用点 15 处、改名不改行数。

Lead 另行抽查确认（grep 工具 / `git grep` 复核过）：`SharedRotatingWriter` 全仓只出现在 `src-tauri/src/logger/mod.rs:238,239,273`；`restore_real_backup_to_temp` 的硬编码路径在 `src-tauri/src/service/backup/mod.rs:423`；`download_file`（`src-tauri/src/service/download/core.rs:21-26`）唯一调用方是 `src-tauri/src/service/plugin/install/pnpm.rs:106`；`ENSURE_REUSE_WINDOW` 在 `src-tauri/src/service/plugin/internal/mod.rs:77`；`allowlist.rs:171` 确有作者自留的 `TODO(v1)`；scheduler 的 `followGlobal` 全仓仅 locale 定义处 2 命中（死键）；`useZoomLevel` 在 `src/**` 只命中自身文件；`navbar.tsx` 的 `onOpenMachineManager`/`onOpenSyncToRemote` 全仓只出现在该文件 4 行。

## 需人工确认（grep 无法定论，删除前必须人工判断）

1. `test/e2e/probe-wdio.ts`（212 行）—— 全仓零引用（`git grep --fixed-strings "probe-wdio"` 无命中，docs 亦无），但文件头注释自称「保留为不依赖 WDIO 的最小诊断通道之一」。属作者声明式保留，删前确认。
2. `postcss.config.js`（5 行）—— 没有任何**显式**引用，但 `vite.config.ts` 未设置 `css.postcss`，Vite 会按约定**隐式自动加载**该文件，grep 看不见。本仓禁止跑构建（用户可能正处于插件热重载中），故无法用构建验证。
3. `knip`（4 处配置，见 `dependencies.md`）—— 装了、有 script，但 CI 从不调用、也无 knip 配置文件。是「配置了没用」还是「留给本地用」属维护者意图。
4. `src/hooks/use-zoom-level.ts`（75 行，frontend-src.md）—— `src/hooks/use-zoom-level.ts:8` 自述「签名与 `@reause/electron` 的同名 hook 完全一致」，若属迁移期 API 对齐面则应 `keep:`，届时前端域 net 减 92。

## 汇总

**net: -4280 行（各报告自报值算术和）**

按「不加新依赖、不含待确认项」的稳妥口径：

| 口径 | 行数 | deps |
| --- | --- | --- |
| 各报告自报合计 | -4280 | 自报 -21（有重复计数） |
| 扣除建议新增依赖的项（`junction` crate，-128） | -4152 | — |
| 扣除「需人工确认」项（probe-wdio 212 + postcss 5 + use-zoom-level 级联 92） | **-3843** | — |

**deps：确定可删 11 项声明**——`citty`、`consola`、`dotenv`、`tinyexec`、`@genapi/parser`、`@deepseek-ai/dsh-storage-domain`、`@hairy/utils`、`packages/dsh-tauri-worktree` 的 `hookable`、`packages/dsh-tauri-model` 的 `react-if-lite` 声明、`packages/dsh-tauri-extension` 的 `@deepseek-ai/cordis`、`packages/dsh-tauri-worktree` 的 `simple-git`。
**条件项 3 个**——`knip`（是否接入 CI）、`packages/dsh-tauri` 的 `hookable`（需先落地 controller 的 `hookable` → `Set`）、`lodash-es` + `@types/lodash-es`（需落地 scheduler / rightclick / worktree / archive / extension / dsh-tauri 六处原生替换，声明点 7 处）。

去重说明（自报 -21 → 确定 11）：`pkg-model-experimental` 的 -2 deps 与 `pkg-core` 的 `dsh-tauri` `hookable` 项是同一处、其 `react-if-lite` 已由 `dependencies.md` 计数；`pkg-ssh-scheduler-notify-rightclick` 的 -4 deps 全部落在 `lodash-es`/`@types/lodash-es` 条件项内；`frontend-src` 的 -1 dep 即 `@hairy/utils`；`pkg-worktree-archive-pet` 的 -4 deps 中 `lodash-es` 两项属条件项。

汇总口径与限制：

- 只累加各报告 `net:` 里号称可裁的行数，不含 `keep:` 条目，不含「需人工确认」项，也不含建议「新增一个依赖」的项（`junction` crate，rust-service 里计 -128 行但 +1 dep）。
- 算术和是**估算**：跨域存在少量可能重叠（同一文件被两条 finding 触及的不同侧面，例如 rust-plugin-service 的 `internal/manifest.rs:117-166` 同时出现在「原子写」与「MoveFileExW」两条），未逐条核减；实际收益应按下限预期。
- 本次审查**未运行任何构建命令**（AGENTS.md 禁止，用户可能正处于插件热重载中），所有结论均为静态阅读 + `git grep`/grep 工具的证据，故「隐式消费」类风险统一进「需人工确认」。
- 覆盖度限制已在各报告末尾「覆盖度（诚实交代）」小节逐域列出：全量逐行覆盖了 Rust 全部 `src-tauri/src/**`（除 `vendor/`）、`packages/dsh-tauri` 核心、tooling/scripts、`src/hooks`/`src/utils`/`src/components`/`src/config`/`src/i18n`；`src/ui`(3.3k 行)/`src/store`(4.8k 行)/`src/layout` 其余部分、以及 ssh 的 manager/transport/bootstrap/sync 等大文件只做了符号级交叉引用扫描（已证明无「导出但零消费者」的函数，但可能仍有未发现的行数级冗余）。
- 顺带记录（不属行数问题）：`packages/dsh-tauri-ssh/package.json` 把运行时依赖 `yaml`（被 `packages/dsh-tauri-ssh/src/host/service/allowlist.ts:21` import）声明在 `catalog:testing` 组，按 `pnpm-workspace.yaml` 的分组语义应归 `catalog:utils`；`packages/dsh-tauri-experimental` 有约 12 个 `*.test.ts` 却没有 `test` script 与 vitest devDep（测试跑不起来，属正确性问题，交普通 review）。
