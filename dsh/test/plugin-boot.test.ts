import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

type PageState = 'empty' | 'splash' | 'chat' | 'normal' | 'mounting'

/** 脚本注册的窗口事件监听器（`addEventListener` 只用到 pagehide / pageshow）。 */
type WindowListener = (event?: { persisted?: boolean }) => void

interface BootHarnessOptions {
  /** 模拟顶层文档（非 iframe）：脚本必须整体不工作 */
  topFrame?: boolean
  /** 模拟 dsh 应用内部嵌套的 iframe（本脚本不作为宿主那一层参与握手） */
  nestedFrame?: boolean
}

interface BootHarness {
  /** 宿主（顶层文档）真实收到的消息 */
  messages: string[]
  /** 嵌套场景下发给中间那一层 dsh 文档的消息（宿主收不到） */
  nestedMessages: string[]
  setState: (state: PageState) => void
  /** 触发 pagehide（帧内导航离开当前文档） */
  leaveDocument: () => void
  /** 触发 pageshow；`persisted` 为真即从 bfcache 恢复 */
  showDocument: (persisted: boolean) => void
}

const script = readFileSync(
  new URL('../src-tauri/src/desktop/plugin_boot.js.inc', import.meta.url),
  'utf8',
)

/** 帧身份申报（子 frame 解析出 `#root` 后必然先于其它消息到达一次）。 */
const FRAME_REPORT = 'dsh://plugin-boot:frame'

/** 文档离开申报（帧内导航前上报，宿主据此作废旧确认）。 */
const FRAME_LEAVING = 'dsh://plugin-boot:leaving'

function createHarness(initialState: PageState, options: BootHarnessOptions = {}): BootHarness {
  let state = initialState
  let mutationCallback = () => {}
  const messages: string[] = []
  const nestedMessages: string[] = []
  const windowListeners = new Map<string, WindowListener[]>()

  function textNodes() {
    if (state === 'splash') {
      return [{ textContent: 'HARNESS' }, { textContent: 'Loading plugins…' }]
    }
    if (state === 'chat') {
      return [
        { textContent: 'HARNESS' },
        { textContent: 'Loading plugins…' },
        { textContent: 'A chat message mentioning Loading plugins…' },
      ]
    }
    return []
  }

  const boot = {
    parentElement: null as typeof root | null,
    get textContent() {
      return state === 'splash' ? 'HARNESS Loading plugins…' : ''
    },
    querySelectorAll(selector: string) {
      return selector === 'div, span, p' ? textNodes() : []
    },
  }

  const root = {
    get childElementCount() {
      return state === 'empty' ? 0 : 1
    },
    get textContent() {
      if (state === 'splash')
        return 'HARNESS Loading plugins…'
      if (state === 'chat')
        return 'HARNESS Loading plugins… A chat message mentioning Loading plugins…'
      if (state === 'normal')
        return 'Harness application'
      return ''
    },
    querySelector(selector: string) {
      if (selector === '[data-dsh-boot]' && state === 'splash')
        return boot
      if (state === 'normal' && selector.includes('main'))
        return { textContent: 'Harness application' }
      return null
    },
  }
  boot.parentElement = root

  class FakeMutationObserver {
    constructor(callback: () => void) {
      mutationCallback = callback
    }

    observe() {}

    disconnect() {}
  }

  // 宿主直接内嵌的那一层 frame：window.parent 就是顶层文档（window.top）。
  const top = {
    postMessage(message: { type: string }) {
      messages.push(message.type)
    },
  }
  // dsh 应用内部嵌套的 iframe：消息只会到中间那一层，宿主收不到。
  const nestedParent = {
    postMessage(message: { type: string }) {
      nestedMessages.push(message.type)
    },
  }
  const window: {
    top: unknown
    parent: { postMessage: (message: { type: string }) => void }
    addEventListener: (type: string, listener: WindowListener) => void
    removeEventListener: (type: string, listener: WindowListener) => void
  } = {
    top,
    parent: options.nestedFrame ? nestedParent : top,
    addEventListener(type: string, listener: WindowListener) {
      const listeners = windowListeners.get(type) ?? []
      listeners.push(listener)
      windowListeners.set(type, listeners)
    },
    removeEventListener(type: string, listener: WindowListener) {
      const listeners = windowListeners.get(type)
      const index = listeners?.indexOf(listener) ?? -1
      if (index >= 0)
        listeners!.splice(index, 1)
    },
  }
  if (options.topFrame)
    window.top = window
  runInNewContext(script, {
    window,
    document: {
      documentElement: {},
      getElementById: () => (state === 'mounting' ? null : root),
    },
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  })

  function fireWindowEvent(type: string, event?: { persisted?: boolean }) {
    for (const listener of [...(windowListeners.get(type) ?? [])])
      listener(event)
  }

  return {
    messages,
    nestedMessages,
    setState(nextState) {
      state = nextState
      mutationCallback()
    },
    leaveDocument() {
      fireWindowEvent('pagehide')
    },
    showDocument(persisted) {
      fireWindowEvent('pageshow', { persisted })
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('plugin boot bridge', () => {
  it('starts the stall deadline when the splash appears late', () => {
    vi.useFakeTimers()
    const harness = createHarness('empty')

    vi.advanceTimersByTime(20_000)
    expect(harness.messages).toEqual([FRAME_REPORT])

    harness.setState('splash')
    vi.advanceTimersByTime(7_999)
    expect(harness.messages).toEqual([FRAME_REPORT])
    vi.advanceTimersByTime(1)
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:stalled'])
  })

  it('resets the deadline when the splash disappears and rearms on reappearance', () => {
    vi.useFakeTimers()
    const harness = createHarness('splash')

    vi.advanceTimersByTime(4_000)
    harness.setState('empty')
    vi.advanceTimersByTime(10_000)
    expect(harness.messages).toEqual([FRAME_REPORT])

    harness.setState('splash')
    vi.advanceTimersByTime(8_000)
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:stalled'])
  })

  it('ignores matching page text and permanently disarms after the app shell mounts', () => {
    vi.useFakeTimers()
    const chat = createHarness('chat')
    vi.advanceTimersByTime(20_000)
    expect(chat.messages).toEqual([FRAME_REPORT])

    const harness = createHarness('splash')
    vi.advanceTimersByTime(2_000)
    harness.setState('normal')
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:ready'])

    harness.setState('splash')
    vi.advanceTimersByTime(20_000)
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:ready'])
  })

  it('reports one frame identity once the document exposes the dsh mount point', () => {
    vi.useFakeTimers()
    const harness = createHarness('mounting')

    vi.advanceTimersByTime(3_000)
    expect(harness.messages).toEqual([])

    harness.setState('splash')
    expect(harness.messages).toEqual([FRAME_REPORT])

    // 身份只申报一次；卡在 splash 时后续消息仍是原有的 stalled
    vi.advanceTimersByTime(8_000)
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:stalled'])
  })

  // issue #705：浏览器内部错误页（代理拦截、DNS 失败等）同样会触发 iframe 的 load，
  // 但永远没有 #root。脚本在这里保持沉默，宿主才能把「没收到帧身份」判成加载失败。
  it('never reports a frame identity while the frame has no dsh mount point', () => {
    vi.useFakeTimers()
    const harness = createHarness('mounting')

    vi.advanceTimersByTime(60_000)
    expect(harness.messages).toEqual([])
  })

  it('stays silent in the top-level document', () => {
    vi.useFakeTimers()
    const harness = createHarness('normal', { topFrame: true })

    vi.advanceTimersByTime(60_000)
    harness.leaveDocument()
    expect(harness.messages).toEqual([])
  })

  // dsh 应用内部还会嵌套 iframe（插件面板等），它们既不是宿主那一层，也不代表宿主
  // 换过文档；参与握手会让宿主的确认被无关帧的导航搅乱。
  it('stays silent inside a frame nested in the dsh application', () => {
    vi.useFakeTimers()
    const harness = createHarness('splash', { nestedFrame: true })

    vi.advanceTimersByTime(20_000)
    harness.leaveDocument()
    // splash 卡死确实会通知——但发给的是中间那一层 dsh 文档，宿主永远收不到握手消息
    expect(harness.nestedMessages).toEqual(['dsh://plugin-boot:stalled'])
    expect(harness.messages).toEqual([])
  })

  // issue #705 的另一半：帧内导航（整帧跳到远端登录/错误页）不换 iframe 元素，
  // 自报过的文档必须在离开时主动作废宿主的确认，否则宿主会一直以为页面还在。
  it('reports the document leaving after a frame-internal navigation', () => {
    vi.useFakeTimers()
    const harness = createHarness('splash')

    vi.advanceTimersByTime(2_000)
    harness.setState('normal')
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:ready'])

    harness.leaveDocument()
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:ready', FRAME_LEAVING])

    // 离开只申报一次：再次触发不重复打扰宿主
    harness.leaveDocument()
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:ready', FRAME_LEAVING])
  })

  it('never reports a document leaving when the frame never carried a dsh page', () => {
    vi.useFakeTimers()
    const harness = createHarness('mounting')

    vi.advanceTimersByTime(10_000)
    harness.leaveDocument()
    expect(harness.messages).toEqual([])
  })

  // 从 bfcache 恢复的文档不会重新执行脚本，宿主在 leaving 里作废的确认必须补报回来，
  // 否则恢复回来的正常页面会在宽限窗后被判成「帧里没有 dsh 页面」而弹错误界面。
  it('re-reports the frame identity when the document is restored from the back-forward cache', () => {
    vi.useFakeTimers()
    const harness = createHarness('splash')

    vi.advanceTimersByTime(2_000)
    harness.setState('normal')
    harness.leaveDocument()
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:ready', FRAME_LEAVING])

    harness.showDocument(true)
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:ready', FRAME_LEAVING, FRAME_REPORT])

    // 恢复后文档仍可按正常路径再次离开
    harness.leaveDocument()
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:ready', FRAME_LEAVING, FRAME_REPORT, FRAME_LEAVING])
  })

  it('reports nothing on an ordinary pageshow', () => {
    vi.useFakeTimers()
    const harness = createHarness('splash')

    vi.advanceTimersByTime(2_000)
    harness.setState('normal')
    harness.showDocument(false)
    expect(harness.messages).toEqual([FRAME_REPORT, 'dsh://plugin-boot:ready'])
  })
})
