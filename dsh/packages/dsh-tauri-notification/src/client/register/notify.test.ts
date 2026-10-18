import type { PendingInteractionFace, SessionListStateFace, SessionStatusFace, SessionSummaryFace } from '../types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyFeature } from './notify'

interface SnapshotSource<T> {
  getSnapshot: () => T
  subscribe: (listener: () => void) => () => void
  publish: (next: T) => void
}

function snapshotSource<T>(initial: T): SnapshotSource<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish: (next: T) => {
      state = next
      for (const listener of [...listeners])
        listener()
    },
  }
}

const mocks = vi.hoisted(() => ({
  showNativeNotification: vi.fn(),
  turnEndedByUser: vi.fn(async () => false),
  adapter: undefined as unknown,
  settings: { turnComplete: 'background', approval: true, question: true, sound: 'default', customSound: null },
}))

vi.mock('dsh-tauri/client', () => ({
  defineLocale: (namespace: string, dictionaries: { en: Record<string, string> }) => ({
    NS: namespace,
    text: (key: string) => dictionaries.en[key] ?? key,
  }),
  // 真 `defineRegister` 在 effect 运行时创建控制器与适配器；这里用最小的时长控制器顶替，
  // 好让用例直接发布状态、再用假定时器跨过合并窗口。
  defineRegister: (setup: unknown) => function registerEffect(this: unknown) {
    const disposers: Array<() => void> = []
    const controller = {
      add: (disposer: () => void) => {
        disposers.push(disposer)
      },
      timeout: (callback: () => void, ms: number) => {
        const id = setTimeout(callback, ms)
        return () => clearTimeout(id)
      },
      isDisposed: () => false,
      dispose: () => {
        for (const disposer of [...disposers])
          disposer()
        disposers.length = 0
      },
    }
    ;(setup as (controller: unknown, ctx: unknown, adapter: unknown) => void)(controller, this, mocks.adapter)
    return () => controller.dispose()
  },
}))

vi.mock('../store', () => ({ notificationSettings: { $state: mocks.settings } }))
vi.mock('../service/native', () => ({ showNativeNotification: mocks.showNativeNotification }))
vi.mock('../service/turn-end', () => ({ turnEndedByUser: mocks.turnEndedByUser }))
vi.mock('../service/sound', () => ({ createSoundPlayer: () => ({ play: vi.fn(), dispose: vi.fn() }) }))
vi.mock('../service/sound-assets', () => ({ requestBuiltinSounds: vi.fn() }))

function summary(id: string, overrides: Partial<SessionSummaryFace> = {}): SessionSummaryFace {
  return { id, displayTitle: id, running: false, ...overrides }
}

function status(running: boolean, pendingInteraction?: PendingInteractionFace): SessionStatusFace {
  return { running, pendingInteraction, completionUnread: false }
}

const APPROVAL_PENDING: PendingInteractionFace = {
  key: 'call-1',
  kind: 'approval',
  sessionId: 's1',
  toolName: 'Bash',
  reason: 'run the tests',
  answerable: true,
  answer: async () => {},
}

interface Harness {
  list: SnapshotSource<SessionListStateFace>
  sessionStatus: SnapshotSource<ReadonlyMap<string, SessionStatusFace>>
}

/** 注册通知运行时，并返回可发布快照的两个数据源。 */
function startNotify(initialList: SessionListStateFace, initialStatuses: ReadonlyMap<string, SessionStatusFace>): Harness {
  const list = snapshotSource(initialList)
  const sessionStatus = snapshotSource(initialStatuses)
  mocks.adapter = {
    sessionList: () => ({ current: undefined }),
    openSession: () => ({ status: 'opened' }),
  }
  notifyFeature.call({
    get: (name: string) => {
      if (name === 'sessions')
        return { list }
      if (name === 'uiSession')
        return { sessionStatus }
      return undefined
    },
  })
  return { list, sessionStatus }
}

describe('notification notify runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('子代理会话跑完不发轮次完成通知', async () => {
    const { list, sessionStatus } = startNotify(
      { ids: ['sub'], byId: { sub: summary('sub', { origin: 'subagent', running: true }) } },
      new Map([['sub', status(true)]]),
    )
    list.publish({ ids: ['sub'], byId: { sub: summary('sub', { origin: 'subagent', running: false }) } })
    sessionStatus.publish(new Map([['sub', status(false)]]))
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.turnEndedByUser).not.toHaveBeenCalled()
    expect(mocks.showNativeNotification).not.toHaveBeenCalled()
  })

  it('普通会话跑完发一条轮次完成通知', async () => {
    const { list, sessionStatus } = startNotify(
      { ids: ['main'], byId: { main: summary('main', { running: true }) } },
      new Map([['main', status(true)]]),
    )
    list.publish({ ids: ['main'], byId: { main: summary('main', { running: false }) } })
    sessionStatus.publish(new Map([['main', status(false)]]))
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.showNativeNotification).toHaveBeenCalledTimes(1)
    expect(mocks.showNativeNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'main',
      body: 'Turn completed',
      tag: 'dsh-notification-main-1',
      silent: true,
    }))
  })

  it('子代理会话出现待处理交互不发通知', async () => {
    const { list, sessionStatus } = startNotify(
      { ids: ['sub'], byId: { sub: summary('sub', { origin: 'subagent', running: true }) } },
      new Map([['sub', status(true)]]),
    )
    const pending = { ...APPROVAL_PENDING, sessionId: 'sub' }
    list.publish({ ids: ['sub'], byId: { sub: summary('sub', { origin: 'subagent', running: true }) } })
    sessionStatus.publish(new Map([['sub', status(true, pending)]]))
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.showNativeNotification).not.toHaveBeenCalled()
  })

  it('普通会话出现待处理交互发一条授权通知', async () => {
    const { list, sessionStatus } = startNotify(
      { ids: ['main'], byId: { main: summary('main', { running: true }) } },
      new Map([['main', status(true)]]),
    )
    const pending = { ...APPROVAL_PENDING, sessionId: 'main' }
    list.publish({ ids: ['main'], byId: { main: summary('main', { running: true }) } })
    sessionStatus.publish(new Map([['main', status(true, pending)]]))
    await vi.advanceTimersByTimeAsync(1000)

    expect(mocks.showNativeNotification).toHaveBeenCalledTimes(1)
    expect(mocks.showNativeNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'main',
      body: 'Approval required · Bash: run the tests',
    }))
  })
})
