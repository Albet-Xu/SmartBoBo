import { spawn } from 'node:child_process'
import { join } from 'node:path'

export const PROXY_POOL_NAMESPACE = 'proxy-pool'

export class SessionProxyMode {
  constructor(ctx) {
    this.enabled = new WeakMap()
    ctx.on('session/event', (session, event) => {
      if (event.type === 'proxy/enabled') this.enabled.set(session, event.data.enabled)
    })
  }

  of(session) {
    return this.enabled.get(session) ?? false
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function narrowSource(value) {
  if (!isRecord(value)) return undefined
  const { name, apiUrl, apiKey, pwd, getnum, httptype, geshi, fenge, enabled } = value
  if (typeof name !== 'string' || typeof apiUrl !== 'string' || typeof apiKey !== 'string'
    || typeof pwd !== 'string' || typeof getnum !== 'number' || typeof httptype !== 'string'
    || typeof geshi !== 'string' || typeof fenge !== 'string' || typeof enabled !== 'boolean') return undefined
  return { name, apiUrl, apiKey, pwd, getnum, httptype, geshi, fenge, enabled }
}

export function proxyPoolOf(settings) {
  const value = settings?.describe().find((descriptor) => descriptor.ns === PROXY_POOL_NAMESPACE)?.value
  if (value === undefined) return undefined
  const label = `settings section "${PROXY_POOL_NAMESPACE}"`
  if (!isRecord(value)) throw new Error(`${label} is not an object of keys`)
  if (typeof value['enabled'] !== 'boolean') throw new Error(`${label} must carry a boolean "enabled"`)
  if (typeof value['timeoutMs'] !== 'number') throw new Error(`${label} must carry a numeric "timeoutMs"`)
  const strategy = value['fetchStrategy']
  if (strategy !== 'cache' && strategy !== 'realtime') {
    throw new Error(`${label} must carry "fetchStrategy" "cache" or "realtime"`)
  }
  const rawSources = value['sources']
  if (!Array.isArray(rawSources)) throw new Error(`${label} must carry a "sources" array`)
  const narrowed = rawSources.map(narrowSource)
  if (narrowed.some((source) => source === undefined)) {
    throw new Error(`${label} carries a source entry the proxy pool cannot use`)
  }
  return {
    enabled: value['enabled'],
    timeoutMs: value['timeoutMs'],
    fetchStrategy: strategy,
    sources: narrowed.filter((source) => source !== undefined),
  }
}

function runPython(pythonBin, argv, { timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`代理池脚本超时（${timeoutMs}ms）`))
    }, timeoutMs)
    const onAbort = () => {
      clearTimeout(timer)
      child.kill()
      reject(new Error('代理获取被取消'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (err) => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      if (code !== 0 && !stdout) reject(new Error(`代理池脚本退出码 ${code}: ${stderr.slice(0, 300)}`))
      else resolve({ stdout, stderr, code })
    })
  })
}

export async function acquireProxy(pythonBin, scriptsDir, pool, targetUrl, timeoutMs, signal) {
  const run = await runPython(pythonBin, [
    join(scriptsDir, 'proxy_pool.py'),
    '--action', 'get',
    '--config-json', JSON.stringify({
      sources: pool.sources.filter((source) => source.enabled),
      fetchStrategy: pool.fetchStrategy,
      timeoutMs: pool.timeoutMs,
    }),
    '--target-url', targetUrl,
  ], { timeoutMs, signal })
  let reply
  try {
    reply = JSON.parse(run.stdout)
  } catch {
    throw new Error(`代理池返回非 JSON 结果: ${run.stdout.slice(0, 200)}`)
  }
  if (!isRecord(reply)) throw new Error(`代理池返回非 JSON 对象: ${run.stdout.slice(0, 200)}`)
  if (reply['failed'] === true) {
    throw new Error('代理失效，是否走本地网络进行访问网页？')
  }
  const proxy = reply['proxy']
  if (typeof proxy !== 'string' || proxy === '') {
    throw new Error('代理池无可用代理，是否走本地网络进行访问网页？')
  }
  return proxy
}
