/**
 * register/sidebar.test.ts — 侧边栏桥（宿主 ↔ iframe）的回归测试。
 *
 * 锁住的契约（`src/layout/components/webview.tsx` 是发送方）：
 * `dsh://sidebar:toggle` → `ctx.layout.toggleSidebar()`；布局状态
 * `data-sidebar-collapsed` → `dsh://sidebar:collapsed` 回报；布局服务抛错上报
 * `dsh://plugin-error` 且不影响后续命令。仓库未装 jsdom，DOM 用 vi.stubGlobal 提供。
 */
import type { ClientContext, ParentMessage } from '../types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sidebarFeature } from './sidebar'

// 协议字面量按宿主侧 `src/layout/components/webview.tsx` 逐字写死，锁住线协议。
const CMD_TOGGLE = 'dsh://sidebar:toggle'
const EVENT_SIDEBAR_COLLAPSED = 'dsh://sidebar:collapsed'
const ERROR_TYPE = 'dsh://plugin-error'
const SIDEBAR_COLLAPSED_ATTRIBUTE = 'data-sidebar-collapsed'
const MOBILE_SIDEBAR_ATTRIBUTE = 'data-dsh-mobile-sidebar'

/** 假 MutationObserver：记录回调，供测试手动触发 DOM 变化。 */
class FakeMutationObserver {
  static latest: FakeMutationObserver | undefined

  disconnects = 0

  constructor(readonly callback: MutationCallback) {
    FakeMutationObserver.latest = this
  }

  observe(): void {}

  disconnect(): void {
    this.disconnects++
  }

  takeRecords(): MutationRecord[] {
    return []
  }
}

interface Host {
  sent: ParentMessage[]
  dispatch: (data: unknown) => void
  listenerCount: () => number
}

/** 父窗口桥假实现：postMessage 收集回报，dispatch 模拟宿主 → iframe 命令。 */
function stubHost(): Host {
  const sent: ParentMessage[] = []
  const listeners = new Set<(event: MessageEvent) => void>()
  const parent = { postMessage: (message: ParentMessage) => sent.push(message) }
  vi.stubGlobal('window', {
    parent,
    addEventListener: (_type: string, handler: (event: MessageEvent) => void) => listeners.add(handler),
    removeEventListener: (_type: string, handler: (event: MessageEvent) => void) => listeners.delete(handler),
  })
  return {
    sent,
    dispatch: (data) => {
      for (const handler of [...listeners])
        handler({ source: parent, data } as unknown as MessageEvent)
    },
    listenerCount: () => listeners.size,
  }
}

/** 假 document：`[data-shell-overlay]` 的父节点即 AppFrame。 */
function stubDocument(collapsed: boolean): { setCollapsed: (value: boolean) => void, setMobileOwned: (value: boolean) => void } {
  let state = collapsed
  let mobileOwned = false
  const frame = { hasAttribute: (name: string) => name === SIDEBAR_COLLAPSED_ATTRIBUTE && state }
  const documentElement = {
    hasAttribute: (name: string) => name === MOBILE_SIDEBAR_ATTRIBUTE && mobileOwned,
  }
  vi.stubGlobal('document', {
    body: {},
    documentElement,
    querySelector: () => ({ parentElement: frame }),
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  return {
    setCollapsed(value: boolean) {
      state = value
    },
    setMobileOwned(value: boolean) {
      mobileOwned = value
    },
  }
}

/** 最小 ctx：只用 layout 服务，其余按需补。 */
function fakeCtx(): { ctx: ClientContext, toggleSidebar: ReturnType<typeof vi.fn> } {
  const toggleSidebar = vi.fn()
  return { ctx: { layout: { toggleSidebar } } as unknown as ClientContext, toggleSidebar }
}

function collapsedReports(host: Host): boolean[] {
  return host.sent
    .filter(message => message.type === EVENT_SIDEBAR_COLLAPSED)
    .map(message => message.collapsed as boolean)
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeMutationObserver.latest = undefined
})

describe('sidebarFeature', () => {
  it('挂载即回报折叠状态，并把 toggle 命令交给布局服务', () => {
    const host = stubHost()
    stubDocument(true)
    vi.stubGlobal('MutationObserver', FakeMutationObserver)
    const { ctx, toggleSidebar } = fakeCtx()

    const dispose = sidebarFeature.call(ctx)

    // 首次回报：应用早于插件挂载时不会产生属性变化事件。
    expect(collapsedReports(host)).toEqual([true])

    host.dispatch({ type: 'dsh://other' })
    expect(toggleSidebar).not.toHaveBeenCalled()

    host.dispatch({ type: CMD_TOGGLE })
    expect(toggleSidebar).toHaveBeenCalledTimes(1)
    // 正常路径不产生错误上报。
    expect(host.sent.filter(message => message.type === ERROR_TYPE)).toEqual([])

    dispose()
  })

  it('布局服务抛错时上报插件错误，且不影响后续命令', () => {
    const host = stubHost()
    stubDocument(false)
    vi.stubGlobal('MutationObserver', FakeMutationObserver)
    const { ctx, toggleSidebar } = fakeCtx()
    toggleSidebar.mockImplementationOnce(() => {
      throw new Error('layout unavailable')
    })

    const dispose = sidebarFeature.call(ctx)
    host.dispatch({ type: CMD_TOGGLE })

    const errors = host.sent.filter(message => message.type === ERROR_TYPE)
    expect(errors).toHaveLength(1)
    expect(errors[0].id).toBe('dsh-tauri')
    expect(errors[0].error).toContain('layout unavailable')

    // 抛错不摘监听：后续命令照常执行。
    host.dispatch({ type: CMD_TOGGLE })
    expect(toggleSidebar).toHaveBeenCalledTimes(2)

    dispose()
  })

  it('折叠属性变化会回报一次，dispose 后停止', () => {
    const host = stubHost()
    const frame = stubDocument(false)
    vi.stubGlobal('MutationObserver', FakeMutationObserver)
    const { ctx } = fakeCtx()

    const dispose = sidebarFeature.call(ctx)
    expect(collapsedReports(host)).toEqual([false])

    frame.setCollapsed(true)
    FakeMutationObserver.latest?.callback([], FakeMutationObserver.latest as unknown as MutationObserver)
    expect(collapsedReports(host)).toEqual([false, true])

    dispose()
    expect(host.listenerCount()).toBe(0)
    expect(FakeMutationObserver.latest?.disconnects).toBe(1)

    frame.setCollapsed(false)
    host.dispatch({ type: CMD_TOGGLE })
    expect(collapsedReports(host)).toEqual([false, true])
  })

  it('defers bridge ownership to the mobile drawer and resumes after handoff', () => {
    const host = stubHost()
    const frame = stubDocument(false)
    vi.stubGlobal('MutationObserver', FakeMutationObserver)
    const { ctx, toggleSidebar } = fakeCtx()

    const dispose = sidebarFeature.call(ctx)
    frame.setMobileOwned(true)
    host.dispatch({ type: CMD_TOGGLE })
    FakeMutationObserver.latest?.callback([], FakeMutationObserver.latest as unknown as MutationObserver)
    expect(toggleSidebar).not.toHaveBeenCalled()
    expect(collapsedReports(host)).toEqual([false])

    frame.setMobileOwned(false)
    FakeMutationObserver.latest?.callback([], FakeMutationObserver.latest as unknown as MutationObserver)
    expect(collapsedReports(host)).toEqual([false, false])
    host.dispatch({ type: CMD_TOGGLE })
    expect(toggleSidebar).toHaveBeenCalledTimes(1)

    dispose()
  })
})
