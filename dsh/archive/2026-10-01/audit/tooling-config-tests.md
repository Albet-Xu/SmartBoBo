# Tooling · configs / scripts / tests — ponytail-audit

> Scope: root configs, scripts/, genapi*, test/, .github/, patches/, skills/, public/, types/ · ~7k LOC · read 2026-09-30

## Findings (ranked, biggest cut first)

`shrink: seven hand-rolled char scanners in genapi.pipeline.ts all re-implement the same quote/depth walk (splitTopLevel 133-170, splitMembers 181-219, genericArgs 232-264, genericOf 266-299, sliceBalanced 301-330, sliceDeclaration 332-366, scanArrow 702-732 = 233 LOC). Replace with one parameterized scanner scan(src, start, {stopOn, trackAngle, stopAtNewline}) ≈ 70 LOC; or drop the parsers to the TypeScript compiler API already in the tree (scripts/build-plugins.ts:136-158 does the sibling job `relativeSpecifiers` in 23 LOC via ts.createSourceFile + ts.forEachChild, typescript ~5.8.3 in pnpm-workspace.yaml). [genapi.pipeline.ts:133-366,702-732] (-150 LOC)`

`delete: test/e2e/probe-wdio.ts — self-declared "D0 临时探针", spawns the debug exe and polls ports over raw HTTP. ripgrep for "probe-wdio" over the whole repo (excl. node_modules/dist/target): No matches found — no package.json script, no .github workflow, no test imports it. The real WebDriver path is used by test/e2e/desktop/*.e2e.ts. [test/e2e/probe-wdio.ts:1-212] (-212 LOC)`

> Lead 复核修正：文件实际 212 行（非 251），全仓引用仍为 0（`git grep -n --fixed-strings "probe-wdio" -- .` 无命中，`docs/**` 亦无）。但其头部注释自称「保留为不依赖 WDIO 的最小诊断通道之一」——属于作者声明式保留而非协议面，删除前需向作者确认（见 README「需人工确认」）。

`delete: postcss.config.js — Tailwind already enters the build twice elsewhere: @tailwindcss/vite (vite.config.ts:16) for the shell, and packages/dsh-tauri-ui/scripts/taiwindcss.ts:48 which passes plugins programmatically (postcss([tailwindcss(...)]).process(rawCss, ...)) so no config-file lookup happens. ripgrep "postcss.config": 0 hits; the only other postcss hits are package.json:88,113, pnpm-workspace.yaml:121,125, packages/dsh-tauri-ui/package.json:70,73 (dependency findings excluded) and taiwindcss.ts:6-7. [postcss.config.js:1-5] (-5 LOC)`

> Lead 复核补充：`vite.config.ts` 未设置 `css.postcss`，而 Vite 会**隐式自动加载** postcss.config.js —— 这种引用 grep 看不见。grep 证据只能证明「没有显式引用」，不能证明「未被隐式消费」；本仓禁止跑构建，故该条降级为需人工确认（见 README「需人工确认」）。

`yagni: two tsconfigs that differ only in build-script inclusion — tsconfig.json:33 adds scripts/build-plugins.ts back and tsconfig.node.json:10 excludes it, with composite:true + references existing only to satisfy that split. Fold into one tsconfig.json (include src, test, packages/*/src, packages/*/scripts, types, scripts) and delete tsconfig.node.json, letting typecheck also cover vitest.*.config.ts / genapi.* / bump.config.ts, which today are in NO tsconfig and therefore never typechecked. [tsconfig.json:25-34, tsconfig.node.json:1-11] (-11 LOC, +0 files)`

`yagni: four vitest config files where three would do — vitest.config.ts is a defineConfig whose entire body is one active line (`projects`); its resolve.alias (18-22) and coverage.exclude (32-44) are mirrored from the unit project / coverage defaults, and by its own header comment at :11 a project-level config cannot even inherit that alias. The three project files then repeat the same envelope (name/include/globalSetup/environment:node/fileParallelism:false/timeouts). Keep the three defineProject files, move `projects`, coverage and shared alias into a plain module both they and vitest.config.ts import. [vitest.config.ts:16-45, vitest.unit.config.ts:27-56, vitest.plugin.config.ts:17-27, vitest.desktop.config.ts:16-25] (-25 LOC)`

`shrink: four copies of the same `@` -> src alias with two different spellings — vite.config.ts:31 as the string '/src', vitest.config.ts:18-22 and vitest.unit.config.ts:28-32 as fileURLToPath(...). Export one SHARED_ALIAS const and import it in all three. [vite.config.ts:31, vitest.config.ts:18-22, vitest.unit.config.ts:28-32] (-8 LOC)`

`shrink: test-source readers are re-declared per file — readSource(relativePath) verbatim twice (test/clipboard-image-bridge.test.ts:16, test/pet-window-lifecycle.test.ts:16), readLocale(name) verbatim twice (test/navbar-maximize-icon.test.ts:16, test/navbar-run-menu.test.ts:20), navbarSource = readFileSync('../src/layout/components/navbar.tsx') four times (test/menu-restart.test.ts:12-15, test/navbar-mask-mirror.test.ts:13-16, test/navbar-maximize-icon.test.ts:11-14, test/navbar-run-menu.test.ts:15-18), and 6 one-line arrow readers for one module each in test/core-upgrade-profile.test.ts:12-17. Add test/setup/read-source.ts exporting readSource(rel) / readLocale(name) / readNavbar() and use it at every one of those sites. [test/clipboard-image-bridge.test.ts:16, test/pet-window-lifecycle.test.ts:16, test/navbar-maximize-icon.test.ts:11-16, test/navbar-run-menu.test.ts:15-20, test/menu-restart.test.ts:12-15, test/navbar-mask-mirror.test.ts:13-16, test/core-upgrade-profile.test.ts:12-17] (-45 LOC)`

`shrink: seven test files assert on raw source text of app files instead of behaviour, so every refactor must edit two files — test/shell-theme-alignment.test.ts (splits src/styles/main.css on /^html\[data-theme="light"\] \{/m and asserts literal --accent: #f9fafb / #0f1115 / --accent-foreground #0f1115 / #ffffff; then toContain 5 literal lines of tailwind.config.js), test/navbar-maximize-icon.test.ts:5-7+49-56, test/navbar-run-menu.test.ts:63-73, test/navbar-mask-mirror.test.ts:24-28, test/menu-restart.test.ts:17-64 (indexOf ordering inside builder.rs + i18n regex), test/wdio-e2e-gate.test.ts:24-30, test/plugin-patch-targets.test.ts:47-58. Coverage stays (exclusion 2) — the cut is the duplication: keep the token→value assertions, drop the "assert the source still spells the implementation this way" regexes where the same contract is already covered at runtime, and centralise the ones that must stay. [test/shell-theme-alignment.test.ts:12-76, test/navbar-maximize-icon.test.ts:49-56, test/navbar-run-menu.test.ts:63-73, test/navbar-mask-mirror.test.ts:24-28, test/wdio-e2e-gate.test.ts:24-30] (-40 LOC)`

---

Also spotted, below the noise floor of the ranking (listed for completeness, no separate LOC claim): test/navbar-run-menu.test.ts:20 and test/navbar-maximize-icon.test.ts:16 are byte-identical `readLocale` bodies reading the same zh-CN/en-US JSON; test/backup.test.ts, test/plugin-uninstall.test.ts, test/plugin-disable.test.ts, test/setup-copy-logs.test.ts, test/close-action.test.ts each repeat the `readFileSync(new URL('../src/...'), 'utf8')` shape 4-12 times — those calls carry per-site path arguments, so folding them is cosmetic and NOT counted above.

## Considered and rejected

- `.github/workflows/**` scripts — every named script is live protocol surface: `scripts/bundle-metadata.mjs` (.github/actions/prepare-bundle-resources/action.yml:133,173 and release-bundle.yml:172,206 incl. a `git cat-file -e` existence check), `scripts/release-identity.mjs` (release.yml:70), `scripts/fix-appimage-host-libs.sh --require-removal` (build-linux.yml:80, asserted by test/appimage-host-libs.test.ts:149,155). Not dead, not touched.
- `tailwind.config.js` + `tailwind.plugins.config.js` — both live and deliberately independent: referenced by `@config "../../tailwind.config.js"` in src/styles/main.css:3 / src/pet/main.css:3, and `@config "../../../../../tailwind.plugins.config.js"` in packages/dsh-tauri-ui/src/client/styles/index.css:13; `tailwind.plugins.config.js` exists to stop the plugin artifact from rescanning the shell's tokens. taiwindcss.ts:20 whitelists exactly these two. Two token families, two files — correct, not duplication.
- `scripts/rebuild-macos-icon.ts` — fills a real gap: `tauri icon` does not emit macOS tray-size assets, so the script composes the Apple 1024 grid (DOCK_SCALE 12.875, DOCK_GUTTER 100) and then reuses the CLI (`node node_modules/@tauri-apps/cli/tauri.js icon`) rather than reimplementing it.
- `scripts/build-plugins.ts` `materializeTree` (57-79) instead of `fs.cpSync(..., { dereference: true })` — the comment at 44-56 records that dereference regressed in Node 22.17 (nodejs/node#59168) and produces absolute links into a deleted temp dir, breaking `tauri build` with "resource path ... doesn't exist". Justified `native:`-looking code.
- `scripts/build-debug.ts` (56) — its only native-looking part is the temp `tauri-e2e.json` overlay; without it the root tauri.conf.json beforeBuildCommand runs twice. Deleting the script would move 3 build steps into CI YAML, not remove them. ~10 LOC at best; below the ranking cut-off.
- `build:taiwindcss` script — NOT dead: docs/specs/plugin.client.md:122 tells contributors to run `pnpm build:taiwindcss` before committing, and packages/dsh-tauri-ui/scripts/taiwindcss.ts:41 documents the same entry point.
- `test/setup/tauri-runtime.ts` — not dead: wired via vitest.unit.config.ts:52 (mockIPC + mockWindows for shell modules that touch Tauri at import time).
- `test/e2e/support/selectors.ts` / `preinstall.ts` / `onboarding.ts`, `setup-desktop.ts`, `setup-plugin.ts` — all consumed; selectors.ts:7-8 states it already prunes anchors with no consumer.
- No knip config file exists anywhere in the tree (git ls-files: none), so the `knip` script neither hides findings nor is itself dead.
- ESLint ignores correctly do not cover `archive/` or `test/archive/`, but those directories are out of audit scope by rule.
- `patches/bumpp.patch`, `patches/@tauri-apps__plugin-http@2.6.0.patch`, `types/slot-outlet.d.ts`, `skills/handle/SKILL.md`, `public/*.wav|*.svg`, `index.html`, `pet.html`, `.env.example`, `.editorconfig`, `bump.config.ts`, `genapi.config.ts` — all referenced or shipped surface; no finding.

## net: -496 lines, -0 deps possible.

> Lead 复核后修正：probe-wdio 实际 212 行（-251 → -212），故小计由 -535 修正为 -496。

## 执行复核（2026-10-01）

- **保留人工确认项**：probe-wdio 是明确保留的最小诊断通道；postcss.config.js 会被 Vite 隐式加载。没有作者删除确认，也不执行本地构建来替代确认，均不删除。
- **配置**：三个 Vitest project 的执行环境、并发、初始化及超时并不相同，不引入配置工厂，不移动根专属覆盖率。只共享 Vite/根 Vitest/unit 的绝对路径别名，保留 project、收集与排除规则。
- **类型检查**：合并根 TypeScript 配置与 node 配置，保留全部严格检查，将 scripts、根 *.config.ts 与 genapi*.ts 纳入 noEmit 检查。JS/MJS 保持原有未启用 checkJs 的边界；不扩张为包级构建配置迁移。
- **测试契约**：共享仓库相对源码/语言读取器，删除六个单消费者 reader 包装；未证明同等 runtime 门禁的源码断言全部保留，独立字面量 oracle 不变。mask 的否定断言增加正向存在契约，避免不存在的层误判为通过。
- **生成器**：七个扫描器共享私有参数化 quote/depth walker，保留 angle-only 泛型、忽略 angle 的 balanced/arrow、scalar depth 及既有箭头截断行为、反斜杠/反引号与跨行 union/intersection。未迁移 TypeScript AST，也未修改 schema/验证或生成协议；删除新严格检查发现的无用私有参数。19 项隔离夹具覆盖真实 config/parser/compiler/generate 和字节级输出，只抑制目的文件写入，没有重生成生产 API。
- **验证**：扩展后的完整根 TypeScript 与变更文件 ESLint 通过；最终 12 文件/86 项集成回归按 7101/7202/7303/7404/7505 五个种子独立乱序均通过。反引号识别、共享 alias、SSH 排除与 locale key 变异均被独立 oracle 捕获并恢复。只读复核的两个类型门禁问题已修复；扫描器与原实现的 140,000 次差分比较一致，配置与读取契约无行为问题。
- **环境边界**：本机全量 unit 在三个未改动 SSH suite 出现 16 项 Windows/POSIX/部署资源基线失败（2150 项通过），没有跳过、放宽或修补这些跨域用例；全量结果交由 CI 的既定 Ubuntu unit 环境验证。未运行插件构建或生产生成命令，没有改依赖或协议。
