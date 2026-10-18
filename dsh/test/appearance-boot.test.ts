import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

/**
 * 真实执行 `src-tauri/src/desktop/appearance.js.inc`（document-start 注入的启动期外观
 * 接收器），在受控的帧内上下文里验证三件事：
 *
 * 1. 跨源回发：宿主是 `tauri://localhost` / `http://tauri.localhost`，帧内是
 *    `http://127.0.0.1:<port>`，回发一律 `'*'`——用帧内 `location.origin` 会让请求静默
 *    丢失（表现为 boot 页永远收不到 CSS、宿主一直等不到 ack）。
 * 2. 只写独立 head `<style>`：boot 节点由官方 React 树持有（BootHandoff 只交接
 *    className/innerHTML，额外 inline style 会触发 hydration 不匹配），脚本不得碰它。
 * 3. 同一份 CSS 只 ack 一次；离开的文档由 pagehide 撤销，新文档自己重新请求。
 */
const SOURCE = readFileSync(new URL('../src-tauri/src/desktop/appearance.js.inc', import.meta.url), 'utf8')

interface FakeNode {
  id: string
  textContent: string
  children: FakeNode[]
  removed: boolean
  appendChild: (child: FakeNode) => void
  remove: () => void
}

function fakeNode(): FakeNode {
  return {
    id: '',
    textContent: '',
    children: [],
    removed: false,
    appendChild(child: FakeNode) {
      this.children.push(child)
    },
    remove() {
      this.removed = true
    },
  }
}

interface HarnessOptions {
  /** parent === top：壳层自己的顶层文档，脚本必须立刻退出。 */
  nestedFrame?: boolean
}

function harness(options: HarnessOptions = {}) {
  const states: Array<Record<string, unknown>> = []
  const created: FakeNode[] = []
  const listeners = new Map<string, (event: unknown) => void>()
  const head = fakeNode()
  const documentElement = fakeNode()

  const document = {
    get head() {
      return head
    },
    get documentElement() {
      return documentElement
    },
    getElementById(id: string) {
      return created.find(node => node.id === id && !node.removed) ?? null
    },
    createElement() {
      const node = fakeNode()
      created.push(node)
      return node
    },
  }

  const parentWindow = {
    postMessage: vi.fn((message: Record<string, unknown>, targetOrigin?: string) => {
      states.push({ ...message, targetOrigin })
    }),
  }

  // 帧内脚本同时引用裸 `parent`、裸 `window` 与 `window.parent`，三者必须是同一个对象。
  // 直达宿主的帧里 `parent === top`（真实浏览器同样如此：宿主就是顶层窗口）；顶层壳层
  // 文档与嵌套帧的 parent/top 关系不同，脚本据此退出。
  const context: Record<string, unknown> = {
    document,
    location: { origin: 'http://127.0.0.1:3081' },
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners.set(type, handler)
    },
    parent: parentWindow,
  }
  context.top = parentWindow
  context.window = context
  context.self = context
  if (options.nestedFrame) {
    context.parent = { __dshPage: true }
    context.top = parentWindow
  }

  runInContext(SOURCE, createContext(context), { filename: 'appearance.js.inc' })

  function bootStyle() {
    return created.find(node => node.id === 'dsh-tauri:boot-appearance' && !node.removed) ?? null
  }
  function deliver(data: unknown, source: unknown = parentWindow, origin = 'tauri://localhost') {
    const handler = listeners.get('message')
    if (!handler)
      throw new Error('message listener was not registered')
    handler({ source, origin, data })
  }
  function fire(type: string) {
    const handler = listeners.get(type)
    if (!handler)
      throw new Error(`${type} listener was not registered`)
    handler({})
  }
  return { states, created, context, parentWindow, bootStyle, deliver, fire, listenerCount: () => listeners.size }
}

describe('appearance boot bootstrap (in-frame receiver)', () => {
  it('asks the host once for the boot projection through the cross-origin-safe wildcard target', () => {
    const frame = harness()
    expect(frame.states).toEqual([{ source: 'dsh-desktop', type: 'dsh://appearance:request', targetOrigin: '*' }])
  })

  it('stays out of frames that are not the host’s own embedded layer', () => {
    // 直达宿主的帧就是 `parent === top` 的那一层（VM 里两端都指向宿主代理对象），
    // 它必须开口说话；dsh 应用内部再嵌套的 frame（parent 是 dsh 页面、top 是宿主）
    // 必须完全静默，否则会把宿主外观消息当成自己该处理的东西。
    const embedded = harness()
    expect(embedded.states).toHaveLength(1)
    embedded.deliver({ source: 'dsh-desktop', type: 'dsh://appearance', bootCss: 'x' })
    expect(embedded.bootStyle()?.textContent).toBe('x')

    const nested = harness({ nestedFrame: true })
    expect(nested.states).toHaveLength(0)
    expect(nested.context.__dsh_appearance_bootstrap__).toBe(true)
    // 完全静默：连消息/生命周期监听器都不注册，宿主外观消息不会被它处理。
    expect(nested.listenerCount()).toBe(0)
    expect(nested.bootStyle()).toBeNull()
    expect(nested.parentWindow.postMessage).not.toHaveBeenCalled()
  })

  it('is idempotent when the host injects the script twice', () => {
    const frame = harness()
    expect(() => runInContext(SOURCE, createContext(frame.context), { filename: 'appearance.js.inc' })).not.toThrow()
    expect(frame.states).toHaveLength(1)
  })

  it('applies the delivered CSS to an isolated head style and acknowledges exactly once', () => {
    const frame = harness()
    const css = 'html,body{background:transparent!important}'
    frame.deliver({ source: 'dsh-desktop', type: 'dsh://appearance', bootCss: css })
    expect(frame.bootStyle()?.textContent).toBe(css)
    expect(frame.bootStyle()?.id).toBe('dsh-tauri:boot-appearance')
    expect(frame.parentWindow.postMessage).toHaveBeenLastCalledWith({ source: 'dsh-desktop', type: 'dsh://appearance:applied' }, '*')
    const calls = frame.parentWindow.postMessage.mock.calls.length
    frame.deliver({ source: 'dsh-desktop', type: 'dsh://appearance', bootCss: css })
    expect(frame.parentWindow.postMessage.mock.calls.length).toBe(calls)
  })

  it('clears the frame stylesheet when the host projects an empty boot CSS', () => {
    const frame = harness()
    frame.deliver({ source: 'dsh-desktop', type: 'dsh://appearance', bootCss: 'x{color:red}' })
    frame.deliver({ source: 'dsh-desktop', type: 'dsh://appearance', bootCss: '' })
    expect(frame.bootStyle()?.textContent).toBe('')
  })

  it.each([
    ['a non-parent window', { source: 'dsh-desktop', type: 'dsh://appearance', bootCss: 'x' }, { __sibling: true }],
    ['a message without the host marker', { type: 'dsh://appearance', bootCss: 'x' }, undefined],
    ['an unrelated bridge message', { source: 'dsh-desktop', type: 'dsh://sidebar:toggle' }, undefined],
    ['a non-object payload', 'dsh://appearance', undefined],
  ])('ignores %s', (_label, data, source) => {
    const frame = harness()
    frame.deliver(data, source ?? frame.parentWindow)
    expect(frame.bootStyle()).toBeNull()
    expect(frame.parentWindow.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dsh://appearance:applied' }), expect.anything())
  })

  it('drops the frame stylesheet on pagehide so a navigated document starts clean', () => {
    const frame = harness()
    frame.deliver({ source: 'dsh-desktop', type: 'dsh://appearance', bootCss: 'x{color:red}' })
    expect(frame.bootStyle()?.textContent).toBe('x{color:red}')
    const before = frame.states.length
    frame.fire('pagehide')
    expect(frame.bootStyle()).toBeNull()
    // pagehide 只负责撤销：不再重试，新文档自己会重新请求（bfcache 还原走 pageshow）。
    expect(frame.states.length).toBe(before)
    // 新文档的握手必须被重新接受：旧文档的确认不替它背书。
    frame.deliver({ source: 'dsh-desktop', type: 'dsh://appearance', bootCss: 'y{color:blue}' })
    expect(frame.bootStyle()?.textContent).toBe('y{color:blue}')
    expect(frame.created.filter(node => node.id === 'dsh-tauri:boot-appearance')).toHaveLength(2)
  })

  it('re-handshakes after a bfcache restore so a re-mounted boot page is styled again', () => {
    const frame = harness()
    frame.deliver({ source: 'dsh-desktop', type: 'dsh://appearance', bootCss: 'x' })
    const before = frame.states.length
    frame.fire('pageshow')
    expect(frame.states.length).toBeGreaterThan(before)
    expect(frame.states.at(-1)).toEqual({ source: 'dsh-desktop', type: 'dsh://appearance:request', targetOrigin: '*' })
  })

  it('never touches the boot node itself (hydration safety)', () => {
    expect(SOURCE).not.toContain('data-dsh-boot')
    expect(SOURCE).not.toContain('style.background')
    expect(SOURCE).not.toContain('window.location.origin')
    expect(SOURCE).not.toContain('location.reload')
  })
})
