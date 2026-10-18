// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { defineStore } from 'valtio-define'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppearance } from './use-appearance'

const mocks = vi.hoisted(() => ({
  setting: {} as any,
  platform: 'linux',
  setEffects: vi.fn(() => Promise.resolve()),
  clearEffects: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/store', () => ({ store: { get setting() {
  return mocks.setting
} } }))
vi.mock('@tauri-apps/api/window', () => ({
  Effect: { Acrylic: 'acrylic', Mica: 'mica', UnderWindowBackground: 'underWindowBackground' },
  EffectState: { FollowsWindowActiveState: 'followsWindowActiveState' },
  getCurrentWindow: () => ({ setEffects: mocks.setEffects, clearEffects: mocks.clearEffects }),
}))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => mocks.platform }))
vi.mock('./use-dsh-style', () => ({ useDshStyle: () => [{ colorScheme: 'dark' }] }))

const IFRAME_ORIGIN = 'http://localhost:3080'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  document.head.replaceChildren()
  delete (window as any).__DSH_TRANSPARENT__
  mocks.platform = 'linux'
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function setup(transparent: boolean, hydrated = true) {
  ;(window as any).__DSH_TRANSPARENT__ = transparent
  mocks.setting = defineStore({ state: () => ({ appearance: { palette: 'nord', terminal: false, opacity: 70 }, hydrated }) })
  const iframe = document.createElement('iframe')
  iframe.src = IFRAME_ORIGIN
  document.body.append(iframe)
  const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
  const hook = renderHook(() => useAppearance({ current: iframe }))
  function dispatch(type: string, origin = IFRAME_ORIGIN) {
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow!,
      origin,
      data: { type },
    })))
  }
  return {
    post,
    hook,
    // 帧内 document-start 的启动期请求（壳层据此下发 boot 投影）
    request: (origin?: string) => dispatch('dsh://appearance:request', origin),
    // 外观插件激活后的既有握手
    ready: (origin?: string) => dispatch('dsh://appearance:ready', origin),
  }
}

describe('desktop appearance projection', () => {
  it('keeps the canvas opaque until the native window has restarted with transparency enabled', () => {
    const { post, ready, hook } = setup(false)
    ready()
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'dsh://appearance', appearance: { opacity: 100 } })
    expect(hook.result.current).toContain('[data-testid="dsh-navbar-root"]{background:#343c4a!important')
  })

  it('sends the saved opacity to a transparent window and removes the bridge listener on unmount', () => {
    const { post, ready, hook } = setup(true)
    ready()
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ appearance: { palette: 'nord', opacity: 70 } })
    expect(hook.result.current).toContain('color-mix(in srgb,#2e3440 70%,transparent)')
    hook.unmount()
    post.mockClear()
    ready()
    expect(post).not.toHaveBeenCalled()
  })

  it('projects the same blur into the shell and embedded appearance message', async () => {
    const { post, ready, hook } = setup(true)
    ready()
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, transparency: true, opacity: 70, blur: true }
    })
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ appearance: { blur: true } })
    expect(hook.result.current).toContain('backdrop-filter:blur(16px)')
    expect(hook.result.current).toContain('-webkit-backdrop-filter:blur(16px)')
  })

  it('paints the shell bar with the fill the embedded sidebar column shows', async () => {
    const { hook } = setup(true)
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, transparency: true, opacity: 70, blur: true }
    })
    expect(hook.result.current).toContain('--color-canvas:#2e3440')
    expect(hook.result.current).toContain('[data-testid="dsh-navbar-root"]{background:color-mix(in srgb,#2e3440 70%,transparent)!important')
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, transparency: false, opacity: 70 }
    })
    expect(hook.result.current).toContain('[data-testid="dsh-navbar-root"]{background:#343c4a!important')
  })

  it.each([
    [{ transparency: true, opacity: 70 }, true],
    [{ transparency: true, opacity: 70, sidebarOnly: true }, true],
    [{ transparency: false, opacity: 70 }, false],
    [{ transparency: true, opacity: 100 }, false],
  ])('fills startup pages with the same alpha the shell bar uses for %j', async (preferences, translucent) => {
    const { hook } = setup(true)
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, ...preferences }
    })
    if (translucent)
      expect(hook.result.current).toContain('--color-startup:color-mix(in srgb,#2e3440 70%,transparent)')
    else
      expect(hook.result.current).toContain('--color-startup:#2e3440')
  })

  it('serializes native window effects on supported transparent desktops', async () => {
    mocks.platform = 'windows'
    const { hook } = setup(true)
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, transparency: true, opacity: 70, blur: true }
    })
    await vi.waitFor(() => expect(mocks.setEffects).toHaveBeenLastCalledWith({
      effects: ['acrylic', 'mica', 'underWindowBackground'],
      state: 'followsWindowActiveState',
    }))

    mocks.clearEffects.mockClear()
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, transparency: true, opacity: 100, blur: true }
    })
    await vi.waitFor(() => expect(mocks.setEffects).toHaveBeenCalledTimes(2))
    expect(mocks.clearEffects).not.toHaveBeenCalled()

    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, transparency: true, opacity: 70, blur: false }
    })
    await vi.waitFor(() => expect(mocks.clearEffects).toHaveBeenCalled())
    expect(mocks.setEffects.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.clearEffects.mock.invocationCallOrder.at(-1)!)
    hook.unmount()
  })

  it('does not request unsupported Linux window effects', async () => {
    mocks.platform = 'linux'
    setup(true)
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, transparency: true, opacity: 70, blur: true }
    })
    expect(mocks.setEffects).not.toHaveBeenCalled()
    expect(mocks.clearEffects).not.toHaveBeenCalled()
  })

  it('immediately restores an opaque canvas when native transparency is disabled', async () => {
    const { post, ready, hook } = setup(true)
    ready()
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, opacity: 70, transparency: false }
    })
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ appearance: { transparency: false, opacity: 100 } })
    expect(hook.result.current).toContain('[data-testid="dsh-navbar-root"]{background:#343c4a!important')
  })

  it('keeps a transparent default palette opaque at 100 percent', async () => {
    const { hook, request, post } = setup(true)
    request()
    expect(post.mock.calls.at(-1)?.[0].bootCss).toContain('[data-dsh-boot]')
    await act(async () => {
      mocks.setting.appearance = { palette: 'default', terminal: false, transparency: true, opacity: 100, blur: true }
    })
    expect(hook.result.current).toContain('[data-testid="dsh-navbar-root"]{background:#1b1b1c!important')
    expect(hook.result.current).not.toContain('backdrop-filter:blur')
    request()
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ bootCss: '' })
  })

  it('keeps the settings dialog opaque with the content-area option', async () => {
    const { hook } = setup(true)
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, transparency: true, opacity: 70, blur: true, sidebarOnly: true }
    })
    expect(hook.result.current).toContain('[data-testid="dsh-config-dialog"]{background:#343c4a!important}')
  })

  it('does not clear the startup effect before native settings hydrate', async () => {
    mocks.platform = 'windows'
    setup(true, false)
    expect(mocks.setEffects).not.toHaveBeenCalled()
    expect(mocks.clearEffects).not.toHaveBeenCalled()
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', terminal: false, transparency: true, opacity: 70, blur: true }
      mocks.setting.hydrated = true
    })
    await vi.waitFor(() => expect(mocks.setEffects).toHaveBeenCalledOnce())
  })

  it('applies high-contrast borders to the shell and removes them when switching palettes', async () => {
    const { hook } = setup(false)
    await act(async () => {
      mocks.setting.appearance = { palette: 'github-high-contrast', opacity: 100 }
    })
    expect(hook.result.current).toContain('--color-canvas:#010409')
    expect(hook.result.current).toContain('--field-border:#b7bdc8')
    await act(async () => {
      mocks.setting.appearance = { palette: 'nord', opacity: 100 }
    })
    expect(hook.result.current).not.toContain('--field-border:')
  })

  it('rejects an appearance handshake from the wrong origin', () => {
    const { post, ready } = setup(true)
    ready('https://example.invalid')
    expect(post).not.toHaveBeenCalled()
  })

  it('answers a document-start boot request with the boot projection alongside the runtime appearance', () => {
    const { post, request } = setup(true)
    request()
    const message = post.mock.calls.at(-1)?.[0]
    expect(message).toMatchObject({ type: 'dsh://appearance', appearance: { palette: 'nord' } })
    expect(message.bootCss).toContain('#root > [data-dsh-boot]')
    expect(message.bootCss).toContain('color-mix(in srgb,#2e3440 70%,transparent)')
  })

  it('does no message work on unrelated renders and restores opaque styling on reset', async () => {
    const { post, ready, hook } = setup(true)
    ready()
    post.mockClear()
    hook.rerender()
    expect(post).not.toHaveBeenCalled()
    await act(async () => {
      mocks.setting.appearance = { palette: 'default', terminal: false, opacity: 100 }
    })
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ appearance: { palette: 'default', opacity: 100 } })
    expect(hook.result.current).toContain('[data-testid="dsh-navbar-root"]{background:#1b1b1c!important')
  })
})
