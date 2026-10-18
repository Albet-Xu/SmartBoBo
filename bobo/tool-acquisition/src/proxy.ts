/**
 * Proxy state for one capture: whether the calling session turned proxy mode
 * on, and the pool configuration a capture asks for an address.
 *
 * Session state is folded from the `proxy/enabled` session events, last value
 * winning. The pool configuration is read from the `proxy-pool` profile entry
 * through the settings service's describe projection — the sibling
 * `bobo-proxy-tool` plugin's entry carries it as volatile Config fields, and
 * this plugin reads that entry's live section rather than instantiating the
 * pool itself — then narrows the fields `scripts/proxy_pool.py` consumes.
 * @module bobo-crawl-tool/proxy
 */

import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
import type SettingsForms from '@deepseek-ai/dsh-settings'
// Side-effect type import: `bobo-proxy-tool` declares (and appends)
// `proxy/enabled`; pulling its module in is what makes the fold below compare
// against that type name.
import type {} from 'bobo-proxy-tool'
import { runPython } from './python.ts'

/** Profile entry id carrying the proxy pool sources and strategy. */
export const PROXY_POOL_NAMESPACE = 'proxy-pool'

/** How the pool serves an address: a reused batch of validated IPs, or one fetched per request. */
export type ProxyFetchStrategy = 'cache' | 'realtime'

/** One proxy source, in the shape `scripts/proxy_pool.py` consumes. */
export interface ProxySource {
  /** Human-readable name, used in pool diagnostics only. */
  readonly name: string
  /** Endpoint the IPs are fetched from. */
  readonly apiUrl: string
  /** API key or username parameter. */
  readonly apiKey: string
  /** Password parameter; empty for key-only authentication. */
  readonly pwd: string
  /** IPs requested per fetch. */
  readonly getnum: number
  /** Proxy protocol, `http` or `socks5`. */
  readonly httptype: string
  /** Response-format parameter of the source API. */
  readonly geshi: string
  /** Separator parameter of the source API. */
  readonly fenge: string
  /** Whether this source may be used. */
  readonly enabled: boolean
}

/** The `proxy-pool` section fields one capture reads. */
export interface ProxyPool {
  /** Master switch of the pool. */
  readonly enabled: boolean
  /** Configured sources, enabled or not. */
  readonly sources: readonly ProxySource[]
  /** Address reuse strategy. */
  readonly fetchStrategy: ProxyFetchStrategy
  /** Per-request timeout the pool applies while validating a candidate, in milliseconds. */
  readonly timeoutMs: number
}

/** Proxy mode of one session, folded from that session's committed events. */
export class SessionProxyMode {
  private readonly enabled = new WeakMap<Session, boolean>()

  /**
   * @param ctx - context whose fiber owns the session-event subscription, so
   *   the fold stops with the plugin instance.
   */
  constructor(ctx: Context) {
    ctx.on('session/event', (session, event) => {
      if (event.type === 'proxy/enabled') this.enabled.set(session, event.data.enabled)
    })
  }

  /**
   * Whether proxy mode is on for `session` after its committed events. A
   * session whose `proxy/enabled` events were appended before this plugin
   * subscribed — a resumed session — reads as off until its next one.
   * @param session - the session to read.
   * @returns the last committed value; off when the session logged none.
   */
  of(session: Session): boolean {
    return this.enabled.get(session) ?? false
  }
}

/** Whether a value is a plain data object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow one source entry, or undefined when any field the pool script reads has the wrong JSON type. */
function narrowSource(value: unknown): ProxySource | undefined {
  if (!isRecord(value)) return undefined
  const { name, apiUrl, apiKey, pwd, getnum, httptype, geshi, fenge, enabled } = value
  if (typeof name !== 'string' || typeof apiUrl !== 'string' || typeof apiKey !== 'string'
    || typeof pwd !== 'string' || typeof getnum !== 'number' || typeof httptype !== 'string'
    || typeof geshi !== 'string' || typeof fenge !== 'string' || typeof enabled !== 'boolean') return undefined
  return { name, apiUrl, apiKey, pwd, getnum, httptype, geshi, fenge, enabled }
}

/**
 * Read the resolved `proxy-pool` section for one capture.
 *
 * The section is another plugin entry's volatile Config, so it arrives
 * through the settings service's describe projection: this finds the
 * descriptor whose ns is the `proxy-pool` entry id and narrows the fields the
 * pool script consumes, rather than forwarding a malformed candidate.
 *
 * @param settings - the settings service; absent in a deployment that composes none.
 * @returns the pool, or undefined while no `proxy-pool` entry serves a form.
 * @throws {Error} when the section is registered but does not carry this plugin's fields.
 */
export function proxyPoolOf(settings: SettingsForms | undefined): ProxyPool | undefined {
  const value = settings?.describe().find(descriptor => descriptor.ns === PROXY_POOL_NAMESPACE)?.value
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
  if (narrowed.some(source => source === undefined)) {
    throw new Error(`${label} carries a source entry the proxy pool cannot use`)
  }
  return {
    enabled: value['enabled'],
    timeoutMs: value['timeoutMs'],
    fetchStrategy: strategy,
    sources: narrowed.filter(source => source !== undefined),
  }
}

/**
 * Ask the deployment's proxy pool for one address usable for `targetUrl`.
 *
 * @param pythonBin - interpreter running the pool script.
 * @param scriptsDir - directory holding `proxy_pool.py`.
 * @param pool - the resolved pool section.
 * @param targetUrl - the page the address has to reach.
 * @param timeoutMs - budget for the pool script itself.
 * @param signal - caller cancellation.
 * @returns the proxy URL, with scheme, to inject into the browser service.
 * @throws {Error} when the pool reports that every candidate failed or that
 *   none is available; the message is the question the model relays to the user.
 */
export async function acquireProxy(
  pythonBin: string,
  scriptsDir: string,
  pool: ProxyPool,
  targetUrl: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  const run = await runPython(pythonBin, [
    join(scriptsDir, 'proxy_pool.py'),
    '--action', 'get',
    '--config-json', JSON.stringify({
      sources: pool.sources.filter(source => source.enabled),
      fetchStrategy: pool.fetchStrategy,
      timeoutMs: pool.timeoutMs,
    }),
    '--target-url', targetUrl,
  ], { timeoutMs, signal })
  let reply: unknown
  try {
    reply = JSON.parse(run.stdout)
  } catch {
    throw new Error(`代理池返回非 JSON 结果: ${run.stdout.slice(0, 200)}`)
  }
  if (!isRecord(reply)) throw new Error(`代理池返回非 JSON 对象: ${run.stdout.slice(0, 200)}`)
  if (reply['failed'] === true) {
    // The pool already exhausted its own retry rounds; asking the user here
    // avoids amplifying the failure with another crawl attempt.
    throw new Error('代理失效，是否走本地网络进行访问网页？')
  }
  const proxy = reply['proxy']
  if (typeof proxy !== 'string' || proxy === '') {
    throw new Error('代理池无可用代理，是否走本地网络进行访问网页？')
  }
  return proxy
}
