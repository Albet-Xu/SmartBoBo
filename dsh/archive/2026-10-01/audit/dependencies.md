# 依赖层审查（ponytail-audit）

范围：根 `package.json`、`pnpm-workspace.yaml`（catalog / catalogs / patchedDependencies）、`packages/*/package.json`、`patches/`。
方法：`git grep -l --fixed-strings "<name>" -- . ':!pnpm-lock.yaml' ':!node_modules'` 逐依赖计数；每个 `delete:` 都给出证明零引用的检索式。
判定规则沿用 `docs/audit/protocol-surface.md`：**本仓无调用方 ≠ 死代码**。协议面（`dsh-tauri/client` 的 `modules/*` 具名出口、插件公开 API、Tauri command / event 名）即使当前无人 import 也一律保留；只有「本仓唯一引用处是自己被声明的那一行」才算死依赖。

重要前置约定（不要误删）：`packages/dsh-tauri/src/client/modules/*.ts`（`lodash-es` / `date-fns` / `hookable` / `css-render` / `valtio-define` / `reause`）不是转发层，而是**依赖收敛的唯一出口**：插件 client bundle 走 CJS 工厂 + 模块表，直接 `import` 这些包会发出模块表查不到的 `require`；`packages/dsh-tauri/src/client/modules/reause.ts:1-16` 记录了 306 导出 → 具名清单后 941KB → 70KB 的实测。另：`react-if-lite` 由 `docs/specs/desktop.baisc.md:90` 强制使用（禁止 `?:` / `&&`），永不列入删除。

## 可直接删除（全仓零引用）

- `delete: citty / consola / dotenv / tinyexec 四个根 devDependency —— 全仓零引用（含 scripts/、.github/**、vite/vitest/tailwind 配置），只出现在自己被声明的那一行。连同 catalogs.utils 里的四条目一起删。[package.json:104-106,117 / pnpm-workspace.yaml:213,214,217,226]` (-4 deps)
- `delete: @genapi/parser —— 零引用。genapi 实际只吃 @genapi/core（genapi.config.ts:1）、@genapi/shared（genapi.pipeline.ts:1）、@genapi/presets（genapi.pipeline.ts:7）、@genapi/pipeline（genapi.pipeline.ts:6）。删 package.json:85 与 pnpm-workspace.yaml:110。[package.json:85]` (-1 dep)
- `delete: packages/dsh-tauri-worktree 声明的 hookable —— git grep -l --fixed-strings hookable -- packages/dsh-tauri-worktree 只命中 package.json:60 本身；包内 src 无任何 hookable 用法（同仓 archive/experimental/extension 都是在 src/host/events/index.ts 真用）。[packages/dsh-tauri-worktree/package.json:60]` (-1 dep)
- `yagni: knip —— 仓库里只有一个 "knip": "knip" 脚本和一条 devDependency，无 knip 配置文件，.github/workflows/** 中零调用（grep -E "knip" .github/workflows → 无命中）。它本身是「找未使用导出」的工具、正对本次审查的题，所以是判断题而非铁定死依赖：要么接进 CI（否则没人跑），要么连 catalogs.lint 条目一起删。[package.json:26,110]` (-1 dep，取决于是否接入 CI)
- `delete: @hairy/utils —— 全仓唯一用法是 src/store/modules/harness/readiness.ts:1 的 import { delay }；换成 await new Promise(r => setTimeout(r, ms)) 后根依赖与 catalogs.utils 条目一起消失。[package.json:35, src/store/modules/harness/readiness.ts:1]` (-1 dep)
- `delete: packages/dsh-tauri-model 的 react-if-lite —— 该包 src 零 import；react-if-lite 的真实消费者全在根 src/**（src/components/logs.tsx:3 等 13 处）。其 tsdown.config.ts:6 的 noExternal: ['react-if-lite'] 因此也是空转（没有 import 可内联）。[packages/dsh-tauri-model/package.json:87, packages/dsh-tauri-model/tsdown.config.ts:6]`
- `delete: @deepseek-ai/dsh-storage-domain（根 devDependency）—— 零引用；仅出现在 package.json:79、pnpm-workspace.yaml:50（minimumReleaseAgeExclude）与 :155（catalog）三处声明。删除前确认它不是别的 dsh 包的 peer。[package.json:79]` (-1 dep)

## 可原生替代（stdlib / native）

- `stdlib: lodash-es 的绝大多数具名导入都有原生等价物，逐处替换后整个依赖可退场。原生对照：isArray→Array.isArray、isString→typeof、isFunction→typeof、isFinite→Number.isFinite、isInteger→Number.isInteger、isNil→x == null、compact→filter(Boolean)、uniq→[...new Set]、uniqBy/keyBy→Map 或 Object.fromEntries、groupBy→Object.groupBy、orderBy/sortBy→Array.prototype.toSorted、head/last→arr[0]/arr.at(-1)、take/takeRight→slice、difference→filter + Set、castArray→Array.isArray 三元、inRange→比较、trimEnd→String.prototype.trimEnd、partition→两次 filter、reject→filter 取反。只有 get（路径取值，可选链 a?.b 覆盖常见形）与 debounce/throttle/cloneDeep 无原生等价物，需保留或自行实现。[packages/dsh-tauri-worktree/src/host/{prompts,service,tools,utils}/*.ts, packages/dsh-tauri-scheduler/src/host/{service,utils}/*.ts, packages/dsh-tauri-extension/src/host/service/*.ts, packages/dsh-tauri-archive/src/host/service/*.ts, packages/dsh-tauri-rightclick/src/host/routes/open/*/post.ts, packages/dsh-tauri/src/client/modules/lodash-es.ts]` (-1 dep possible，前提是 6 个包的 41 个 import 点全部落地)

## catalog / 配置卫生

- `yagni: catalogs.utils 里 date-fns、lodash-es、pathe、unstorage、hookable、ofetch 等条目被 7 个包以 catalog:utils 共享，是正确的收敛方式，保留。但 citty/consola/dotenv/tinyexec 四条在删根依赖后即成孤儿条目，需同步删除。[pnpm-workspace.yaml:213,214,217,226]`
- `shrink: minimumReleaseAgeExclude 的 80 条目是 pnpm trustPolicy: no-downgrade + 每日跟着 dsh 预发布走的必要逃生口，不是过度设计，保留。[pnpm-workspace.yaml:13-95]`

## Considered and rejected（看过但不动）

- `source/`（13 个 git submodule：BongoCat、deepseek-harness、dsh-automation、dsh-dafeiyu、dsh-market、dsh-notification(s)、dsh-pet、dsh-plugin-capabilities、dsh-plugin-codex-pets、dsh-session-notification、tauri-plugin-notifications、zcode）—— `.gitignore:33` 忽略、`.gitmodules` 登记，本仓 0 字节，是上游移植参考而非代码，不构成可删减的实现。
- `patches/` 两个补丁都真的在生效：`pnpm-lock.yaml:343-344` 的 patch_hash 显示 `@tauri-apps/plugin-http@2.6.0` 与 `bumpp@12.2.1` 均按 patch 解析（`pnpm-workspace.yaml:103-105` 绑定）。
- `publint`（package.json:114）虽然零 import，但 `packages/dsh-tauri-tsdown/src/index.ts:85` 会把 `publint: true` 透给 tsdown，tsdown 运行时按需加载该包，保留。
- `@types/semver`（package.json:96）零 import 是正常的：`semver` 自身不带类型，由 tsc 隐式解析。
- `@types/*`、`tsdown`、`typescript` 在包内「零引用」都是误报（tsc / tsdown 隐式消费），不删。
- root `ssh2`（package.json:115）唯一消费者是 `test/e2e/plugins/dsh-tauri-ssh.e2e.ts:20`（真实 SSH 协议往返的 e2e 服务端），保留。
- `@eslint-react/eslint-plugin`、`eslint-plugin-react-refresh`：由 `@antfu/eslint-config` 的 react:true 与 `eslint.config.mjs:3` 注释确认是预设的运行期依赖，保留。
- `@vitest/coverage-v8`：`vitest.config.ts:31-32` 的 coverage 块依赖它，保留。
- `changelogithub`：`.github/workflows/release.yml:102` 真跑，保留。
- `date-fns`：唯一出口是 `packages/dsh-tauri/src/client/modules/date-fns.ts:1` 的 4 个函数，属协议面收敛出口；`test/plugin-resource-closure.test.ts:55` 还专门断言它不会被作为嵌套副本打进插件产物，保留。
- `dsh-tauri-bundle`（只有 package.json、显式列出 11 个兄弟包）——是打包聚合用的清单包，不是空壳依赖，保留。

net: -0 lines, -9 deps possible（确定可删 8 项：citty、consola、dotenv、tinyexec、@genapi/parser、packages/dsh-tauri-worktree 的 hookable、@hairy/utils、@deepseek-ai/dsh-storage-domain；knip 视是否接入 CI 决定；若 lodash-es 全量原生化再 -1）。
