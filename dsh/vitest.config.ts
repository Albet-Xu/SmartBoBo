import { defineConfig } from 'vitest/config'
import { SHARED_ALIAS } from './tooling.config'

export default defineConfig({
  // 与 vite.config.ts 保持一致：src 内部统一用 `@/` 别名。
  resolve: {
    alias: SHARED_ALIAS,
  },
  test: {
    projects: [
      './vitest.unit.config.ts',
      './vitest.plugin.config.ts',
      './vitest.desktop.config.ts',
    ],
    // 覆盖率只作可见性报告：不设 `thresholds`、不作为 CI 门禁。vendored 源码（`source/`、
    // `archive/`、`test/archive/`）与 Rust 侧（`src-tauri/`）不是本仓被测面，必须显式排除，
    // 否则报告数字没有意义。`coverage` 只能在根配置生效——project 级的同名字段会被忽略。
    coverage: {
      provider: 'v8',
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
        'source/**',
        'archive/**',
        'test/archive/**',
        'src-tauri/**',
      ],
    },
  },
})
