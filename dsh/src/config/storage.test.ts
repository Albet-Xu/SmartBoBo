import { afterEach, describe, expect, it, vi } from 'vitest'

const load = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@tauri-apps/plugin-store', () => ({ Store: { load } }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('native store selection', () => {
  it.each(['.store.dat', '.store.dev.dat', '.store.test.dat'])('uses the native window store %s', async (path) => {
    vi.resetModules()
    vi.stubGlobal('__DSH_STORE_FILE__', path)
    await import('./storage')
    expect(load).toHaveBeenCalledWith(path, undefined)
  })

  it('uses the production store when no native window metadata is present', async () => {
    vi.resetModules()
    vi.stubGlobal('__DSH_STORE_FILE__', undefined)
    await import('./storage')
    expect(load).toHaveBeenCalledWith('.store.dat', undefined)
  })
})
