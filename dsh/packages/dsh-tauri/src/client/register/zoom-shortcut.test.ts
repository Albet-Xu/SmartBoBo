/**
 * register/zoom-shortcut.test.ts — iframe 内缩放快捷键的回归测试。
 *
 * 锁住的契约（`src/layout/components/iframe.tsx` 的 `dsh://zoom-shortcut` 分支是接收方）：
 * 命中快捷键 → `preventDefault` + 上报动作；未命中不打扰页面。
 */
import type { ParentMessage } from '../types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zoomShortcutFeature } from './zoom-shortcut'

// 协议字面量按宿主侧 `src/layout/components/iframe.tsx` 的 `dsh://zoom-shortcut` 分支写死。
const TYPE_ZOOM_SHORTCUT = 'dsh://zoom-shortcut'

interface Dom {
  sent: ParentMessage[]
  keydown: (event: Record<string, unknown>) => void
  listenerCount: () => number
  captured: () => boolean
}

/** 假 document：keydown 监听表 + 捕获标记；父窗口收 postMessage。 */
function stubDom(): Dom {
  const sent: ParentMessage[] = []
  const listeners = new Set<(event: unknown) => void>()
  let captured = false
  const parent = { postMessage: (message: ParentMessage) => sent.push(message) }
  vi.stubGlobal('window', { parent, addEventListener: () => {}, removeEventListener: () => {} })
  vi.stubGlobal('document', {
    addEventListener: (_type: string, handler: (event: unknown) => void, options?: AddEventListenerOptions) => {
      captured = options?.capture === true
      listeners.add(handler)
    },
    removeEventListener: (_type: string, handler: (event: unknown) => void) => listeners.delete(handler),
  })
  return {
    sent,
    keydown: (event) => {
      for (const handler of [...listeners])
        handler(event)
    },
    listenerCount: () => listeners.size,
    captured: () => captured,
  }
}

/** 构造命中/未命中的快捷键事件（含 preventDefault 记录）。 */
function keyEvent(key: string, modifiers: { ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean } = {}) {
  const preventDefault = vi.fn()
  return { preventDefault, event: { key, ctrlKey: false, metaKey: false, altKey: false, preventDefault, ...modifiers } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('zoomShortcutFeature', () => {
  it('命中 Ctrl+/-/0 时上报动作并 preventDefault，捕获阶段监听', () => {
    const dom = stubDom()
    const dispose = zoomShortcutFeature()
    expect(dom.captured()).toBe(true)

    const increase = keyEvent('+', { ctrlKey: true })
    const reset = keyEvent('0', { metaKey: true })
    dom.keydown(increase.event)
    dom.keydown(reset.event)

    expect(dom.sent).toEqual([
      { type: TYPE_ZOOM_SHORTCUT, action: 'increase' },
      { type: TYPE_ZOOM_SHORTCUT, action: 'reset' },
    ])
    expect(increase.preventDefault).toHaveBeenCalledTimes(1)
    expect(reset.preventDefault).toHaveBeenCalledTimes(1)

    dispose()
  })

  it('无关按键不上报也不拦截；dispose 后注销监听', () => {
    const dom = stubDom()
    const dispose = zoomShortcutFeature()

    const plain = keyEvent('a')
    const zoomWithoutModifier = keyEvent('+')
    dom.keydown(plain.event)
    dom.keydown(zoomWithoutModifier.event)
    expect(dom.sent).toEqual([])
    expect(plain.preventDefault).not.toHaveBeenCalled()

    dispose()
    expect(dom.listenerCount()).toBe(0)
    dom.keydown(keyEvent('+', { ctrlKey: true }).event)
    expect(dom.sent).toEqual([])
  })
})
