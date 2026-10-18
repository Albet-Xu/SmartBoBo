import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbxRuntime } from './service.js'
import { apply as applyBridge } from './llm-bridge.mjs'

export const name = 'dsh-dbx'

export const inject = ['webServer']

const pluginDir = path.dirname(fileURLToPath(import.meta.url))

export function apply(ctx, config = {}) {
  const runtimeDir = config.runtimeDir
    ? path.resolve(config.runtimeDir)
    : path.resolve(pluginDir, '../../dbx-runtime')
  const merged = {
    port: 4230,
    readyTimeoutMs: 60000,
    bridgePrefix: '/bobo-llm',
    bridgePublicUrl: 'http://127.0.0.1:7075/bobo-llm',
    seed: true,
    ...config,
    runtimeDir,
    dataDir: config.dataDir ? path.resolve(config.dataDir) : path.join(runtimeDir, 'data'),
    staticDir: config.staticDir ? path.resolve(config.staticDir) : path.join(runtimeDir, 'dist'),
  }

  const seedOnce = () => runSeed(merged)
  if (merged.seed !== false) seedOnce()

  const runtime = dbxRuntime(merged)
  runtime.ensureReady()
    .then(() => {
      if (merged.seed !== false) return seedOnce()
    })
    .catch((error) => {
      console.warn(`[dsh-dbx] dbx-web 未就绪：${error.message}`)
    })

  applyBridge(ctx, merged)
  ctx.effect(() => () => runtime.dispose(), 'dsh-dbx: dbx-web')
  console.log(`[dsh-dbx] dbx-web 端点 ${runtime.endpoint}，数据 ${runtime.dataDir}，AI 桥 ${merged.bridgePrefix}`)
}

function runSeed(merged) {
  return new Promise((resolve) => {
    const projectRoot = path.resolve(pluginDir, '../..')
    const pythonBin = process.platform === 'win32'
      ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, '.venv', 'bin', 'python')
    const seedScript = path.resolve(pluginDir, '../scripts/dbx_ai_seed.py')
    let child
    try {
      child = spawn(pythonBin, [
        seedScript,
        '--dbx-db', path.join(merged.dataDir, 'dbx.db'),
        '--endpoint', merged.bridgePublicUrl,
      ], {
        env: { ...process.env, DBX_DATA_DIR: merged.dataDir },
        stdio: ['ignore', 'inherit', 'inherit'],
        windowsHide: true,
      })
    } catch (error) {
      console.warn(`[dsh-dbx] AI 配置预置启动失败: ${error.message}`)
      resolve()
      return
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
    }, 20000)
    child.on('error', (error) => {
      clearTimeout(timer)
      console.warn(`[dsh-dbx] AI 配置预置启动失败: ${error.message}`)
      resolve()
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) console.warn(`[dsh-dbx] AI 配置预置退出码 ${code}（不阻塞启动）`)
      resolve()
    })
  })
}
