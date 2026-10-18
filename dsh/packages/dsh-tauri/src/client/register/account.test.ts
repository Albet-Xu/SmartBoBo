/**
 * register/account.test.ts — 桌面端官方登录「自动打开浏览器」的回归测试。
 *
 * 锁住的契约：桌面载体（`dshDesktop` 标记在场）下，账号流进入 `waiting-browser` 时经壳层
 * `open_external_url` 打开系统浏览器，同一地址只开一次；服务必须经 `ctx.inject` 的作用域读取
 * （用外层 ctx 读会抛 `cannot get property "remote.account" without inject`——真实故障）；
 * 浏览器直开（无标记）与非法地址都不得触发。
 */
import type { ClientContext } from '../types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountSignInFeature } from './account'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => undefined),
}))

vi.mock('../service/invoke', () => ({ invoke: mocks.invoke }))

const AUTHORIZE_A = 'https://platform.deepseek.com/dsh/authorize?state=a'
const AUTHORIZE_B = 'https://platform.deepseek.com/dsh/authorize?state=b'

interface AttemptView {
  status?: string
  attempt?: { phase?: string, authorizeUrl?: string } | null
}

/** 账号远程面：`watch()` 给原始值，`$stream()` 与官方一样把值包成 `{ value, accept }` 帧。 */
function makeRemote(views: AttemptView[], session?: { initializeDefaultModel?: () => Promise<unknown> }) {
  const account = {
    watch: () => (async function* () {
      for (const view of views)
        yield view
    })(),
  }
  return {
    account,
    ...session === undefined ? {} : { session },
    $stream: (options: { open: (signal: AbortSignal) => AsyncIterable<AttemptView> }) => ({
      async* [Symbol.asyncIterator]() {
        for await (const value of options.open(new AbortController().signal))
          yield { value, accept: () => {} }
      },
      dispose: async () => {},
    }),
  }
}

/**
 * 外层 ctx 的 `remote` 取用与 cordis 的守卫行为一致：直接抛错。
 * 实现只能读 `ctx.inject` 回调给出的作用域 ctx（本用例把它作为回调首参传入）。
 */
function ctxWithRemote(remote: () => unknown): ClientContext {
  const outer = {
    get remote(): never {
      throw new Error('cannot get property "remote.account" without inject')
    },
    inject: (_deps: string[], callback: (scoped: unknown) => void) => {
      callback({ remote: remote() })
      return () => {}
    },
  }
  return outer as unknown as ClientContext
}

beforeEach(() => {
  vi.stubGlobal('dshDesktop', null)
})

afterEach(() => {
  mocks.invoke.mockClear()
  mocks.invoke.mockImplementation(async () => undefined)
  vi.unstubAllGlobals()
})

describe('accountSignInFeature', () => {
  it('opens each authorize url once through the injected account scope', async () => {
    const ctx = ctxWithRemote(() => makeRemote([
      { attempt: { phase: 'initializing' } },
      { attempt: { phase: 'waiting-browser', authorizeUrl: AUTHORIZE_A } },
      { attempt: { phase: 'waiting-browser', authorizeUrl: AUTHORIZE_A } },
      { attempt: { phase: 'waiting-browser', authorizeUrl: AUTHORIZE_B } },
      { attempt: { phase: 'exchanging', authorizeUrl: AUTHORIZE_B } },
    ]))

    const dispose = accountSignInFeature.call(ctx)

    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2))
    expect(mocks.invoke.mock.calls.map(call => call[1])).toEqual([
      { url: AUTHORIZE_A },
      { url: AUTHORIZE_B },
    ])
    expect(mocks.invoke.mock.calls.every(call => call[0] === 'open_external_url')).toBe(true)
    dispose()
  })

  /** 壳层打开失败不能静默：错误进控制台，不吞掉。 */
  it('reports a failed shell open without throwing', async () => {
    mocks.invoke.mockRejectedValue(new Error('NODE_NOT_ANSWERED: timeout'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = ctxWithRemote(() => makeRemote([
      { attempt: { phase: 'waiting-browser', authorizeUrl: AUTHORIZE_A } },
    ]))

    const dispose = accountSignInFeature.call(ctx)

    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(warn.mock.calls[0]?.[0]).toContain('opening the account authorize url failed')
    warn.mockRestore()
    dispose()
  })

  it('ignores authorize urls the host could not open', async () => {
    const ctx = ctxWithRemote(() => makeRemote([
      { attempt: { phase: 'waiting-browser', authorizeUrl: 'javascript:alert(1)' } },
      { attempt: { phase: 'waiting-browser' } },
    ]))

    const dispose = accountSignInFeature.call(ctx)
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.invoke).not.toHaveBeenCalled()
    dispose()
  })

  /** 浏览器直开同一端口时没有桌面载体标记：不得替用户打开浏览器。 */
  it('stays inert without the desktop marker', async () => {
    vi.unstubAllGlobals()
    const ctx = ctxWithRemote(() => makeRemote([
      { attempt: { phase: 'waiting-browser', authorizeUrl: AUTHORIZE_A } },
    ]))

    const dispose = accountSignInFeature.call(ctx)
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.invoke).not.toHaveBeenCalled()
    dispose()
  })
})

/**
 * 登录成功 → 默认模型初始化：官方账号 UI 在 `credential-stored` + `succeeded` 的那一帧
 * 请求 `session/initializeDefaultModel`，把默认模型从需要 API Key 的 `deepseek-official`
 * 换到账号路由。桌面载体在客户端挂载前就完成签名时官方那侧不会触发，因此这里必须补上。
 */
describe('accountSignInFeature — post sign-in default model', () => {
  const signedIn: AttemptView = { status: 'credential-stored', attempt: { phase: 'succeeded' } }

  it('initializes the default model once on the sign-in edge', async () => {
    const initializeDefaultModel = vi.fn(async () => undefined)
    const ctx = ctxWithRemote(() => makeRemote([
      { status: 'signed-out' },
      { status: 'waiting', attempt: { phase: 'waiting-browser', authorizeUrl: AUTHORIZE_A } },
      signedIn,
      signedIn,
    ], { initializeDefaultModel }))

    const dispose = accountSignInFeature.call(ctx)

    await vi.waitFor(() => expect(initializeDefaultModel).toHaveBeenCalledTimes(1))
    dispose()
  })

  it('re-arms after the account leaves the succeeded state', async () => {
    const initializeDefaultModel = vi.fn(async () => undefined)
    const ctx = ctxWithRemote(() => makeRemote([
      signedIn,
      { status: 'signed-out' },
      signedIn,
    ], { initializeDefaultModel }))

    const dispose = accountSignInFeature.call(ctx)

    await vi.waitFor(() => expect(initializeDefaultModel).toHaveBeenCalledTimes(2))
    dispose()
  })

  it('survives a core whose session remote has no initializeDefaultModel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = ctxWithRemote(() => makeRemote([signedIn], {}))

    const dispose = accountSignInFeature.call(ctx)
    await Promise.resolve()
    await Promise.resolve()

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    dispose()
  })

  /** 初始化失败只告警：登录本身已经成功，不得让账号流崩掉。 */
  it('reports a failed initialization without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = ctxWithRemote(() => makeRemote([signedIn], {
      initializeDefaultModel: async () => {
        throw new Error('session/provider-models-unavailable')
      },
    }))

    const dispose = accountSignInFeature.call(ctx)

    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(warn.mock.calls[0]?.[0]).toContain('initializing the account default model failed')
    warn.mockRestore()
    dispose()
  })
})
