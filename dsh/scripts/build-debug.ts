/**
 * 产出桌面端 L3 E2E 的运行前置：根 `dist/` + 内嵌前端的 debug 二进制。
 *
 * 与 `.github/workflows/ci.yml` 的 `desktop-e2e` 作业同口径：
 * `build:plugins` → `vite build` → `tauri build --debug --no-bundle`
 * （临时 config 清空 `beforeBuildCommand`，避免重复触发 `pnpm build`）。
 *
 * 用法：`pnpm build:debug [--skip-plugins]`
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const SKIP_PLUGINS = process.argv.includes('--skip-plugins')

function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

function run(label: string, args: readonly string[]): void {
  // Windows 上 `pnpm` 是 `pnpm.cmd`，不走 shell 会 ENOENT；走 shell 时把参数拼成单条
  // 命令串（`spawnSync` 的 args 数组 + shell 会触发 DEP0190）。
  const command = `pnpm ${args.map(quote).join(' ')}`
  console.log(`\n[build:debug] ${label}：${command}`)
  const result = spawnSync(command, { cwd: REPO_ROOT, stdio: 'inherit', shell: true })
  if (result.error !== undefined)
    throw new Error(`${label} 无法启动：${result.error.message}`)
  if (result.status !== 0)
    throw new Error(`${label} 失败（exit ${result.status}）`)
}

if (SKIP_PLUGINS) {
  console.log('[build:debug] 跳过 build:plugins（--skip-plugins）')
}
else {
  run('构建插件产物', ['build:plugins'])
}

run('构建前端产物', ['exec', 'vite', 'build'])

const configDir = mkdtempSync(join(tmpdir(), 'dsh-tauri-e2e-'))
const configPath = join(configDir, 'tauri-e2e.json')
writeFileSync(configPath, '{"build":{"beforeBuildCommand":""}}', 'utf8')

try {
  run('构建 debug 二进制', ['tauri', 'build', '--debug', '--no-bundle', '--config', configPath])
}
finally {
  rmSync(configDir, { recursive: true, force: true })
}

console.log('\n[build:debug] 完成：dist/ 与 src-tauri/target/debug/deepseek-harness-desktop.exe 已就绪')
