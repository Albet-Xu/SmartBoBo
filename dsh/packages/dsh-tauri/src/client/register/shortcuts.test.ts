import type { ClientContext, ParentMessage } from '../types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CMD_SHORTCUTS_OPEN, EVENT_SHORTCUTS, shortcutsFeature } from './shortcuts'

const dispatchers = new Set<(event: KeyboardEvent) => void>()

interface Harness {
  sent: ParentMessage[]
  dispatch: (data: unknown) => void
  listeners: () => number
  keydowns: KeyboardEvent[]
}

function stubEnv(): Harness {
  const sent: ParentMessage[] = []
  const listeners = new Set<(event: MessageEvent) => void>()
  dispatchers.clear()
  const parent = { postMessage: (data: ParentMessage) => void sent.push(data) }
  vi.stubGlobal('window', {
    parent,
    addEventListener: (type: string, handler: (event: never) => void) => {
      if (type === 'message')
        listeners.add(handler as (event: MessageEvent) => void)
      if (type === 'keydown')
        dispatchers.add(handler as (event: KeyboardEvent) => void)
    },
    removeEventListener: (_type: string, handler: (event: never) => void) => {
      listeners.delete(handler as (event: MessageEvent) => void)
      dispatchers.delete(handler as (event: KeyboardEvent) => void)
    },
    dispatchEvent: (event: KeyboardEvent) => {
      for (const handler of dispatchers)
        handler(event)
      return true
    },
  })
  vi.stubGlobal('document', { execCommand: vi.fn(() => true) })
  return {
    sent,
    listeners: () => listeners.size,
    keydowns: [],
    dispatch(data: unknown) {
      for (const handler of listeners)
        handler({ source: parent, data } as unknown as MessageEvent)
    },
  }
}

const disposers: (() => void)[] = []

function fakeCtx(service: unknown): ClientContext {
  return { get: () => service } as unknown as ClientContext
}

function runFeature(ctx: ClientContext): () => void {
  const dispose = shortcutsFeature.call(ctx)
  disposers.push(dispose)
  return dispose
}

function catalogService(rows: unknown[], subscribe?: (listener: () => void) => () => void) {
  return { catalog: { getSnapshot: () => rows, ...subscribe === undefined ? {} : { subscribe } } }
}

afterEach(() => {
  for (const dispose of disposers.splice(0))
    dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('shortcutsFeature', () => {
  it('projects the catalog to the shell and republishes on change', () => {
    const env = stubEnv()
    let notify = (): void => {}
    const ctx = fakeCtx(catalogService([
      { id: 'session.new', label: 'New chat', keys: ['Ctrl+N'], aria: 'Control+N', modified: false },
      { id: 'workspace.add', label: 'Open folder', keys: ['Ctrl+O'] },
      { id: 'sidebar.left.toggle', label: 'Toggle sidebar', keys: ['⌥', '⌘', 'B'], binding: { code: 'KeyB', modifiers: ['alt', 'meta'] }, issue: null, conflicts: [] },
      { id: 42, label: 'broken' },
      { id: 'no.label' },
    ], (listener) => {
      notify = listener
      return () => {}
    }))

    runFeature(ctx)

    expect(env.sent).toEqual([{
      type: EVENT_SHORTCUTS,
      rows: [
        { id: 'session.new', label: 'New chat', keys: ['Ctrl+N'], aria: 'Control+N', available: false },
        { id: 'workspace.add', label: 'Open folder', keys: ['Ctrl+O'], available: false },
        { id: 'sidebar.left.toggle', label: 'Toggle sidebar', keys: ['⌥', '⌘', 'B'], available: true },
      ],
    }])
    expect(env.listeners()).toBe(1)

    notify()
    expect(env.sent).toHaveLength(2)
  })

  it('stays inert when the core has no shortcuts service', () => {
    const env = stubEnv()

    expect(() => runFeature(fakeCtx(undefined))).not.toThrow()
    expect(env.sent).toEqual([])
    expect(env.listeners()).toBe(0)
  })

  it('opens the official reference with the effective binding', () => {
    const env = stubEnv()
    class FakeKeyboardEvent {
      code: string
      ctrlKey: boolean
      metaKey: boolean
      altKey: boolean
      shiftKey: boolean
      constructor(_type: string, init: KeyboardEventInit = {}) {
        this.code = init.code ?? ''
        this.ctrlKey = Boolean(init.ctrlKey)
        this.metaKey = Boolean(init.metaKey)
        this.altKey = Boolean(init.altKey)
        this.shiftKey = Boolean(init.shiftKey)
      }
    }
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    let seen: FakeKeyboardEvent | undefined
    const handler = (event: FakeKeyboardEvent): void => {
      seen = event
    }
    dispatchers.add(handler as unknown as (event: KeyboardEvent) => void)

    runFeature(fakeCtx(catalogService([
      { id: 'shortcuts.open', label: 'Shortcuts', keys: ['Ctrl+/'], binding: { code: 'Slash', modifiers: ['control'] } },
    ])))
    env.dispatch({ type: CMD_SHORTCUTS_OPEN })

    expect(seen?.code).toBe('Slash')
    expect(seen?.ctrlKey).toBe(true)
    expect(seen?.metaKey).toBe(false)
    dispatchers.delete(handler as unknown as (event: KeyboardEvent) => void)
  })

  it.each(['sidebar.left.toggle', 'sidebar.right.toggle', 'terminal.new', 'session.search'])('invokes %s once with its current binding', (id) => {
    const env = stubEnv()
    class FakeKeyboardEvent {
      constructor(readonly type: string, readonly init: KeyboardEventInit) {}
    }
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    const received = vi.fn()
    dispatchers.add(received)
    const rows = [{ id, label: id, keys: ['⌘', 'T'], binding: { code: 'KeyT', modifiers: ['meta'] } }]
    runFeature(fakeCtx(catalogService(rows)))

    env.dispatch({ type: 'dsh://view:command', command: id })
    expect(received).toHaveBeenCalledExactlyOnceWith(new FakeKeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyT',
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      shiftKey: false,
    }))

    rows[0].binding = { code: 'KeyU', modifiers: ['control', 'shift'] }
    env.dispatch({ type: 'dsh://view:command', command: id })
    expect(received).toHaveBeenCalledTimes(2)
    expect(received).toHaveBeenLastCalledWith(new FakeKeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyU',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
    }))
  })

  it.each([
    { binding: null },
    { binding: { code: 'KeyB', modifiers: ['meta'] }, conflicts: ['other.command'] },
    { binding: { code: 'KeyB', modifiers: ['meta'] }, issue: 'reserved' },
    { binding: { code: 'KeyB', secondCode: 'KeyC', modifiers: ['meta'] } },
  ])('disables unavailable bindings without dispatching a fallback: %j', (input) => {
    const env = stubEnv()
    vi.stubGlobal('KeyboardEvent', vi.fn())
    runFeature(fakeCtx(catalogService([
      { id: 'sidebar.left.toggle', label: 'Sidebar', keys: ['⌘', 'B'], ...input },
      { id: 'shortcuts.open', label: 'Shortcuts', keys: [], binding: null },
    ])))

    expect(env.sent[0].rows).toEqual([
      { id: 'sidebar.left.toggle', label: 'Sidebar', keys: ['⌘', 'B'], available: false },
      { id: 'shortcuts.open', label: 'Shortcuts', keys: [], available: false },
    ])
    env.dispatch({ type: 'dsh://view:command', command: 'sidebar.left.toggle' })
    env.dispatch({ type: CMD_SHORTCUTS_OPEN })
    expect(KeyboardEvent).not.toHaveBeenCalled()
  })

  it('rejects commands outside the View whitelist', () => {
    const env = stubEnv()
    vi.stubGlobal('KeyboardEvent', vi.fn())
    runFeature(fakeCtx(catalogService([
      { id: 'session.archive', label: 'Archive', keys: ['⌘', 'A'], binding: { code: 'KeyA', modifiers: ['meta'] } },
    ])))
    env.dispatch({ type: 'dsh://view:command', command: 'session.archive' })
    env.dispatch({ type: 'dsh://view:command', command: 42 })
    expect(KeyboardEvent).not.toHaveBeenCalled()
  })

  it('clears the shell catalog when the bridge is disposed', () => {
    const env = stubEnv()
    const dispose = runFeature(fakeCtx(catalogService([
      { id: 'terminal.new', label: 'Terminal', keys: ['Ctrl+`'], binding: { code: 'Backquote', modifiers: ['control'] } },
    ])))
    dispose()
    expect(env.sent).toEqual([
      { type: EVENT_SHORTCUTS, rows: [{ id: 'terminal.new', label: 'Terminal', keys: ['Ctrl+`'], available: true }] },
      { type: EVENT_SHORTCUTS, rows: [] },
    ])
    expect(env.listeners()).toBe(0)
  })
})
