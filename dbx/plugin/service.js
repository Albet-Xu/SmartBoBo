import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRuntimeDir = path.resolve(pluginDir, '../../dbx-runtime')

export function dbxRuntime(config = {}) {
  const runtimeDir = config.runtimeDir ? path.resolve(config.runtimeDir) : defaultRuntimeDir
  const port = Number(config.port) > 0 ? Number(config.port) : 4230
  const dataDir = config.dataDir ? path.resolve(config.dataDir) : path.join(runtimeDir, 'data')
  const staticDir = config.staticDir ? path.resolve(config.staticDir) : path.join(runtimeDir, 'dist')
  const readyTimeoutMs = Number(config.readyTimeoutMs) > 0 ? Number(config.readyTimeoutMs) : 60000
  const exePath = path.join(runtimeDir, 'dbx-web.exe')
  const logPath = path.join(runtimeDir, 'dbx-web.log')
  const endpoint = `http://127.0.0.1:${port}`

  let child = null
  let spawnedByUs = false
  let readyPromise = null

  function logTail(maxBytes = 4096) {
    try {
      const size = statSync(logPath).size
      const start = Math.max(0, size - maxBytes)
      const fd = openSync(logPath, 'r')
      try {
        const buf = Buffer.alloc(size - start)
        const { bytesRead } = readSync(fd, buf, 0, buf.length, start)
        return buf.subarray(0, bytesRead).toString('utf8')
      } finally {
        closeSync(fd)
      }
    } catch {
      return ''
    }
  }

  async function probe() {
    try {
      await fetch(`${endpoint}/`, { signal: AbortSignal.timeout(2000) })
      return true
    } catch {
      return false
    }
  }

  function killTree(pid) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try { process.kill(pid, 'SIGKILL') } catch {}
      }
    }
  }

  function startChild() {
    if (!existsSync(exePath)) {
      throw new Error(`dbx-web 可执行文件缺失：${exePath}（请确认 dbx-runtime 目录完整）`)
    }
    const logFd = openSync(logPath, 'a')
    let proc
    try {
      proc = spawn(exePath, [], {
        cwd: runtimeDir,
        windowsHide: true,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: {
          ...process.env,
          DBX_STATIC_DIR: staticDir,
          DBX_DATA_DIR: dataDir,
          DBX_PORT: String(port),
          DBX_DISABLE_PASSWORD: '1',
        },
      })
    } finally {
      closeSync(logFd)
    }
    proc.on('error', () => {})
    proc.on('exit', (code, signal) => {
      if (child === proc) child = null
      if (code !== 0 && signal !== 'SIGKILL') spawnedByUs = false
    })
    child = proc
    spawnedByUs = true
  }

  async function ensureReady() {
    if (await probe()) return { attached: true, started: false }
    if (readyPromise) {
      await readyPromise
      return { attached: false, started: true }
    }
    readyPromise = (async () => {
      const deadline = Date.now() + readyTimeoutMs
      if (!child) startChild()
      while (Date.now() < deadline) {
        if (await probe()) return
        if (child && child.exitCode !== null) {
          throw new Error(`dbx-web 已退出（code ${child.exitCode}）。日志尾部：\n${logTail()}`)
        }
        await sleep(400)
      }
      throw new Error(`dbx-web 在 ${readyTimeoutMs}ms 内未就绪。日志尾部：\n${logTail()}`)
    })()
    try {
      await readyPromise
      return { attached: false, started: true }
    } finally {
      readyPromise = null
    }
  }

  async function dispose() {
    if (child && spawnedByUs && child.exitCode === null) {
      const proc = child
      const exited = new Promise((resolve) => proc.once('exit', resolve))
      killTree(proc.pid)
      await Promise.race([exited, sleep(5000)])
      if (child === proc) child = null
    }
    spawnedByUs = false
  }

  return { ensureReady, probe, dispose, endpoint, port, runtimeDir, dataDir, staticDir, logPath }
}
