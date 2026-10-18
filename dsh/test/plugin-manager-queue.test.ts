import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ToastCallOptions {
  timeout?: number
  onClose?: (reason: string) => void
}

const { invoke, restart, toast } = vi.hoisted(() => {
  const toastFn = vi.fn((_message: string, _options?: ToastCallOptions) => 'toast-key')
  return {
    invoke: vi.fn(),
    restart: vi.fn(),
    toast: Object.assign(toastFn, { close: vi.fn(), update: vi.fn(), clear: vi.fn(), isActive: vi.fn(() => true) }),
  }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../src/store/modules/harness', () => ({ harness: { restart } }))
vi.mock('@/utils/toast', () => ({ toast }))

const { plugins } = await import('../src/store/modules/plugins')

const RUNTIME = { toast: false, restartOnSettle: false }

function resetStore() {
  invoke.mockReset()
  toast.mockClear()
  toast.close.mockClear()
  restart.mockClear()
  plugins.groups = []
  plugins.processes = []
  plugins.logs = []
  plugins.activeGroupId = null
  plugins.cancelling = false
  plugins.installedSource = []
  plugins.installedLoaded = false
  plugins.queueResults = []
}

beforeEach(resetStore)

describe('plugins manager queue', () => {
  it('submits the next group only after the running group settles', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command !== 'install_plugin_specs')
        return undefined
      if ((args.specs as string[])[0] === 'a')
        await firstGate
      return undefined
    })

    const firstDone = plugins.enqueue('install', ['a'], RUNTIME)
    const secondDone = plugins.enqueue('install', ['b'], RUNTIME)

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    expect(invoke.mock.calls[0][1]).toEqual({ specs: ['a'] })

    releaseFirst()
    await firstDone
    await secondDone

    expect(invoke.mock.calls.map(call => (call[1] as { specs: string[] }).specs)).toEqual([['a'], ['b']])
  })

  it('merges every install ref of one group into a single host call', async () => {
    invoke.mockResolvedValue(undefined)

    const results = await plugins.enqueue('install', ['a', 'b'], RUNTIME)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('install_plugin_specs', { specs: ['a', 'b'] })
    expect(results).toHaveLength(2)
    expect(results.every(result => result.ok)).toBe(true)
  })

  it('dispatches a disable group concurrently per plugin id', async () => {
    const releases: Array<() => void> = []
    const started: string[] = []
    invoke.mockImplementation((_command: string, args: Record<string, unknown>) => {
      started.push(args.id as string)
      return new Promise<void>((resolve) => {
        releases.push(resolve)
      })
    })

    const done = plugins.enqueue('disable', ['a', 'b'], RUNTIME)

    await vi.waitFor(() => expect(started).toHaveLength(2))
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls.map(call => (call[1] as { id: string }).id)).toEqual(['a', 'b'])

    releases.forEach(release => release())
    const results = await done
    expect(results.every(result => result.ok)).toBe(true)
  })

  it('runs an enable group through the per-plugin command with the override flag', async () => {
    invoke.mockResolvedValue(undefined)

    await plugins.enqueue('enable', ['a'], { ...RUNTIME, clearConfigOverride: true })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('enable_dsh_plugin', { id: 'a', clearConfigOverride: true })
  })

  it('keeps queue order when a later group is enqueued while an earlier one is settling', async () => {
    invoke.mockResolvedValue(undefined)

    const first = plugins.enqueue('install', ['a'], RUNTIME)
    const second = plugins.enqueue('upgrade', ['b'], RUNTIME)
    const third = plugins.enqueue('uninstall', ['c'], RUNTIME)

    await Promise.all([first, second, third])

    expect(invoke.mock.calls.map(call => call[0])).toEqual([
      'install_plugin_specs',
      'update_dsh_plugins',
      'remove_dsh_plugins',
    ])
  })
})
