import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface FrameLogEntry {
  source: string
  type: string
  level: string
  message: string
}

interface FrameLogHarnessOptions {
  /** 模拟壳层顶层文档：脚本必须整体不工作 */
  topFrame?: boolean
  /** 帧文档路径（脚本用它标注报错来源） */
  pathname?: string
  /** 注入次数（模拟重复注入） */
  injections?: number
}

interface FrameLogHarness {
  /** 宿主（window.parent）真实收到的帧内日志条目 */
  posts: FrameLogEntry[]
  /** 注入前的 console 原始方法被调用次数 */
  calls: { warn: number, error: number }
  /** 帧内 console（注入后即被本脚本劫持的那一份） */
  console: { warn: (...args: unknown[]) => void, error: (...args: unknown[]) => void }
  /** 宿主那一层 window（window.parent），用于构造「来自上层」的消息 */
  parent: unknown
  fireWindowEvent: (type: string, event: unknown) => void
  fireMessage: (data: unknown, source: unknown) => void
}

const script = readFileSync(
  new URL('../src-tauri/src/desktop/frame_log.js.inc', import.meta.url),
  'utf8',
)

function createHarness(options: FrameLogHarnessOptions = {}): FrameLogHarness {
  const posts: FrameLogEntry[] = []
  const calls = { warn: 0, error: 0 }
  const listeners = new Map<string, Array<(event: unknown) => void>>()

  const consoleObject: FrameLogHarness['console'] = {
    warn() {
      calls.warn += 1
    },
    error() {
      calls.error += 1
    },
  }

  const parent = {
    postMessage(message: FrameLogEntry) {
      posts.push(message)
    },
  }

  const windowObject: Record<string, unknown> = {
    parent,
    top: {},
    console: consoleObject,
    location: { pathname: options.pathname ?? '/' },
    addEventListener(type: string, listener: (event: unknown) => void) {
      const current = listeners.get(type) ?? []
      current.push(listener)
      listeners.set(type, current)
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      const current = listeners.get(type) ?? []
      const index = current.indexOf(listener)
      if (index >= 0)
        current.splice(index, 1)
    },
  }
  if (options.topFrame)
    windowObject.top = windowObject

  for (let index = 0; index < (options.injections ?? 1); index += 1)
    runInNewContext(script, { window: windowObject, Date })

  function emit(type: string, event: unknown) {
    for (const listener of [...(listeners.get(type) ?? [])])
      listener(event)
  }

  return {
    posts,
    calls,
    console: consoleObject,
    parent,
    fireWindowEvent: emit,
    fireMessage(data, source) {
      emit('message', { data, source })
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('frame log bridge', () => {
  it('forwards console.error from a frame with the error level and frame path', () => {
    const harness = createHarness({ pathname: '/chat' })

    harness.console.error('boom', 42)

    expect(harness.posts).toEqual([
      {
        source: 'dsh-frame-log-bridge',
        type: 'dsh://frame-log',
        level: 'error',
        message: '/chat boom 42',
      },
    ])
  })

  it('forwards console.warn from a frame with the warn level', () => {
    const harness = createHarness()

    harness.console.warn('careful')

    expect(harness.posts).toEqual([
      {
        source: 'dsh-frame-log-bridge',
        type: 'dsh://frame-log',
        level: 'warn',
        message: 'careful',
      },
    ])
  })

  it('keeps the frame console output after hijacking', () => {
    const harness = createHarness()

    harness.console.error('boom')
    harness.console.warn('careful')

    expect(harness.calls).toEqual({ warn: 1, error: 1 })
  })

  it('stays silent in the top-level document', () => {
    const harness = createHarness({ topFrame: true })

    harness.console.error('boom')
    harness.fireWindowEvent('error', { filename: 'http://127.0.0.1:3080/main.js', error: new Error('boom') })

    expect(harness.posts).toEqual([])
  })

  it('reports an uncaught error with its source location', () => {
    const harness = createHarness({ pathname: '/settings' })

    harness.fireWindowEvent('error', {
      message: 'Uncaught TypeError: x is not a function',
      filename: 'http://127.0.0.1:3080/assets/index.js',
      lineno: 12,
      colno: 3,
      error: new TypeError('x is not a function'),
    })

    expect(harness.posts).toEqual([
      {
        source: 'dsh-frame-log-bridge',
        type: 'dsh://frame-log',
        level: 'error',
        message: expect.stringContaining(
          '/settings [uncaught] http://127.0.0.1:3080/assets/index.js:12:3 TypeError: x is not a function',
        ),
      },
    ])
  })

  it('reports an unhandled promise rejection with its reason', () => {
    const harness = createHarness()

    harness.fireWindowEvent('unhandledrejection', { reason: new Error('nope') })

    expect(harness.posts).toHaveLength(1)
    expect(harness.posts[0].level).toBe('error')
    expect(harness.posts[0].message.startsWith('[unhandledrejection] Error: nope')).toBe(true)
  })

  it('serializes an Error argument with its stack', () => {
    const harness = createHarness()

    harness.console.error(new Error('kaboom'))

    expect(harness.posts[0].message).toContain('Error: kaboom')
    expect(harness.posts[0].message).toContain('frame-log.test.ts')
  })

  it('relays a nested frame entry up to the host window', () => {
    const harness = createHarness()
    const entry: FrameLogEntry = {
      source: 'dsh-frame-log-bridge',
      type: 'dsh://frame-log',
      level: 'error',
      message: '/panel boom',
    }

    harness.fireMessage(entry, {})

    expect(harness.posts).toEqual([entry])
  })

  it('does not relay an entry that already came from the host window', () => {
    const harness = createHarness()

    harness.fireMessage(
      { source: 'dsh-frame-log-bridge', type: 'dsh://frame-log', level: 'error', message: 'echo' },
      harness.parent,
    )

    expect(harness.posts).toEqual([])
  })

  it('limits relayed nested entries with the same budget', () => {
    vi.useFakeTimers()
    const harness = createHarness()

    for (let index = 0; index < 25; index += 1) {
      harness.fireMessage(
        { source: 'dsh-frame-log-bridge', type: 'dsh://frame-log', level: 'error', message: `nested ${index}` },
        {},
      )
    }

    expect(harness.posts).toHaveLength(20)
    expect(harness.posts[0].message).toBe('nested 0')
  })

  it('drops a relayed payload that carries no message text', () => {
    const harness = createHarness()

    harness.fireMessage({ source: 'dsh-frame-log-bridge', type: 'dsh://frame-log', level: 'error' }, {})

    expect(harness.posts).toEqual([])
  })

  it('limits a console.error storm and reports the suppressed count', () => {
    vi.useFakeTimers()
    const harness = createHarness()

    for (let index = 0; index < 30; index += 1)
      harness.console.error(`storm ${index}`)
    expect(harness.posts).toHaveLength(20)

    vi.advanceTimersByTime(1_000)
    harness.console.error('after storm')

    expect(harness.posts).toHaveLength(22)
    expect(harness.posts[20].message).toBe('10 frame log entries suppressed')
    expect(harness.posts[21].message).toBe('after storm')
  })

  it('truncates an oversized frame log entry and marks it', () => {
    const harness = createHarness()

    harness.console.error('x'.repeat(5_000))

    expect(harness.posts[0].message.length).toBeLessThanOrEqual(2_012)
    expect(harness.posts[0].message.endsWith('…[truncated]')).toBe(true)
  })

  it('taps the frame console only once when the script is injected twice', () => {
    const harness = createHarness({ injections: 2 })

    harness.console.error('once')

    expect(harness.posts).toHaveLength(1)
    expect(harness.calls.error).toBe(1)
  })
})

/**
 * 宿主侧协议契约：注入脚本与 `iframe.tsx` 是两个独立产物，字面量与匹配方式必须锁在一起，
 * 否则「帧内日志」会静默消失（运行日志里重新只剩壳层前台日志）。
 */
describe('frame log host contract', () => {
  const iframe = readFileSync(
    new URL('../src/layout/components/iframe.tsx', import.meta.url),
    'utf8',
  )

  it('dispatches the bridge type the injected script publishes', () => {
    expect(iframe).toContain(`case 'dsh://frame-log'`)
  })

  it('writes frame entries to the frontdesk log under the iframe target', () => {
    expect(iframe).toContain(`invoke('log_frontend', { level, target: 'iframe'`)
  })

  it('downgrades every frame level except error to warn', () => {
    expect(iframe).toContain(`data.level === 'error' ? 'error' : 'warn'`)
  })
})
