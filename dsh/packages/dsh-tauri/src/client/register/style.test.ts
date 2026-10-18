// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerStyle } from './style'

const disposers: Array<() => void> = []

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup() {
  document.body.innerHTML = '<aside data-slot="sidebar"><div style="background:rgb(20, 30, 40)"></div></aside><main></main>'
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const post = vi.fn()
  vi.stubGlobal('parent', { postMessage: post })
  const reads = vi.spyOn(window, 'getComputedStyle')
  const dispose = registerStyle.call({})
  disposers.push(dispose)
  function paint() {
    const batch = [...frames.values()]
    frames.clear()
    batch.forEach(callback => callback(16))
  }
  return { frames, post, reads, paint, dispose }
}

describe('desktop style reporting', () => {
  it('sends the existing sidebar style on the first paint without requiring a DOM mutation', () => {
    const { paint, post } = setup()
    paint()
    expect(post).toHaveBeenCalledOnce()
    expect(post.mock.calls[0][0]).toMatchObject({ type: 'dsh://style', sidebar: { background: 'rgb(20, 30, 40)' }, marked: null, frame: null })
  })

  it('coalesces streamed chat mutations before reading styles and suppresses unchanged messages', async () => {
    const { frames, paint, post, reads } = setup()
    paint()
    post.mockClear()
    reads.mockClear()
    for (let i = 0; i < 20; i++) {
      document.querySelector('main')!.textContent = `Stream chunk ${i}`
      await Promise.resolve()
    }
    expect(reads).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(frames.size).toBe(1)
    paint()
    expect(reads).toHaveBeenCalledOnce()
    expect(post).not.toHaveBeenCalled()
  })

  it('reports a changed sidebar background once on the next paint', async () => {
    const { paint, post } = setup()
    paint()
    post.mockClear()
    document.querySelector<HTMLElement>('[data-slot="sidebar"] > div')!.style.background = 'rgb(50, 60, 70)'
    await Promise.resolve()
    paint()
    expect(post).toHaveBeenCalledOnce()
    expect(post.mock.calls[0][0].sidebar).toEqual({ background: 'rgb(50, 60, 70)' })
  })

  it('reports a root color-scheme change even when the chat body stays unchanged', async () => {
    const { paint, post } = setup()
    paint()
    post.mockClear()
    document.documentElement.style.colorScheme = 'dark'
    await Promise.resolve()
    paint()
    expect(post).toHaveBeenCalledOnce()
    expect(post.mock.calls[0][0].colorScheme).toBe('dark')
  })

  it('cancels queued reads and stops observing after the plugin unloads', async () => {
    const { frames, paint, post, reads, dispose } = setup()
    document.querySelector('main')!.textContent = 'Pending stream update'
    await Promise.resolve()
    dispose()
    expect(frames.size).toBe(0)
    paint()
    document.querySelector('main')!.textContent = 'Update after unload'
    await Promise.resolve()
    paint()
    expect(reads).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })
})
