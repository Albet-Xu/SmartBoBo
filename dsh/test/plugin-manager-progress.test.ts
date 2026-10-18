import i18next from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resources } from '../src/i18n/index.resource'

interface ToastCallOptions {
  timeout?: number
  isLoading?: boolean
  description?: string
  title?: string
  onClose?: (reason: string) => void
}

const { invoke, restart, toast, update, isActive } = vi.hoisted(() => {
  let index = 0
  const updateFn = vi.fn()
  const isActiveFn = vi.fn(() => true)
  const toastFn = vi.fn((_message: string, _options?: ToastCallOptions): string => `toast-${++index}`)
  return {
    invoke: vi.fn(),
    restart: vi.fn(),
    update: updateFn,
    isActive: isActiveFn,
    toast: Object.assign(toastFn, { close: vi.fn(), update: updateFn, clear: vi.fn(), isActive: isActiveFn }),
  }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../src/store/modules/harness', () => ({ harness: { restart } }))
vi.mock('@/utils/toast', () => ({ toast }))

// 与 src/i18n/index.ts 相同的扁平 key 约定：标题断言取真实文案而非未初始化的 key
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

const RUNTIME = { toast: true, restartOnSettle: false }
const BLOCKED = [{ name: 'b', version: '0.22.1', runtime_version: '0.2.0-rc.1' }]

function progressKey(): string {
  return toast.mock.results[0]?.value as string
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue(undefined)
  toast.mockClear()
  toast.close.mockClear()
  update.mockClear()
  isActive.mockReset()
  isActive.mockReturnValue(true)
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

describe('plugins manager progress toast', () => {
  it('opens the shared bubble in the loading state with the single plugin title', async () => {
    invoke.mockImplementation(() => new Promise(() => {}))

    void plugins.enqueue('upgrade', ['aaa'], RUNTIME)

    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(toast.mock.calls[0][0]).toBe('Upgrading aaa...')
    expect(toast.mock.calls[0][1]).toMatchObject({ timeout: 0, isLoading: true })
  })

  it('switches to the aggregate title as soon as another plugin joins the queue', async () => {
    invoke.mockImplementation(() => new Promise(() => {}))

    void plugins.enqueue('upgrade', ['aaa'], RUNTIME)
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1))

    void plugins.enqueue('upgrade', ['bbb'], RUNTIME)

    await vi.waitFor(() => expect(update).toHaveBeenCalled())
    expect(update).toHaveBeenCalledWith(progressKey(), expect.objectContaining({
      title: 'Upgrading 2 plugins...',
      isLoading: true,
    }))
  })

  it('falls back to the generic title when the queue mixes process types', async () => {
    invoke.mockImplementation(() => new Promise(() => {}))

    void plugins.enqueue('upgrade', ['aaa'], RUNTIME)
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1))

    void plugins.enqueue('uninstall', ['bbb'], RUNTIME)

    await vi.waitFor(() => expect(update).toHaveBeenCalled())
    expect(update).toHaveBeenLastCalledWith(progressKey(), expect.objectContaining({
      title: 'Processing 2 plugins...',
    }))
  })

  it('renders the newest install log line as the description', async () => {
    invoke.mockImplementation(() => new Promise(() => {}))

    void plugins.enqueue('install', ['aaa'], RUNTIME)
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1))

    plugins.setProgressDetail('Progress: resolved 1, reused 0')
    plugins.setProgressDetail('added 1 package')

    expect(update).toHaveBeenLastCalledWith(progressKey(), { description: 'added 1 package' })
  })

  it('hides the loading bubble while an approval is pending and restores it after the grant', async () => {
    let installCalls = 0
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'install_plugin_specs')
        return undefined
      installCalls += 1
      if (installCalls === 1)
        throw new Error(`PLUGIN_VERSION_INCOMPATIBLE: ${JSON.stringify(BLOCKED)}`)
      return undefined
    })

    const done = plugins.enqueue('install', ['b'], RUNTIME)
    await vi.waitFor(() => expect(plugins.pendingApprovals).toHaveLength(1))

    expect(toast.close).toHaveBeenCalledWith(progressKey())
    expect(plugins.progressKey).toBeNull()

    await plugins.approve('b')
    const results = await done

    expect(results.map(result => [result.process.name, result.ok])).toEqual([['b', true]])
    expect(plugins.progressKey).toBeNull()
  })

  it('rebuilds the shared bubble once the previous one is no longer active', async () => {
    let submissions = 0
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'update_dsh_plugins')
        return undefined
      submissions += 1
      if (submissions > 1)
        await new Promise(() => {})
      return undefined
    })
    // 第一组结算时把共享气泡标记为已消失（结果提示改到队列排空后才出现，这里模拟授权等其他气泡把它挤掉）
    plugins.on('completed', () => {
      isActive.mockReturnValue(false)
    })

    const first = plugins.enqueue('upgrade', ['aaa'], RUNTIME)
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    void plugins.enqueue('upgrade', ['bbb'], RUNTIME)
    await first

    await vi.waitFor(() => expect(toast.mock.calls.length).toBeGreaterThanOrEqual(2))

    plugins.setProgressDetail('added 1 package')
    expect(plugins.progressDetail).toBe('')
    expect(update).not.toHaveBeenCalledWith(progressKey(), { description: 'added 1 package' })

    const rebuilt = toast.mock.results.at(-1)?.value as string
    expect(rebuilt).not.toBe(progressKey())
    expect(toast.mock.calls.at(-1)?.[0]).toBe('Upgrading bbb...')
    expect(toast.mock.calls.at(-1)?.[1]).toMatchObject({ timeout: 0, isLoading: true })
    expect(plugins.progressKey).toBe(rebuilt)
  })
})
