// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('dsh-tauri/client', () => ({
  defineRegister: (setup: (controller: { add: (dispose: () => void) => void }) => void) => () => {
    const cleanups: Array<() => void> = []
    setup({ add: dispose => cleanups.push(dispose) })
    return () => cleanups.splice(0).reverse().forEach(dispose => dispose())
  },
}))

const initialConfig = Object.getOwnPropertyDescriptor(window, '__DSH_BRIDGE_CONFIG__')
const disposers: Array<() => void> = []

beforeEach(() => {
  vi.resetModules()
  delete window.__DSH_BRIDGE_CONFIG__
})

afterEach(() => {
  disposers.splice(0).reverse().forEach(dispose => dispose())
  if (initialConfig)
    Object.defineProperty(window, '__DSH_BRIDGE_CONFIG__', initialConfig)
  else
    delete window.__DSH_BRIDGE_CONFIG__
  vi.restoreAllMocks()
})

describe('bridge configuration ownership', () => {
  it('installs the opt-out during module evaluation when configuration is absent', async () => {
    await import('./bridge')
    expect(window.__DSH_BRIDGE_CONFIG__).toEqual({ disablePageTweaks: true })
  })

  it('installs the opt-out when the initial configuration is explicitly undefined', async () => {
    window.__DSH_BRIDGE_CONFIG__ = undefined
    const bridge = await import('./bridge')
    disposers.push(bridge.registerBridgeConfig())
    expect(window.__DSH_BRIDGE_CONFIG__).toEqual({ disablePageTweaks: true })
  })

  it('keeps the installed object stable across repeated installs and registration', async () => {
    const bridge = await import('./bridge')
    const installed = window.__DSH_BRIDGE_CONFIG__
    expect(installed).toEqual({ disablePageTweaks: true })
    bridge.installBridgeConfig()
    bridge.installBridgeConfig()
    disposers.push(bridge.registerBridgeConfig())
    expect(window.__DSH_BRIDGE_CONFIG__).toBe(installed)
  })

  it('reinstalls the opt-out during registration if the early configuration was removed', async () => {
    const bridge = await import('./bridge')
    delete window.__DSH_BRIDGE_CONFIG__
    disposers.push(bridge.registerBridgeConfig())
    expect(window.__DSH_BRIDGE_CONFIG__).toEqual({ disablePageTweaks: true })
  })

  it('restores the exact preexisting object captured before controller setup', async () => {
    const previous = Object.freeze({ disablePageTweaks: false })
    window.__DSH_BRIDGE_CONFIG__ = previous
    const bridge = await import('./bridge')
    expect(window.__DSH_BRIDGE_CONFIG__).toEqual({ disablePageTweaks: true })
    expect(window.__DSH_BRIDGE_CONFIG__).not.toBe(previous)
    bridge.installBridgeConfig()
    const dispose = bridge.registerBridgeConfig()
    disposers.push(dispose)
    dispose()
    expect(window.__DSH_BRIDGE_CONFIG__).toBe(previous)
  })

  it('removes its owned configuration on disposal when no prior object existed', async () => {
    const bridge = await import('./bridge')
    const dispose = bridge.registerBridgeConfig()
    disposers.push(dispose)
    expect(window.__DSH_BRIDGE_CONFIG__).toEqual({ disablePageTweaks: true })
    dispose()
    expect(Object.hasOwn(window, '__DSH_BRIDGE_CONFIG__')).toBe(false)
  })

  it('preserves another owner that replaces the configuration after registration', async () => {
    window.__DSH_BRIDGE_CONFIG__ = { disablePageTweaks: false }
    const bridge = await import('./bridge')
    const dispose = bridge.registerBridgeConfig()
    disposers.push(dispose)
    const later = { disablePageTweaks: true }
    window.__DSH_BRIDGE_CONFIG__ = later
    dispose()
    expect(window.__DSH_BRIDGE_CONFIG__).toBe(later)
  })

  it('reinstalls the opt-out after disposal without resetting the module', async () => {
    const bridge = await import('./bridge')
    const firstDispose = bridge.registerBridgeConfig()
    disposers.push(firstDispose)
    firstDispose()
    expect(Object.hasOwn(window, '__DSH_BRIDGE_CONFIG__')).toBe(false)
    const secondDispose = bridge.registerBridgeConfig()
    disposers.push(secondDispose)
    expect(window.__DSH_BRIDGE_CONFIG__).toEqual({ disablePageTweaks: true })
    secondDispose()
    expect(Object.hasOwn(window, '__DSH_BRIDGE_CONFIG__')).toBe(false)
  })

  it('captures the current owner when reapplied after disposal', async () => {
    const bridge = await import('./bridge')
    const firstDispose = bridge.registerBridgeConfig()
    disposers.push(firstDispose)
    firstDispose()
    const previous = { disablePageTweaks: false }
    window.__DSH_BRIDGE_CONFIG__ = previous
    const secondDispose = bridge.registerBridgeConfig()
    disposers.push(secondDispose)
    expect(window.__DSH_BRIDGE_CONFIG__).toEqual({ disablePageTweaks: true })
    secondDispose()
    expect(window.__DSH_BRIDGE_CONFIG__).toBe(previous)
  })

  it('supports module reload after disposal without leaking configuration', async () => {
    const first = await import('./bridge')
    const firstDispose = first.registerBridgeConfig()
    disposers.push(firstDispose)
    firstDispose()
    expect(Object.hasOwn(window, '__DSH_BRIDGE_CONFIG__')).toBe(false)
    vi.resetModules()
    const second = await import('./bridge')
    const secondDispose = second.registerBridgeConfig()
    disposers.push(secondDispose)
    expect(window.__DSH_BRIDGE_CONFIG__).toEqual({ disablePageTweaks: true })
    secondDispose()
    expect(Object.hasOwn(window, '__DSH_BRIDGE_CONFIG__')).toBe(false)
  })
})
