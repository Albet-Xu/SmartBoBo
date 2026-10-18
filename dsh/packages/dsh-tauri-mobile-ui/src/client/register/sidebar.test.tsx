// @vitest-environment jsdom
import type { ComponentType } from 'react'
import type { LifecycleController } from '../../../../dsh-tauri/src/client/controller'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLifecycleController } from '../../../../dsh-tauri/src/client/controller'
import { defineAdapter } from '../../../../dsh-tauri/src/client/register/index.adapter'

import { registerMobileSidebar } from './sidebar'

interface TestContext {
  layout: {
    toggleSidebar: () => void
    selectPanel: (panel: string | null) => void
  }
  slots: {
    inject: (slot: string, activate: () => () => void) => () => void
    register: (options: unknown, component: ComponentType) => () => void
  }
}

const mocks = vi.hoisted(() => ({
  mobile: true,
  component: undefined as ComponentType | undefined,
  parentHandler: undefined as ((message: { type?: string }) => void) | undefined,
  invokeParent: vi.fn(),
  listenParent: vi.fn(),
  sessions: undefined as unknown,
  sessionListeners: new Set<() => void>(),
  startSession: vi.fn(),
}))

vi.mock('dsh-tauri/client', () => ({
  defineLocale: (namespace: string, dictionaries: Record<string, unknown>) => ({
    NS: namespace,
    text: (key: string) => key,
    useLocale: () => 'en',
    registerLocale: vi.fn(),
    ...dictionaries,
  }),
  MOBILE_MEDIA_QUERIES: ['(hover: none)', '(any-pointer: coarse)', '(any-hover: none)'],
  detectMobileDevice: () => mocks.mobile,
  invokeParent: mocks.invokeParent,
  listenParent: mocks.listenParent,
  defineRegister: (setup: (controller: LifecycleController, ctx: unknown, adapter: unknown) => void) => function (this: unknown) {
    const controller = createLifecycleController()
    setup(controller, this, {
      sessions: {
        list: {
          getSnapshot: () => mocks.sessions,
          subscribe: (listener: () => void) => {
            mocks.sessionListeners.add(listener)
            return () => mocks.sessionListeners.delete(listener)
          },
        },
      },
      startSession: mocks.startSession,
    })
    return () => controller.dispose()
  },
}))

vi.mock('../locales', () => ({
  locale: {
    NS: 'dsh-tauri-mobile-ui',
    text: (key: string) => ({
      'toggle.open': 'Open sidebar',
      'toggle.close': 'Close sidebar',
      'shade.close': 'Close sidebar',
      'navbar.label': 'Conversation navigation',
      'session.new': 'New Session',
      'session.failed': 'Unable to start a session. Please try again.',
    }[key] ?? key),
    useLocale: () => 'en',
    registerLocale: vi.fn(),
  },
}))

vi.mock('dsh-tauri-ui/client', async () => ({
  ...await import('../../../../dsh-tauri-ui/src/client/components/icons'),
  ...await import('../../../../dsh-tauri-ui/src/client/components/icon'),
}))

const disposers: Array<() => void> = []

function setupFrame(): { sidebar: HTMLElement, center: HTMLElement, main: HTMLElement, overlay: HTMLElement } {
  document.body.innerHTML = '<div class="pI_x6G_frame" data-rightbar-collapsed><div class="pI_x6G_sidebarCol"></div><div class="pI_x6G_centerCol"><div data-slot="main"><div data-conversation-scroll></div></div></div><div data-shell-overlay></div></div>'
  const frame = document.querySelector<HTMLElement>('[data-shell-overlay]')?.parentElement
  if (frame === null || frame === undefined)
    throw new Error('Missing layout frame')
  return {
    sidebar: frame.querySelector<HTMLElement>('[class$="_sidebarCol"]')!,
    center: frame.querySelector<HTMLElement>('[class$="_centerCol"]')!,
    main: frame.querySelector<HTMLElement>('[data-slot="main"]')!,
    overlay: frame.querySelector<HTMLElement>('[data-shell-overlay]')!,
  }
}

function renderOverlay(overlay: HTMLElement): void {
  const Component = mocks.component
  if (Component === undefined)
    throw new Error('Sidebar overlay was not registered')
  render(<Component />, { container: overlay })
}

function touch(target: Element, type: string, x: number, y: number, time: number, count = 1, cancelable = true): Event {
  const event = new Event(type, { bubbles: true, cancelable })
  const point = { identifier: 1, clientX: x, clientY: y }
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : Array.from({ length: count }, (_, index) => ({ ...point, identifier: index + 1 })) },
    changedTouches: { value: [point] },
    timeStamp: { value: time },
  })
  fireEvent(target, event)
  return event
}

function pointer(target: Element, type: string, x: number, y: number, time: number, pointerType = 'mouse', buttons = type === 'pointerup' ? 0 : 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    pointerType: { value: pointerType },
    isPrimary: { value: true },
    button: { value: 0 },
    buttons: { value: buttons },
    clientX: { value: x },
    clientY: { value: y },
    timeStamp: { value: time },
  })
  fireEvent(target, event)
  return event
}

function register(layout: Partial<TestContext['layout']> = {}): { dispose: () => void, ctx: TestContext } {
  const ctx: TestContext = {
    layout: {
      toggleSidebar: vi.fn(),
      selectPanel: vi.fn(),
      ...layout,
    },
    slots: {
      inject: (_slot, activate) => activate(),
      register: (_options, component) => {
        mocks.component = component
        return vi.fn()
      },
    },
  }
  const dispose = registerMobileSidebar.call(ctx)
  disposers.push(dispose)
  return { dispose, ctx }
}

beforeEach(() => {
  const inertValues = new WeakMap<HTMLElement, boolean>()
  Object.defineProperty(HTMLElement.prototype, 'inert', {
    configurable: true,
    get(this: HTMLElement) {
      return inertValues.get(this) ?? false
    },
    set(this: HTMLElement, value: boolean) {
      inertValues.set(this, value)
    },
  })
  cleanup()
  document.documentElement.removeAttribute('data-dsh-mobile-sidebar')
  document.documentElement.removeAttribute('data-dsh-mobile-sidebar-open')
  document.documentElement.removeAttribute('data-dsh-mobile-sidebar-dragging')
  document.body.innerHTML = ''
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390, writable: true })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  mocks.mobile = true
  mocks.component = undefined
  mocks.parentHandler = undefined
  mocks.invokeParent.mockReset()
  mocks.listenParent.mockReset()
  mocks.sessions = { ids: [], byId: {} }
  mocks.sessionListeners.clear()
  mocks.startSession.mockReset().mockResolvedValue({ status: 'started' })
  mocks.listenParent.mockImplementation((handler: (message: { type?: string }) => void) => {
    mocks.parentHandler = handler
    return vi.fn()
  })
})

afterEach(() => {
  disposers.splice(0).reverse().forEach(dispose => dispose())
  cleanup()
  vi.restoreAllMocks()
})

describe('registerMobileSidebar', () => {
  it('uses the same sidebar glyph as the desktop navbar and an outlined circle-plus without button wrappers', () => {
    const { overlay } = setupFrame()
    register()
    renderOverlay(overlay)
    const toggle = screen.getByRole('button', { name: 'Open sidebar' })
    const plus = screen.getByRole('button', { name: 'New Session' })
    const sidebarPath = 'M6 3.5h6A1.5 1.5 0 0 1 13.5 5v6a1.5 1.5 0 0 1-1.5 1.5H6zm-1.5 0H4A1.5 1.5 0 0 0 2.5 5v6A1.5 1.5 0 0 0 4 12.5h.5zM1 5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3z'
    const circlePlusPath = 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0M8.75 5.5a.75.75 0 0 0-1.5 0v1.75H5.5a.75.75 0 1 0 0 1.5h1.75v1.75a.75.75 0 0 0 1.5 0V8.75h1.75a.75.75 0 0 0 0-1.5H8.75z'
    expect(toggle.querySelector('path')?.getAttribute('d')).toBe(sidebarPath)
    expect(plus.querySelector('path')?.getAttribute('d')).toBe(circlePlusPath)
    expect(toggle.closest('button')).toBeNull()
    expect(plus.closest('button')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.querySelector('path')?.getAttribute('d')).toBe(sidebarPath)
  })

  it('keeps navigation in the moving center while only drawer/main content becomes inert', () => {
    const { sidebar, center, main, overlay } = setupFrame()
    sidebar.setAttribute('aria-hidden', 'false')
    main.setAttribute('aria-hidden', 'false')
    const { dispose, ctx } = register()
    renderOverlay(overlay)
    const toggle = screen.getByRole('button', { name: 'Open sidebar' })

    expect(toggle.tagName.toLowerCase()).toBe('svg')
    expect(toggle.closest('button')).toBeNull()
    expect(center.firstElementChild).toBe(toggle.closest('[data-dsh-mobile-navbar-host]'))
    expect(toggle.closest('[data-shell-overlay]')).toBeNull()
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    expect(sidebar.inert).toBe(true)
    expect(main.inert).toBe(false)
    toggle.focus()
    fireEvent.click(toggle)

    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(true)
    expect(sidebar.getAttribute('aria-hidden')).toBe('false')
    expect(sidebar.inert).toBe(false)
    expect(main.getAttribute('aria-hidden')).toBe('true')
    expect(main.inert).toBe(true)
    expect(center.inert).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('319px')
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-shadow')).toBe('')
    expect(mocks.invokeParent).toHaveBeenCalledWith({ type: 'dsh://sidebar:collapsed', collapsed: false })

    fireEvent.click(overlay.querySelector('[data-dsh-mobile-sidebar-shade]')!)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
    expect(document.activeElement).toBe(toggle)
    expect(mocks.invokeParent).toHaveBeenLastCalledWith({ type: 'dsh://sidebar:collapsed', collapsed: true })

    dispose()
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar')).toBe(false)
    expect(document.querySelector('[data-dsh-mobile-navbar-host]')).toBeNull()
    expect(sidebar.getAttribute('aria-hidden')).toBe('false')
    expect(sidebar.inert).toBe(false)
    expect(main.getAttribute('aria-hidden')).toBe('false')
    expect(main.inert).toBe(false)
    expect(ctx.layout.toggleSidebar).not.toHaveBeenCalled()
    expect(mocks.sessionListeners.size).toBe(0)
  })

  it('closes with a touch swipe on the real shell-overlay shade', () => {
    const { overlay } = setupFrame()
    register()
    renderOverlay(overlay)
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    const shade = overlay.querySelector<HTMLElement>('[data-dsh-mobile-sidebar-shade]')!

    touch(shade, 'touchstart', 365, 220, 100)
    const move = touch(shade, 'touchmove', 175, 222, 200)
    expect(move.defaultPrevented).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('129px')
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-dragging')).toBe(true)
    touch(shade, 'touchend', 145, 222, 240)

    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('0px')
    expect(mocks.invokeParent).toHaveBeenLastCalledWith({ type: 'dsh://sidebar:collapsed', collapsed: true })
  })

  it('opens by swiping main content instead of requiring a screen-edge start', () => {
    const { main, overlay } = setupFrame()
    register()
    renderOverlay(overlay)
    const content = main.querySelector<HTMLElement>('[data-conversation-scroll]')!

    touch(content, 'touchstart', 140, 300, 100)
    const move = touch(content, 'touchmove', 300, 302, 300)
    expect(move.defaultPrevented).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('160px')
    touch(content, 'touchend', 320, 302, 400)

    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('319px')
  })

  it.each(['shade', 'center', 'frame'])('suppresses a swipe compatibility click retargeted to the %s without swallowing unrelated controls', (surface) => {
    const { main, center, overlay } = setupFrame()
    register()
    renderOverlay(overlay)
    const content = main.querySelector<HTMLElement>('[data-conversation-scroll]')!
    const shade = overlay.querySelector<HTMLElement>('[data-dsh-mobile-sidebar-shade]')!
    const frame = overlay.parentElement!
    const target = surface === 'shade' ? shade : surface === 'center' ? center : frame
    const onRetarget = vi.fn()
    target.addEventListener('click', onRetarget)
    touch(content, 'touchstart', 140, 300, 100)
    touch(content, 'touchmove', 300, 302, 300)
    touch(content, 'touchend', 330, 302, 400)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(true)
    fireEvent.click(target)
    expect(onRetarget).not.toHaveBeenCalled()
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(true)
    fireEvent.click(shade)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
    touch(content, 'touchstart', 140, 300, 500)
    touch(content, 'touchmove', 300, 302, 700)
    touch(content, 'touchend', 330, 302, 800)
    fireEvent.click(document.querySelector('[data-dsh-mobile-sidebar-toggle]')!)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
  })

  it('keeps vertical scrolls, editable targets, and other overlays outside the drawer gesture', () => {
    const { main, overlay } = setupFrame()
    register()
    renderOverlay(overlay)
    const input = document.createElement('textarea')
    main.append(input)
    const otherOverlay = document.createElement('div')
    overlay.append(otherOverlay)
    for (const target of [input, otherOverlay]) {
      touch(target, 'touchstart', 10, 300, 100)
      expect(touch(target, 'touchmove', 250, 302, 300).defaultPrevented).toBe(false)
      touch(target, 'touchend', 250, 302, 400)
      expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('0px')
    }
    touch(main, 'touchstart', 10, 300, 100)
    expect(touch(main, 'touchmove', 15, 380, 300).defaultPrevented).toBe(false)
    touch(main, 'touchend', 15, 380, 400)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
  })

  it('supports mouse/pen pointers on mobile without double-processing touch pointer streams', () => {
    const { main, overlay } = setupFrame()
    register()
    renderOverlay(overlay)
    pointer(main, 'pointerdown', 100, 200, 100, 'touch')
    expect(pointer(main, 'pointermove', 300, 200, 200, 'touch').defaultPrevented).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('0px')
    pointer(main, 'pointerdown', 100, 200, 100)
    expect(pointer(main, 'pointermove', 300, 200, 200).defaultPrevented).toBe(true)
    touch(main, 'touchstart', 10, 200, 200)
    touch(main, 'touchmove', 20, 200, 220)
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('200px')
    pointer(main, 'pointerup', 320, 200, 240)
    const shade = overlay.querySelector<HTMLElement>('[data-dsh-mobile-sidebar-shade]')!
    pointer(shade, 'pointerdown', 360, 200, 300, 'pen')
    expect(pointer(shade, 'pointermove', 140, 200, 400, 'pen').defaultPrevented).toBe(true)
    pointer(shade, 'pointerup', 120, 200, 450, 'pen')
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
  })

  it.each(['release', 'lost', 'buttons', 'dispose'])('captures only a claimed mouse drag and releases it on %s', (reason) => {
    const { main, overlay } = setupFrame()
    const frame = overlay.parentElement!
    const capture = vi.fn()
    const release = vi.fn()
    let captured = false
    Object.defineProperties(frame, {
      setPointerCapture: { value: (id: number) => {
        captured = true
        capture(id)
      } },
      hasPointerCapture: { value: () => captured },
      releasePointerCapture: { value: (id: number) => {
        captured = false
        release(id)
      } },
    })
    const { dispose } = register()
    renderOverlay(overlay)
    pointer(main, 'pointerdown', 100, 200, 100)
    expect(capture).not.toHaveBeenCalled()
    expect(pointer(main, 'pointermove', 105, 200, 130).defaultPrevented).toBe(false)
    expect(capture).not.toHaveBeenCalled()
    pointer(main, 'pointermove', 200, 200, 300)
    expect(capture).toHaveBeenCalledWith(7)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-dragging')).toBe(true)
    if (reason === 'release') {
      pointer(frame, 'pointerup', 200, 200, 500)
    }
    else if (reason === 'lost') {
      captured = false
      pointer(frame, 'lostpointercapture', 200, 200, 500)
    }
    else if (reason === 'buttons') {
      expect(pointer(frame, 'pointermove', 300, 200, 500, 'mouse', 0).defaultPrevented).toBe(false)
    }
    else {
      act(() => dispose())
    }
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-dragging')).toBe(false)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
    if (reason === 'dispose') {
      expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('')
    }
    else {
      expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('0px')
    }
    const released = release.mock.calls.length
    if (reason === 'lost') {
      expect(released).toBe(0)
    }
    else {
      expect(released).toBe(1)
      expect(release).toHaveBeenCalledWith(7)
    }
    if (reason !== 'dispose') {
      pointer(main, 'pointerdown', 100, 200, 600)
      pointer(main, 'pointermove', 300, 200, 900)
      pointer(frame, 'pointerup', 300, 200, 1200)
      expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(true)
    }
  })

  it.each(['content', 'main', 'frame'])('cancels a claimed touch gesture when its %s is detached at the same viewport width', async (part) => {
    const { main, overlay } = setupFrame()
    register()
    renderOverlay(overlay)
    const content = main.querySelector<HTMLElement>('[data-conversation-scroll]')!
    touch(content, 'touchstart', 100, 200, 100)
    touch(content, 'touchmove', 260, 200, 300)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-dragging')).toBe(true)
    const original = part === 'content' ? content : part === 'main' ? main : overlay.parentElement!
    await act(async () => {
      const replacement = original.cloneNode(true) as HTMLElement
      if (part === 'frame')
        replacement.querySelector('[data-dsh-mobile-navbar-host]')?.remove()
      original.replaceWith(replacement)
    })
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-dragging')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('0px')
    const replacement = document.querySelector('[data-conversation-scroll]')!
    touch(replacement, 'touchstart', 100, 200, 400)
    touch(replacement, 'touchmove', 300, 200, 700)
    touch(replacement, 'touchend', 300, 200, 1000)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(true)
  })

  it('never toggles core preferences to refresh mobile ownership across the desktop breakpoint', async () => {
    setupFrame()
    let desktopWidth = 350
    let narrowExpanded = false
    const toggleSidebar = vi.fn(() => {
      if (window.innerWidth < 1024)
        narrowExpanded = !narrowExpanded
      else
        desktopWidth = desktopWidth === 0 ? 280 : 0
    })
    const { dispose } = register({ toggleSidebar })
    window.innerWidth = 1200
    fireEvent(window, new Event('resize'))
    await act(async () => {
      dispose()
    })
    expect(toggleSidebar).not.toHaveBeenCalled()
    expect(desktopWidth).toBe(350)
    expect(narrowExpanded).toBe(false)
  })

  it.each(['cancel', 'multitouch', 'noncancelable', 'resize'])('cancels an in-progress swipe on %s', (reason) => {
    const { main, overlay } = setupFrame()
    register()
    renderOverlay(overlay)
    touch(main, 'touchstart', 100, 200, 100)
    touch(main, 'touchmove', 260, 200, 200)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-dragging')).toBe(true)
    if (reason === 'cancel')
      touch(main, 'touchcancel', 300, 200, 300)
    else if (reason === 'multitouch')
      touch(main, 'touchmove', 300, 200, 300, 2)
    else if (reason === 'noncancelable')
      touch(main, 'touchmove', 300, 200, 300, 1, false)
    else
      fireEvent(window, new Event('resize'))
    touch(main, 'touchend', 360, 200, 400)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-dragging')).toBe(false)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--dsh-mobile-sidebar-offset')).toBe('0px')
  })

  it('preserves horizontal scrollers, selected text, and navbar controls', () => {
    const { main, overlay } = setupFrame()
    register()
    renderOverlay(overlay)
    const code = document.createElement('pre')
    code.style.overflowX = 'auto'
    Object.defineProperties(code, { scrollWidth: { value: 500 }, clientWidth: { value: 100 } })
    main.append(code)
    const toggle = screen.getByRole('button', { name: 'Open sidebar' })
    for (const target of [code, toggle]) {
      touch(target, 'touchstart', 100, 200, 100)
      expect(touch(target, 'touchmove', 300, 200, 200).defaultPrevented).toBe(false)
      touch(target, 'touchend', 320, 200, 300)
    }
    const selection = window.getSelection()!
    vi.spyOn(selection, 'isCollapsed', 'get').mockReturnValue(false)
    touch(main, 'touchstart', 100, 200, 100)
    expect(touch(main, 'touchmove', 300, 200, 200).defaultPrevented).toBe(false)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
  })

  it.each([140, 220])('suppresses the swipe-origin click after ending at x=%i and still allows unrelated controls', (endX) => {
    const { sidebar, overlay } = setupFrame()
    const row = document.createElement('button')
    row.textContent = 'Existing session'
    sidebar.append(row)
    const onRow = vi.fn()
    row.addEventListener('click', onRow)
    register()
    renderOverlay(overlay)
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    touch(row, 'touchstart', 220, 200, 100)
    touch(row, 'touchmove', 140, 200, 300)
    touch(row, 'touchmove', endX, 200, 400)
    touch(row, 'touchend', endX, 200, 600)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(true)
    fireEvent.click(row)
    expect(onRow).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('[data-dsh-mobile-sidebar-toggle]')!)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
    fireEvent.click(row)
    expect(onRow).toHaveBeenCalledTimes(1)
  })

  it('reconciles delayed/replaced frames and restores all owned DOM state on unload', async () => {
    const root = document.documentElement
    root.style.setProperty('--dsh-mobile-sidebar-width', '7px')
    vi.spyOn(root.style, 'getPropertyPriority').mockImplementation(name => name === '--dsh-mobile-sidebar-width' ? 'important' : '')
    const setProperty = vi.spyOn(root.style, 'setProperty')
    const { ctx, dispose } = register()
    expect(ctx.layout.toggleSidebar).not.toHaveBeenCalled()
    const { center, main, sidebar, overlay } = setupFrame()
    renderOverlay(overlay)
    await waitFor(() => expect(center.querySelector('[data-dsh-mobile-topbar]')).not.toBeNull())
    expect(ctx.layout.toggleSidebar).not.toHaveBeenCalled()
    const toggle = screen.getByRole('button', { name: 'Open sidebar' })
    toggle.focus()
    fireEvent.click(toggle)
    const replacementMain = document.createElement('div')
    replacementMain.setAttribute('data-slot', 'main')
    main.replaceWith(replacementMain)
    await waitFor(() => expect(replacementMain.inert).toBe(true))
    expect(main.inert).toBe(false)
    const replacementSidebar = document.createElement('div')
    replacementSidebar.className = 'new_sidebarCol'
    sidebar.replaceWith(replacementSidebar)
    await waitFor(() => expect(document.activeElement).toBe(replacementSidebar))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(toggle)
    act(() => dispose())
    expect(replacementMain.inert).toBe(false)
    expect(replacementSidebar.getAttribute('tabindex')).toBeNull()
    expect(root.style.getPropertyValue('--dsh-mobile-sidebar-width')).toBe('7px')
    expect(setProperty).toHaveBeenCalledWith('--dsh-mobile-sidebar-width', '7px', 'important')
    root.style.removeProperty('--dsh-mobile-sidebar-width')
  })

  it('hands the layout back at the desktop breakpoint without leftover navigation or gesture', () => {
    const { main, overlay } = setupFrame()
    const { dispose } = register()
    renderOverlay(overlay)
    touch(main, 'touchstart', 100, 200, 100)
    touch(main, 'touchmove', 260, 200, 200)
    window.innerWidth = 1200
    fireEvent(window, new Event('resize'))
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar')).toBe(false)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-dragging')).toBe(false)
    expect(document.querySelector('[data-dsh-mobile-navbar-host]')).toBeNull()
    expect(main.inert).toBe(false)
    dispose()
  })

  it('follows active titles, renames, and blank sessions without reading DOM titles', () => {
    const { overlay } = setupFrame()
    mocks.sessions = { current: 'selected', byId: { selected: { title: 'First title', blank: false } } }
    register()
    renderOverlay(overlay)
    const title = document.querySelector('[data-dsh-mobile-navbar-title]')!
    expect(title.textContent).toBe('First title')
    act(() => {
      mocks.sessions = { current: 'selected', byId: { selected: { title: 'Renamed title', blank: false } } }
      mocks.sessionListeners.forEach(listener => listener())
    })
    expect(title.textContent).toBe('Renamed title')
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    act(() => {
      mocks.sessions = { current: 'new', byId: { new: { title: 'Stale title', blank: true } } }
      mocks.sessionListeners.forEach(listener => listener())
    })
    expect(title.textContent).toBe('New Session')
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
  })

  it('creates sessions through the adapter from a naked keyboard-accessible plus icon', async () => {
    const { overlay } = setupFrame()
    const { ctx } = register()
    renderOverlay(overlay)
    const plus = screen.getByRole('button', { name: 'New Session' })
    const toggle = screen.getByRole('button', { name: 'Open sidebar' })
    expect(plus.tagName.toLowerCase()).toBe('svg')
    expect(plus.closest('button')).toBeNull()
    fireEvent.keyDown(toggle, { key: ' ' })
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(true)
    let finish: (result: { status: 'started' }) => void = () => {}
    mocks.startSession.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    fireEvent.keyDown(plus, { key: 'Enter' })
    fireEvent.keyDown(plus, { key: 'Enter', repeat: true })
    fireEvent.click(plus)
    expect(mocks.startSession).toHaveBeenCalledTimes(1)
    expect(plus.getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      finish({ status: 'started' })
    })
    expect(ctx.layout.selectPanel).not.toHaveBeenCalled()
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
    expect(plus.getAttribute('aria-disabled')).toBe('false')
    fireEvent.keyDown(plus, { key: ' ' })
    await waitFor(() => expect(mocks.startSession).toHaveBeenCalledTimes(2))
  })

  it.each(['unavailable', 'rejected'])('keeps failure %s visible and allows retry', async (status) => {
    const { overlay } = setupFrame()
    const { ctx } = register()
    renderOverlay(overlay)
    if (status === 'unavailable')
      mocks.startSession.mockResolvedValueOnce({ status, reason: 'Unavailable test capability' })
    else
      mocks.startSession.mockRejectedValueOnce(new Error('Test navigation failed'))
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Unable to start a session. Please try again.')
    expect(ctx.layout.selectPanel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(mocks.startSession).toHaveBeenCalledTimes(2)
    expect(ctx.layout.selectPanel).not.toHaveBeenCalled()
  })

  it('does not abort pending native navigation when the official startSession returns void', async () => {
    const { overlay } = setupFrame()
    const { ctx } = register()
    renderOverlay(overlay)
    const navigation = new AbortController()
    vi.mocked(ctx.layout.selectPanel).mockImplementation(() => navigation.abort())
    let finishConnect: (id: string) => void = () => {}
    const connect = new Promise<string>((resolve) => {
      finishConnect = resolve
    })
    const selectSession = vi.fn()
    const start = vi.fn(() => {
      void connect.then((id) => {
        if (!navigation.signal.aborted) {
          selectSession(id)
          ctx.layout.selectPanel(null)
        }
      })
    })
    const adapter = defineAdapter({ uiWorkspace: { startSession: start } })
    mocks.startSession.mockImplementation(() => adapter.startSession())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })
    expect(start).toHaveBeenCalledTimes(1)
    expect(navigation.signal.aborted).toBe(false)
    expect(ctx.layout.selectPanel).not.toHaveBeenCalled()
    expect(selectSession).not.toHaveBeenCalled()
    await act(async () => {
      finishConnect('created')
    })
    expect(selectSession).toHaveBeenCalledWith('created')
    expect(ctx.layout.selectPanel).toHaveBeenCalledTimes(1)
  })

  it('does not touch layout or DOM when new-session navigation settles after unload', async () => {
    const { overlay } = setupFrame()
    const { ctx, dispose } = register()
    renderOverlay(overlay)
    let finish: (result: { status: 'started' }) => void = () => {}
    mocks.startSession.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    act(() => dispose())
    await act(async () => {
      finish({ status: 'started' })
    })
    expect(ctx.layout.selectPanel).not.toHaveBeenCalled()
    expect(document.querySelector('[data-dsh-mobile-navbar-host]')).toBeNull()
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar')).toBe(false)
  })

  it('yields to an open rightbar and resumes closed without changing core layout state', async () => {
    const { main, overlay } = setupFrame()
    const frame = overlay.parentElement!
    const { ctx } = register()
    renderOverlay(overlay)
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    expect(main.inert).toBe(true)

    act(() => frame.removeAttribute('data-rightbar-collapsed'))
    await waitFor(() => expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar')).toBe(false))
    expect(main.inert).toBe(false)
    expect(document.querySelector('[data-dsh-mobile-navbar-host]')).toBeNull()
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)

    act(() => frame.setAttribute('data-rightbar-collapsed', ''))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInstanceOf(SVGElement))
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar')).toBe(true)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(false)
    expect(ctx.layout.toggleSidebar).not.toHaveBeenCalled()
    expect(ctx.layout.selectPanel).not.toHaveBeenCalled()
  })

  it('does not take ownership when the native rightbar is already visible', () => {
    const { overlay } = setupFrame()
    overlay.parentElement!.removeAttribute('data-rightbar-collapsed')
    register()
    renderOverlay(overlay)
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar')).toBe(false)
    expect(document.querySelector('[data-dsh-mobile-navbar-host]')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('maps the host toggle command to the drawer and remains inactive on desktop', () => {
    setupFrame()
    const { dispose } = register()
    const Component = mocks.component
    if (Component === undefined)
      throw new Error('Sidebar overlay was not registered')
    render(<Component />)

    mocks.parentHandler?.({ type: 'dsh://sidebar:toggle' })
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar-open')).toBe(true)

    dispose()
    mocks.mobile = false
    const desktop = register()
    expect(document.documentElement.hasAttribute('data-dsh-mobile-sidebar')).toBe(false)
    desktop.dispose()
  })
})
