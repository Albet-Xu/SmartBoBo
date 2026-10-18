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

const { normalizeRef, normalizeRefs, plugins } = await import('../src/store/modules/plugins')

const RUNTIME = { toast: false, restartOnSettle: false }

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

describe('plugins manager ref normalization', () => {
  it('normalizes bare names, declared ranges, explicit versions and scoped packages', () => {
    expect(normalizeRef('aaa')).toEqual({ spec: 'aaa', name: 'aaa' })
    expect(normalizeRef('  aaa  ')).toEqual({ spec: 'aaa', name: 'aaa' })
    expect(normalizeRef('aaa@^1.2.0')).toEqual({ spec: 'aaa@^1.2.0', name: 'aaa', version: '^1.2.0' })
    expect(normalizeRef({ spec: 'aaa', version: '1.2.3' })).toEqual({
      spec: 'aaa@1.2.3',
      name: 'aaa',
      version: '1.2.3',
    })
    expect(normalizeRef({ spec: 'aaa@1.0.0', version: '2.0.0' })).toEqual({
      spec: 'aaa@2.0.0',
      name: 'aaa',
      version: '2.0.0',
    })
    expect(normalizeRef('@scope/pkg@1.0.0')).toEqual({
      spec: '@scope/pkg@1.0.0',
      name: '@scope/pkg',
      version: '1.0.0',
    })
    expect(normalizeRef('@scope/pkg')).toEqual({ spec: '@scope/pkg', name: '@scope/pkg' })
  })

  it('rejects illegal refs synchronously, before any host call', () => {
    expect(() => normalizeRef('')).toThrow('PLUGIN_REF_INVALID')
    expect(() => normalizeRef('   ')).toThrow('PLUGIN_REF_INVALID')
    expect(() => normalizeRefs([])).toThrow('PLUGIN_REFS_EMPTY')
    expect(() => plugins.enqueue('install', [], RUNTIME)).toThrow('PLUGIN_REFS_EMPTY')
    expect(() => plugins.enqueue('install', ['   '], RUNTIME)).toThrow('PLUGIN_REF_INVALID')
    expect(invoke).not.toHaveBeenCalled()
    expect(plugins.processes).toEqual([])
  })

  it('collapses a single ref into a one element group', () => {
    expect(normalizeRefs('aaa')).toEqual([{ spec: 'aaa', name: 'aaa' }])
    expect(normalizeRefs(['aaa', 'bbb@2.0.0'])).toEqual([
      { spec: 'aaa', name: 'aaa' },
      { spec: 'bbb@2.0.0', name: 'bbb', version: '2.0.0' },
    ])
  })
})

describe('plugins manager idempotency', () => {
  it('reports an uninstall of an absent plugin as already absent without calling the host', async () => {
    plugins.setInstalled([])

    const results = await plugins.enqueue('uninstall', ['ghost'], RUNTIME)

    expect(invoke).not.toHaveBeenCalled()
    expect(results.map(result => [result.process.name, result.ok, result.reason])).toEqual([
      ['ghost', false, 'already-absent'],
    ])
  })

  it('sends an upgrade of an unknown plugin to the host instead of pre-skipping it', async () => {
    plugins.setInstalled([])

    const results = await plugins.enqueue('upgrade', ['ghost'], RUNTIME)

    expect(invoke).toHaveBeenCalledWith('update_dsh_plugins', { ids: ['ghost'] })
    expect(results.map(result => [result.ok, result.reason])).toEqual([[true, undefined]])
  })

  it('routes a broken plugin through the upgrade repair path despite having no update', async () => {
    plugins.setInstalled([
      {
        id: 'aaa',
        name: 'aaa',
        version: '1.0.0',
        description: '',
        repo_url: '',
        bundled: false,
        disabled: false,
        patchDisabled: false,
        recommended: false,
        fix: false,
        internal: false,
        updateAvailable: false,
        hasSnapshot: false,
        error: { message: 'boom', action: 'runtime', at: '1' },
      },
    ])
    invoke.mockResolvedValue(undefined)

    const results = await plugins.enqueue('upgrade', ['aaa'], RUNTIME)

    expect(invoke).toHaveBeenCalledWith('update_dsh_plugins', { ids: ['aaa'] })
    expect(results.map(result => [result.process.name, result.ok])).toEqual([['aaa', true]])
  })

  it('passes the target version the panel is showing to the host', async () => {
    plugins.setInstalled([
      {
        id: 'aaa',
        name: 'aaa',
        version: '1.0.0',
        description: '',
        repo_url: '',
        bundled: false,
        disabled: false,
        patchDisabled: false,
        recommended: false,
        fix: false,
        internal: false,
        updateAvailable: true,
        hasSnapshot: false,
        error: null,
      },
    ])
    invoke.mockResolvedValue(undefined)

    await plugins.enqueue('upgrade', [{ spec: 'aaa', version: '2.0.0' }], RUNTIME)

    expect(invoke).toHaveBeenCalledWith('update_dsh_plugins', { ids: ['aaa@2.0.0'] })
  })

  it('hands every clicked upgrade to the host even when the local snapshot says there is no update', async () => {
    // 面板点得动的插件必须交给宿主：本地快照（`installedSource`）可能刚被安装/刷新改过，按它判
    // 「没有更新」会把点击悄悄丢掉——用户只看到「1 个成功」，别的插件毫无动静。
    plugins.setInstalled(
      ['aaa', 'bbb', 'ccc'].map(name => ({
        id: name,
        name,
        version: '1.0.0',
        description: '',
        repo_url: '',
        bundled: false,
        disabled: false,
        patchDisabled: false,
        recommended: false,
        fix: false,
        internal: false,
        updateAvailable: false,
        hasSnapshot: false,
        error: null,
      })),
    )
    invoke.mockResolvedValue(undefined)

    const results = await plugins.enqueue('upgrade', ['aaa', 'bbb', 'ccc'], RUNTIME)

    expect(invoke).toHaveBeenCalledWith('update_dsh_plugins', { ids: ['aaa', 'bbb', 'ccc'] })
    expect(results.map(result => [result.process.name, result.ok])).toEqual([
      ['aaa', true],
      ['bbb', true],
      ['ccc', true],
    ])
  })

  it('reports a disable of an already disabled plugin as already absent', async () => {
    plugins.setInstalled([
      {
        id: 'aaa',
        name: 'aaa',
        version: '1.0.0',
        description: '',
        repo_url: '',
        bundled: false,
        disabled: true,
        patchDisabled: false,
        recommended: false,
        fix: false,
        internal: false,
        updateAvailable: false,
        hasSnapshot: false,
        error: null,
      },
    ])

    const results = await plugins.enqueue('disable', ['aaa'], RUNTIME)

    expect(invoke).not.toHaveBeenCalled()
    expect(results.map(result => [result.ok, result.reason])).toEqual([[false, 'already-absent']])
  })
})

describe('plugins manager search', () => {
  it('degrades to a network problem when the compatibility probe fails', async () => {
    invoke.mockRejectedValue('NETWORK_DOWN: offline')

    const results = await plugins.search(['aaa', { spec: 'bbb', version: '1.0.0' }])

    expect(invoke).toHaveBeenCalledWith('inspect_plugin_specs', {
      specs: ['aaa', 'bbb@1.0.0'],
      dsh: null,
    })
    expect(results).toEqual([
      { spec: 'aaa', compatible: null, problem: 'network' },
      { spec: 'bbb@1.0.0', compatible: null, problem: 'network' },
    ])
  })

  it('forwards the runtime version override and normalizes the probe result', async () => {
    invoke.mockResolvedValue([
      { spec: 'aaa', name: 'aaa', version: '1.2.3', compatible: true, peers: { '@deepseek-ai/dsh': '^0.2.0' } },
    ])

    const results = await plugins.search('aaa', { dsh: '0.2.0' })

    expect(invoke).toHaveBeenCalledWith('inspect_plugin_specs', { specs: ['aaa'], dsh: '0.2.0' })
    expect(results).toEqual([
      {
        spec: 'aaa',
        name: 'aaa',
        version: '1.2.3',
        compatible: true,
        peers: { '@deepseek-ai/dsh': '^0.2.0' },
        problem: undefined,
      },
    ])
  })
})
