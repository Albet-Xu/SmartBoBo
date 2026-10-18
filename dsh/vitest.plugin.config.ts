import { defineProject } from 'vitest/config'

/**
 * `plugin` project：插件 L2 E2E（真实 `dsh web` 进程 + 真实 Chromium 页面）。
 *
 * 用例集中在 `test/e2e/plugins/`，与桌面端 L3 的 `test/e2e/desktop/` 平级；
 * 共享编排（`support/dsh.ts`）与 `setup-plugin.ts` 留在 `test/e2e/` 根下。
 *
 * 驱动架构：`environment: 'node'` + **驱动库 API**。真实浏览器直接由用例
 * `import { chromium } from 'playwright'` 后 `chromium.launch()` 拉起，
 * 复用 globalSetup 起的宿主与已换取的 Cookie；不采用 Vitest browser mode，
 * 也不引入 Playwright Test Runner（见 `docs/specs/plugin.test.md` §3.2）。
 *
 * `fileParallelism: false`：整个 project 共享一个真实 dsh 服务实例（由 globalSetup 起），
 * 串行执行让断言有意义，也避免多个 spec 同时打同一个服务。
 */
export default defineProject({
  test: {
    name: 'plugin',
    include: ['test/e2e/plugins/**/*.e2e.ts'],
    globalSetup: ['./test/e2e/setup-plugin.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
