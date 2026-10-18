/**
 * register/new-session.test.ts — 侧边栏「新建会话」默认落到「未分组」的回归测试。
 *
 * 锁住的契约：命中官方按钮时必须在**捕获阶段**吞掉这次点击（`preventDefault` +
 * `stopImmediatePropagation`，否则 React 根容器上的官方 `startSession()` 照常执行），
 * 并改走未分组新建；未命中的按钮（工作区分组行的「+」）一个副作用都不产生。
 */
import type { ClientContext } from 'dsh-tauri/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sidebarNewSessionFeature, ungroupedNewSessionFeature } from './new-session'

const mocks = vi.hoisted(() => ({
  startUngroupedSession: vi.fn(),
  controller: undefined as unknown,
  composerWorkspaceLess: true,
}))

vi.mock('../service/ungrouped-session', () => ({ startUngroupedSession: mocks.startUngroupedSession }))

vi.mock('dsh-tauri/client', () => {
  const createLifecycleController = () => {
    const disposers: Array<() => void> = []
    let clickHandler: ((event: unknown) => void) | undefined
    let clickOptions: unknown
    return {
      add: (disposer: () => void) => {
        disposers.push(disposer)
      },
      listen: (_type: string, handler: (event: unknown) => void, options?: unknown) => {
        clickHandler = handler
        clickOptions = options
        return () => {}
      },
      observe: () => ({ disconnect: () => {} }),
      isDisposed: () => false,
      dispose: () => {
        clickHandler = undefined
        for (const disposer of [...disposers])
          disposer()
        disposers.length = 0
      },
      click: (event: unknown) => clickHandler?.(event),
      clickOptions: () => clickOptions,
    }
  }
  return {
    defineRegister: (ctxOrSetup: unknown, maybeSetup?: unknown) => {
      const setup = (typeof maybeSetup === 'function' ? maybeSetup : ctxOrSetup) as
        (controller: unknown, ctx: unknown, adapter: unknown) => void
      return function registerEffect(this: unknown) {
        const controller = createLifecycleController()
        mocks.controller = controller
        setup(controller, this, { has: () => mocks.composerWorkspaceLess })
        return () => controller.dispose()
      }
    },
  }
})

interface ControllerStub {
  click: (event: unknown) => void
  clickOptions: () => unknown
  dispose: () => void
}

class FakeElement {
  closest: (selector: string) => FakeElement | null = () => null

  getAttribute(_name: string): string | null {
    return null
  }
}

class FakeButton extends FakeElement {
  constructor(private readonly label: string | null) {
    super()
  }

  getAttribute(name: string): string | null {
    return name === 'aria-label' ? this.label : null
  }
}

/** 官方按钮本体（自己就是最近的 `button[aria-label]`）。 */
function buttonTarget(label: string | null): FakeElement {
  const button = new FakeButton(label)
  button.closest = selector => selector === 'button[aria-label]' ? button : null
  return button
}

/** 按钮内部节点：最近的 `button[aria-label]` 是外层官方按钮。 */
function childTarget(button: FakeButton): FakeElement {
  const child = new FakeElement()
  child.closest = selector => selector === 'button[aria-label]' ? button : null
  return child
}

function clickEvent(target: unknown) {
  return {
    target,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  }
}

const ctx = {} as ClientContext

beforeEach(() => {
  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('document', {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  mocks.composerWorkspaceLess = true
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('sidebarNewSessionFeature', () => {
  it('rechecks composer capability on each click after a previous fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.composerWorkspaceLess = false
    const dispose = sidebarNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub
    controller.click(clickEvent(buttonTarget('新建会话')))
    mocks.composerWorkspaceLess = true
    const event = clickEvent(buttonTarget('新建会话'))
    controller.click(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(mocks.startUngroupedSession).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('keeps warning suppression local to each registration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.composerWorkspaceLess = false
    const first = sidebarNewSessionFeature.call(ctx)
    const firstController = mocks.controller as ControllerStub
    const second = sidebarNewSessionFeature.call(ctx)
    const secondController = mocks.controller as ControllerStub
    firstController.click(clickEvent(buttonTarget('新建会话')))
    firstController.click(clickEvent(buttonTarget('新建会话')))
    secondController.click(clickEvent(buttonTarget('新建会话')))
    expect(warn).toHaveBeenCalledTimes(2)
    first()
    second()
  })

  it('捕获阶段吞掉官方「新建会话」点击并改走未分组新建', () => {
    const dispose = sidebarNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub
    expect(controller.clickOptions(), '必须用捕获阶段：document 捕获先于 React 根容器的官方处理器')
      .toEqual({ capture: true })

    const event = clickEvent(buttonTarget('新建会话'))
    controller.click(event)

    expect(event.preventDefault, '官方默认分支必须被拦下').toHaveBeenCalledTimes(1)
    expect(event.stopImmediatePropagation, '官方 onClick 挂在 React 根容器上，必须阻断传播').toHaveBeenCalledTimes(1)
    expect(mocks.startUngroupedSession).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('按钮内部节点点击同样命中（最近的 button[aria-label] 是官方按钮）', () => {
    const dispose = sidebarNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    controller.click(clickEvent(childTarget(new FakeButton('New session'))))

    expect(mocks.startUngroupedSession).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('工作区分组行的「+」不命中：不拦点击、不建会话', () => {
    const dispose = sidebarNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    const event = clickEvent(buttonTarget('在“dsh-tauri-desktop”中新建会话'))
    controller.click(event)

    expect(event.preventDefault, '分组行的行为必须保持不变').not.toHaveBeenCalled()
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(mocks.startUngroupedSession).not.toHaveBeenCalled()
    dispose()
  })

  it('英雄区工作区 chip 不命中', () => {
    const dispose = sidebarNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    controller.click(clickEvent(buttonTarget('选择工作区')))

    expect(mocks.startUngroupedSession).not.toHaveBeenCalled()
    dispose()
  })

  it('非 Element 目标不命中', () => {
    const dispose = sidebarNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    controller.click(clickEvent({ not: 'an element' }))

    expect(mocks.startUngroupedSession).not.toHaveBeenCalled()
    dispose()
  })

  it('dispose 后不再响应点击', () => {
    const dispose = sidebarNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub
    dispose()

    controller.click(clickEvent(buttonTarget('新建会话')))

    expect(mocks.startUngroupedSession).not.toHaveBeenCalled()
  })

  it('缺 composer 补丁时放行官方分支，只告警一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.composerWorkspaceLess = false
    const dispose = sidebarNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    const first = clickEvent(buttonTarget('新建会话'))
    controller.click(first)
    controller.click(clickEvent(buttonTarget('新建会话')))

    expect(first.preventDefault, '退级第 4 级：能力缺席时不得拦官方点击').not.toHaveBeenCalled()
    expect(mocks.startUngroupedSession).not.toHaveBeenCalled()
    expect(warn, '告警只打一次，不刷屏').toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('composer.workspace-less'))
    dispose()
  })
})

/**
 * 官方「未分组」分组行的「+」在未分组桶里是空实现（`group.workspaceId === undefined`），
 * 点击没有任何效果；这里锁住「与侧边栏『新建会话』一致」的接管行为与两代判据。
 */
describe('ungroupedNewSessionFeature', () => {
  /** 官方分组行：0.1.7 起带 `data-row-key`（未分组桶为 `workspace:`）。 */
  function rowWith(rowKey: string | null): FakeElement {
    const row = new FakeElement()
    row.getAttribute = name => (name === 'data-row-key' ? rowKey : null)
    return row
  }

  /** 分组行的「+」：最近的 `button[aria-label]` 是自己，最近的 `[data-row-key]` 是分组行。 */
  function plusIn(row: FakeElement | null, label: string | null): FakeButton {
    const button = new FakeButton(label)
    button.closest = (selector) => {
      if (selector === 'button[aria-label]')
        return button
      if (selector === '[data-row-key]')
        return row
      return null
    }
    return button
  }

  it('0.1.7：未分组分组行的「+」按行键命中并改走未分组新建', () => {
    const dispose = ungroupedNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    const event = clickEvent(plusIn(rowWith('workspace:'), '在“未分组”中新建会话'))
    controller.click(event)

    expect(event.preventDefault, '官方空实现必须被拦下').toHaveBeenCalledTimes(1)
    expect(event.stopImmediatePropagation, '官方 onClick 挂在 React 根容器上，必须阻断传播').toHaveBeenCalledTimes(1)
    expect(mocks.startUngroupedSession).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('0.1.7：真实工作区分组行的「+」不命中', () => {
    const dispose = ungroupedNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    const event = clickEvent(plusIn(rowWith('workspace:ws-1'), '在“dsh-tauri-desktop”中新建会话'))
    controller.click(event)

    expect(event.preventDefault, '真实工作区的分组行行为必须保持不变').not.toHaveBeenCalled()
    expect(mocks.startUngroupedSession).not.toHaveBeenCalled()
    dispose()
  })

  it('≤0.1.6：没有 data-row-key 时退化按「未分组」文案命中', () => {
    const dispose = ungroupedNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    controller.click(clickEvent(plusIn(null, '在“未分组”中新建会话')))
    expect(mocks.startUngroupedSession).toHaveBeenCalledTimes(1)

    controller.click(clickEvent(plusIn(null, 'New session in Ungrouped')))
    expect(mocks.startUngroupedSession).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('≤0.1.6：真实工作区的「+」与侧边栏「新建会话」都不命中', () => {
    const dispose = ungroupedNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    controller.click(clickEvent(plusIn(null, '在“dsh-tauri-desktop”中新建会话')))
    controller.click(clickEvent(plusIn(null, '新建会话')))

    expect(mocks.startUngroupedSession).not.toHaveBeenCalled()
    dispose()
  })

  it('缺 composer 补丁时放行官方分支，只告警一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.composerWorkspaceLess = false
    const dispose = ungroupedNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub

    const first = clickEvent(plusIn(rowWith('workspace:'), '在“未分组”中新建会话'))
    controller.click(first)
    controller.click(clickEvent(plusIn(rowWith('workspace:'), '在“未分组”中新建会话')))

    expect(first.preventDefault, '能力缺席时不得拦官方点击').not.toHaveBeenCalled()
    expect(mocks.startUngroupedSession).not.toHaveBeenCalled()
    expect(warn, '告警只打一次，不刷屏').toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('composer.workspace-less'))
    dispose()
  })

  it('dispose 后不再响应点击', () => {
    const dispose = ungroupedNewSessionFeature.call(ctx)
    const controller = mocks.controller as ControllerStub
    dispose()

    controller.click(clickEvent(plusIn(rowWith('workspace:'), '在“未分组”中新建会话')))

    expect(mocks.startUngroupedSession).not.toHaveBeenCalled()
  })
})
