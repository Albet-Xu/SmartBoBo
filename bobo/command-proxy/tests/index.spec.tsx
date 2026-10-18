// `/proxy` decides from the deployment's pool before it touches the session
// log, so these cases drive the registered handler against a stub composition
// and assert what it appends to the log and what it sends the model — the two
// channels a user actually reads.
//
// Named `.spec.tsx`, not `.spec.ts`: our packages are deliberately absent from
// the upstream tsconfig solutions, and each solution globs one of the two names
// into a project that cannot see this package's src (TS6307). vitest collects
// `*.spec.tsx` either way.
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { PROXY_POOL_NAMESPACE, apply, poolServesAddress, type Config } from '../src/index.ts'

/** Only the command is contributed: the settings presentation and the projection are host-layer singletons. */
const config: Config = {
  sources: [],
  fetchStrategy: 'cache',
  enabled: false,
  maxRetries: 3,
  timeoutMs: 30000,
  namespace: false,
  projection: false,
  command: true,
}

/** The refusal sentence both channels carry. */
const REFUSAL = '代理池没有可用代理，退出代理模式。'

/** One pool source, holding the two fields the refusal reads. */
function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { enabled: true, apiUrl: 'https://proxy.example/dmgetip.asp', ...overrides }
}

/** What one handler invocation appended and said. */
interface Run {
  /** Every `proxy/enabled` value the handler appended, in order. */
  readonly appended: readonly boolean[]
  /** The text of every message the handler handed the model. */
  readonly sent: readonly string[]
  /** The handler's own result, which the command card renders. */
  readonly result: CommandResult
}

/**
 * Invoke `/proxy` once against a stub composition.
 * @param rawInput - the text following the command name.
 * @param options - the folded session state, the pool value, and whether a settings service exists.
 * @returns the events appended, the messages sent, and the result.
 */
async function runProxy(rawInput: string, options: {
  proxyMode: boolean
  pool?: unknown
  settings?: boolean
}): Promise<Run> {
  const definitions: CommandDefinition[] = []
  const appended: boolean[] = []
  const sent: string[] = []
  const pool = options.pool
  const ctx = {
    commands: { register: (definition: CommandDefinition) => { definitions.push(definition) } },
    sessionProjections: {
      register: () => {},
      stateOf: () => ({ enabled: options.proxyMode }),
    },
    get: (service: string) => service === 'settings' && options.settings !== false
      // The pool rides the describe projection of the `proxy-pool` entry, so a
      // preset instance (whose own Config carries only defaults) reads the
      // host entry's live section exactly like the settings page does.
      ? { describe: () => [{ ns: PROXY_POOL_NAMESPACE, value: pool }] }
      : undefined,
  } as unknown as Context
  apply(ctx, config)

  const definition = definitions[0]
  if (definition === undefined) throw new Error('command-proxy registered no /proxy command')
  const invocation = {
    agent: {
      session: { append: (_type: string, data: { enabled: boolean }) => { appended.push(data.enabled) } },
      followup: (message: { content: readonly { text?: string }[] }) => {
        sent.push(message.content.map(block => block.text ?? '').join(''))
      },
    },
    rawInput,
  } as unknown as CommandInvocation
  return { appended, sent, result: await definition.handler(invocation) }
}

describe('poolServesAddress', () => {
  it('serves when the pool is on behind an enabled source with an API URL', () => {
    expect(poolServesAddress({ enabled: true, sources: [source()] })).toBe(true)
    // A source that names no `enabled` reads as enabled, as the pool script reads it.
    expect(poolServesAddress({ enabled: true, sources: [{ apiUrl: 'https://proxy.example/x' }] })).toBe(true)
  })

  it('serves nothing without a pool value, a pool switch, or a sources list', () => {
    expect(poolServesAddress(undefined)).toBe(false)
    expect(poolServesAddress(null)).toBe(false)
    expect(poolServesAddress('proxy-pool')).toBe(false)
    expect(poolServesAddress({ enabled: false, sources: [source()] })).toBe(false)
    expect(poolServesAddress({ enabled: true })).toBe(false)
    expect(poolServesAddress({ enabled: true, sources: [] })).toBe(false)
  })

  it('serves nothing from a source the pool script would skip whole', () => {
    expect(poolServesAddress({
      enabled: true,
      sources: [null, 'source', source({ enabled: false }), source({ apiUrl: '' })],
    })).toBe(false)
    expect(poolServesAddress({ enabled: true, sources: [source({ enabled: false }), source()] })).toBe(true)
  })
})

describe('the /proxy command', () => {
  it('turns proxy mode on when the pool can serve', async () => {
    const run = await runProxy('on', { proxyMode: false, pool: { enabled: true, sources: [source()] } })

    expect(run.appended).toEqual([true])
    expect(run.result).toMatchObject({ kind: 'success' })
    expect(run.sent).toHaveLength(1)
  })

  it('hands a serving pool the remainder to crawl through', async () => {
    const run = await runProxy('on\n采集，https://example.com', {
      proxyMode: false,
      pool: { enabled: true, sources: [source()] },
    })

    expect(run.appended).toEqual([true])
    expect(run.sent).toEqual(['采集，https://example.com'])
  })

  it('refuses a pool with nothing to serve, and leaves the session off', async () => {
    const run = await runProxy('on', { proxyMode: false, pool: { enabled: true, sources: [] } })

    expect(run.appended).toEqual([])
    expect(run.result).toEqual({ kind: 'success', text: REFUSAL })
    expect(run.sent).toEqual([
      '代理池没有可用代理，代理模式未开启；请向用户做一句简短说明（例如“代理池没有可用代理，退出代理模式。”）。',
    ])
  })

  it('exits proxy mode when the session already had it on', async () => {
    const run = await runProxy('on', { proxyMode: true, pool: undefined })

    expect(run.appended).toEqual([false])
    expect(run.result).toEqual({ kind: 'success', text: REFUSAL })
  })

  it('refuses a bare /proxy the same way, because it means on', async () => {
    const run = await runProxy('', { proxyMode: false, pool: { enabled: false, sources: [source()] } })

    expect(run.appended).toEqual([])
    expect(run.result).toEqual({ kind: 'success', text: REFUSAL })
  })

  it('drops a remainder rather than collecting through a pool that cannot serve', async () => {
    const run = await runProxy('on\n采集，https://example.com', { proxyMode: false, settings: false })

    expect(run.appended).toEqual([])
    expect(run.sent).toHaveLength(1)
    expect(run.sent).not.toContain('采集，https://example.com')
  })

  it('still turns proxy mode off when the pool can serve nothing', async () => {
    const run = await runProxy('off', { proxyMode: true, pool: { enabled: false, sources: [] } })

    expect(run.appended).toEqual([false])
    expect(run.result).toMatchObject({ text: '代理模式已关闭，采集请求将走本地网络。' })
  })
})
