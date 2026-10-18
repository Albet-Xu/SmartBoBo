import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ToastCallOptions {
  timeout?: number
  variant?: string
  isLoading?: boolean
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

const BLOCKED = [{ name: 'b', version: '0.22.1', runtime_version: '0.2.0-rc.1' }]
const POLICY = [{ name: 'b', version: '2.11.2' }]

function approvalToast() {
  return toast.mock.calls.find(call => call[1]?.onClose !== undefined)
}

beforeEach(() => {
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
})

describe('plugins manager approval', () => {
  it('attributes a refusal to the named process and returns the untouched ones to pending', async () => {
    let installCalls = 0
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'install_plugin_specs')
        return undefined
      installCalls += 1
      if (installCalls === 1)
        throw new Error(`PLUGIN_VERSION_INCOMPATIBLE: ${JSON.stringify(BLOCKED)}`)
      return undefined
    })

    void plugins.enqueue('install', ['a', 'b'], RUNTIME)
    await vi.waitFor(() => expect(plugins.pendingApprovals).toHaveLength(1))

    const blocked = plugins.pendingApprovals[0]
    expect(blocked.name).toBe('b')
    expect(blocked.refusal?.kind).toBe('incompatible')
    expect(plugins.processes.map(process => [process.name, process.status])).toEqual([
      ['a', 'pending'],
      ['b', 'unauthorized'],
    ])

    const results = await plugins.approve('b')

    expect(invoke).toHaveBeenCalledWith('allow_plugin_versions', { versions: BLOCKED })
    expect(invoke.mock.calls.filter(call => call[0] === 'install_plugin_specs')).toHaveLength(2)
    expect(results.map(result => [result.process.name, result.ok])).toEqual([['a', true], ['b', true]])
  })

  it('re-submits only the processes that are still outstanding after a grant', async () => {
    let secondAttempt = 0
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command !== 'disable_dsh_plugin')
        return undefined
      if (args.id === 'a')
        return undefined
      secondAttempt += 1
      if (secondAttempt === 1)
        throw new Error(`PLUGIN_POLICY_BLOCKED: ${JSON.stringify(POLICY)}`)
      return undefined
    })

    void plugins.enqueue('disable', ['a', 'b'], RUNTIME)
    await vi.waitFor(() => expect(plugins.pendingApprovals).toHaveLength(1))

    expect(plugins.processes).toHaveLength(1)
    expect(plugins.processes[0].name).toBe('b')
    expect(plugins.processes[0].refusal?.kind).toBe('policy')

    const results = await plugins.approve('b')

    expect(invoke).toHaveBeenCalledWith('allow_plugin_policy_versions', { versions: POLICY })
    expect(invoke.mock.calls
      .filter(call => call[0] === 'disable_dsh_plugin')
      .map(call => (call[1] as { id: string }).id)).toEqual(['a', 'b', 'b'])
    expect(results.map(result => [result.process.name, result.ok])).toEqual([['a', true], ['b', true]])
  })

  it('fails the group instead of hanging when the refusal names a package outside the submission', async () => {
    const outside = [{ name: 'transitive-dep', version: '0.1.0', runtime_version: '0.2.0-rc.1' }]
    invoke.mockImplementation(async (command: string) => {
      if (command === 'install_plugin_specs')
        throw new Error(`PLUGIN_VERSION_INCOMPATIBLE: ${JSON.stringify(outside)}`)
      return undefined
    })

    const done = plugins.enqueue('install', ['aaa'], RUNTIME)
    const guarded = await Promise.race([
      done,
      new Promise(resolve => setTimeout(resolve, 500, 'hung')),
    ])

    expect(guarded).not.toBe('hung')
    const results = await done
    expect(results.map(result => [result.process.name, result.ok])).toEqual([['aaa', false]])
    expect(plugins.pendingApprovals).toHaveLength(0)
  })

  it('records a cancelled process once even when the interrupted host call settles later', async () => {
    const releases: Array<(error: unknown) => void> = []
    invoke.mockImplementation((command: string) => {
      if (command !== 'install_plugin_specs')
        return Promise.resolve(undefined)
      return new Promise((_resolve, reject) => {
        releases.push(reject)
      })
    })

    const done = plugins.enqueue('install', ['aaa'], RUNTIME)
    await vi.waitFor(() => expect(releases).toHaveLength(1))

    void plugins.cancel()
    await vi.waitFor(() => expect(plugins.processes).toHaveLength(0))

    releases[0](new Error('PREINSTALL_FAILED: killed'))
    const results = await done

    expect(results.map(result => [result.process.name, result.ok, result.reason])).toEqual([
      ['aaa', false, 'cancelled'],
    ])
  })

  it('raises a persistent approval toast per blocked process', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'install_plugin_specs')
        throw new Error(`PLUGIN_VERSION_INCOMPATIBLE: ${JSON.stringify(BLOCKED)}`)
      return undefined
    })
    const done = plugins.enqueue('install', ['b'], { toast: true, restartOnSettle: false })
    await vi.waitFor(() => expect(plugins.pendingApprovals).toHaveLength(1))

    const approval = approvalToast()
    expect(approval?.[1]?.timeout).toBe(0)

    await plugins.cancel()
    await done
    expect(plugins.pendingApprovals).toHaveLength(0)
  })

  it('keeps the process unauthorized when the toast is closed for any reason but dismissal', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'install_plugin_specs')
        throw new Error(`PLUGIN_VERSION_INCOMPATIBLE: ${JSON.stringify(BLOCKED)}`)
      return undefined
    })
    const done = plugins.enqueue('install', ['b'], { toast: true, restartOnSettle: false })
    await vi.waitFor(() => expect(plugins.pendingApprovals).toHaveLength(1))

    approvalToast()?.[1]?.onClose?.('closed')
    await Promise.resolve()
    expect(plugins.pendingApprovals).toHaveLength(1)

    await plugins.cancel()
    const results = await done
    expect(results.map(result => [result.ok, result.reason])).toEqual([[false, 'cancelled']])
  })

  it('rejects the process when the approval toast is dismissed by the user', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'install_plugin_specs')
        throw new Error(`PLUGIN_VERSION_INCOMPATIBLE: ${JSON.stringify(BLOCKED)}`)
      return undefined
    })
    const done = plugins.enqueue('install', ['b'], { toast: true, restartOnSettle: false })
    await vi.waitFor(() => expect(plugins.pendingApprovals).toHaveLength(1))

    approvalToast()?.[1]?.onClose?.('dismissed')

    const results = await done
    expect(results.map(result => [result.process.name, result.ok, result.reason])).toEqual([
      ['b', false, 'rejected'],
    ])
    expect(plugins.pendingApprovals).toHaveLength(0)
    expect(toast.close).toHaveBeenCalled()
    // 拒绝是用户自己的选择：不再补一条「失败」提示追问他。
    expect(
      toast.mock.calls.filter(call => call[1]?.variant === 'danger' && call[1]?.onClose === undefined),
    ).toHaveLength(0)
  })

  it('ignores a refusal that arrives after the user cancelled the group', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'install_plugin_specs')
        return undefined
      await gate
      throw new Error(`PLUGIN_VERSION_INCOMPATIBLE: ${JSON.stringify(BLOCKED)}`)
    })

    const done = plugins.enqueue('install', ['b'], RUNTIME)
    await vi.waitFor(() => expect(invoke.mock.calls.some(call => call[0] === 'install_plugin_specs')).toBe(true))

    await plugins.cancel()
    release?.()

    const results = await done
    expect(results.map(result => [result.process.name, result.ok, result.reason])).toEqual([
      ['b', false, 'cancelled'],
    ])
    // 迟到的拒绝不能给已取消的进程重新挂一个没人点的授权等待，否则整条队列永久卡在 resume 上。
    expect(plugins.pendingApprovals).toHaveLength(0)
    expect(plugins.groups).toHaveLength(0)
  })
})
