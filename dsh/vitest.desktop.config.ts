import { defineProject } from 'vitest/config'

/**
 * `desktop` project：L3 桌面端 E2E（真实 Tauri 窗口）。
 *
 * 用例驱动真实 Debug 二进制：`@wdio/tauri-service` 的 embedded provider 自己拉起应用
 * （应用内嵌 W3C WebDriver server），vitest 负责组织用例与断言，不引入 WDIO runner。
 *
 * 驱动架构：`environment: 'node'` + **驱动库 API**（standalone WebdriverIO session）。
 * 不采用 Vitest browser mode——该模式的 provider 会把 webview 导航到 Vitest 自己的
 * Vite origin，导致被测应用文档被卸载（见子设计 01 §2 决策 1）。
 *
 * `fileParallelism: false`：应用固定占用 debug 端口 3081，且一次只应有一个实例；
 * 串行执行让「端口空闲 / 无残留实例」的前置校验始终成立。
 */
export default defineProject({
  test: {
    name: 'desktop',
    include: ['test/e2e/desktop/*.e2e.ts'],
    globalSetup: ['./test/e2e/setup-desktop.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
