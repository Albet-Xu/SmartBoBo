import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resources } from '../src/i18n/index.resource'

interface ToastCallOptions {
  timeout?: number
  variant?: string
  isLoading?: boolean
  description?: string
  onClose?: (reason: string) => void
  actionProps?: { children?: string, onPress?: () => void }
}

const { invoke, restart, toast } = vi.hoisted(() => {
  let index = 0
  const toastFn = vi.fn((_message: string, _options?: ToastCallOptions): string => `toast-${++index}`)
  return {
    invoke: vi.fn(),
    restart: vi.fn(),
    toast: Object.assign(toastFn, { close: vi.fn(), update: vi.fn(), clear: vi.fn(), isActive: vi.fn(() => true) }),
  }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../src/store/modules/harness', () => ({ harness: { restart } }))
vi.mock('@/utils/toast', () => ({ toast }))

await i18next.init({
  lng: 'en-US',
  fallbackLng: 'en-US',
  resources: resources as unknown as Record<string, { translation: Record<string, string> }>,
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
  initAsync: false,
})

const { plugins } = await import('../src/store/modules/plugins')

const RUNTIME = { toast: true, restartOnSettle: true }

function resultToasts() {
  return toast.mock.calls.filter(call => call[1]?.isLoading !== true)
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue(undefined)
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
  plugins.progressKey = null
  plugins.progressDetail = ''
  plugins.queueResults = []
})

describe('plugins manager queue summary', () => {
  it('reports the whole queue with a single toast once it drains', async () => {
    await Promise.all([
      plugins.enqueue('install', ['a'], RUNTIME),
      plugins.enqueue('upgrade', ['b'], RUNTIME),
      plugins.enqueue('uninstall', ['c'], RUNTIME),
    ])

    const toasts = resultToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0][0]).toBe('Plugin operations finished')
    expect(toasts[0][1]?.description).toBe('3 succeeded')
    // 队列自己热更新插件：汇总气泡不再常驻、也不再挂「重启」按钮
    expect(toasts[0][1]?.timeout).toBeUndefined()
    expect(toasts[0][1]?.actionProps).toBeUndefined()
    expect(restart).not.toHaveBeenCalled()
    expect(plugins.queueResults).toEqual([])
  })

  it('keeps reporting a lone result on its own instead of as a queue summary', async () => {
    await plugins.enqueue('install', ['a'], { toast: true, restartOnSettle: false })

    const toasts = resultToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0][0]).toBe('Plugin a installed')
  })

  it('counts successes and failures of the whole queue in the same summary', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'update_dsh_plugins')
        throw new Error('REGISTRY_DOWN: registry unreachable')
      return undefined
    })

    await Promise.all([
      plugins.enqueue('install', ['a'], { toast: true, restartOnSettle: false }),
      plugins.enqueue('upgrade', ['b'], { toast: true, restartOnSettle: false }),
    ])

    const toasts = resultToasts()
    expect(toasts).toHaveLength(1)
    expect(toasts[0][0]).toBe('Plugin operations finished')
    expect(toasts[0][1]?.description).toBe('1 succeeded · 1 failed')
    expect(toasts[0][1]?.variant).toBe('danger')
    expect(toasts[0][1]?.timeout).toBeUndefined()
    expect(toasts[0][1]?.actionProps).toBeUndefined()
  })
})

describe('plugins manager summary after a dismissed authorization', () => {
  const BLOCKED = [
    { name: 'b', version: '0.22.1', runtime_version: '0.2.0-rc.1' },
    { name: 'c', version: '0.22.1', runtime_version: '0.2.0-rc.1' },
  ]

  function approvalToasts() {
    return toast.mock.calls.filter(call => call[1]?.onClose !== undefined)
  }

  function summaryToasts() {
    return toast.mock.calls.filter(call => call[0] === 'Plugin operations finished')
  }

  it('stays silent when a multi-spec group ends with every process dismissed by the user', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'install_plugin_specs')
        throw new Error(`PLUGIN_VERSION_INCOMPATIBLE: ${JSON.stringify(BLOCKED)}`)
      return undefined
    })

    const done = plugins.enqueue('install', ['b', 'c'], { toast: true, restartOnSettle: false })
    await vi.waitFor(() => expect(approvalToasts()).toHaveLength(2))

    for (const call of approvalToasts())
      call[1]?.onClose?.('dismissed')

    const results = await done
    expect(results.map(result => [result.ok, result.reason])).toEqual([
      [false, 'rejected'],
      [false, 'rejected'],
    ])
    // 用户自己拒绝了两项：既不报失败，也不该弹一条没有任何收支的空汇总气泡。
    expect(summaryToasts()).toHaveLength(0)
  })

  it('still summarises a group where a dismissal sits next to a real success', async () => {
    let installCalls = 0
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'install_plugin_specs')
        return undefined
      installCalls += 1
      if (installCalls === 1)
        throw new Error(`PLUGIN_VERSION_INCOMPATIBLE: ${JSON.stringify([BLOCKED[0]])}`)
      return undefined
    })

    const done = plugins.enqueue('install', ['a', 'b'], { toast: true, restartOnSettle: false })
    await vi.waitFor(() => expect(approvalToasts()).toHaveLength(1))

    approvalToasts()[0][1]?.onClose?.('dismissed')

    const results = await done
    expect(Object.fromEntries(results.map(result => [result.process.name, [result.ok, result.reason]]))).toEqual({
      a: [true, undefined],
      b: [false, 'rejected'],
    })
    expect(summaryToasts()).toHaveLength(1)
    expect(summaryToasts()[0][1]?.description).toBe('1 succeeded')
  })
})
