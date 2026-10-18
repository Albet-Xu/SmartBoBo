import type {
  Plugin,
  PluginManagerLog,
  PluginProcess,
  PluginProcessResult,
  PluginRef,
  PluginSearchResult,
  PluginsManagerRuntime,
} from '@/store/modules/plugins'
import type { PluginsManagerEvent, PluginsManagerEventMap } from '@/store/modules/plugins/events'
import type { DshPlugin } from '@/types'
import { useMount, useWatch } from '@reause/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from 'valtio-define'
import { queryKeys } from '@/config/query-keys'
import { useListen } from '@/hooks/use-listen'
import { plugins } from '@/store/modules/plugins'

export interface UseDshPluginsManagerOptions {
  toast?: boolean
  restartOnSettle?: boolean
}

export interface UseDshPluginsManagerResult {
  installed: Plugin[]
  processes: PluginProcess[]
  pendingApprovals: PluginProcess[]
  logs: PluginManagerLog[]
  loading: boolean
  cancelling: boolean
  error: string
  refresh: () => Promise<void>
  setInstalled: (list: DshPlugin[]) => void
  install: (refs: PluginRef | PluginRef[]) => Promise<PluginProcessResult[]>
  upgrade: (refs: PluginRef | PluginRef[]) => Promise<PluginProcessResult[]>
  uninstall: (refs: PluginRef | PluginRef[]) => Promise<PluginProcessResult[]>
  disable: (refs: PluginRef | PluginRef[]) => Promise<PluginProcessResult[]>
  enable: (
    refs: PluginRef | PluginRef[],
    options?: { clearConfigOverride?: boolean },
  ) => Promise<PluginProcessResult[]>
  approve: (refs?: PluginRef | PluginRef[]) => Promise<PluginProcessResult[]>
  reject: (ref: PluginRef) => Promise<PluginProcessResult[]>
  cancel: () => Promise<void>
  search: (refs: PluginRef | PluginRef[], options?: { dsh?: string }) => Promise<PluginSearchResult[]>
  on: (
    event: PluginsManagerEvent,
    handler: (payload: PluginsManagerEventMap[PluginsManagerEvent]) => void,
  ) => () => void
}

export function useDshPluginsManager(options: UseDshPluginsManagerOptions = {}): UseDshPluginsManagerResult {
  const runtime: PluginsManagerRuntime = {
    toast: options.toast ?? true,
    restartOnSettle: options.restartOnSettle ?? true,
  }
  const snapshot = useStore(plugins)
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.plugins,
    queryFn: () => invoke<DshPlugin[]>('get_dsh_plugins'),
  })

  async function run(
    type: 'install' | 'upgrade' | 'uninstall' | 'disable' | 'enable',
    refs: PluginRef | PluginRef[],
    enableOptions?: { clearConfigOverride?: boolean },
  ): Promise<PluginProcessResult[]> {
    const results = await plugins.enqueue(type, refs, {
      ...runtime,
      clearConfigOverride: enableOptions?.clearConfigOverride ?? runtime.clearConfigOverride ?? false,
    })
    void queryClient.invalidateQueries({ queryKey: queryKeys.plugins })
    return results
  }

  useWatch(
    [data],
    () => {
      if (data)
        plugins.setInstalled(data)
    },
    { immediate: true },
  )

  useMount(() => {
    void plugins.refresh()
  })
  useListen<{ line: string }>('preinstall-log', (event) => {
    plugins.setProgressDetail(event.payload.line)
  })

  function on<K extends PluginsManagerEvent>(
    event: K,
    handler: (payload: PluginsManagerEventMap[K]) => void,
  ): () => void {
    return plugins.on(event, handler)
  }

  return {
    installed: [...snapshot.installed],
    processes: [...snapshot.processes] as PluginProcess[],
    pendingApprovals: [...snapshot.pendingApprovals] as PluginProcess[],
    logs: [...snapshot.logs],
    loading: isLoading,
    cancelling: snapshot.cancelling,
    error: error ? String(error) : '',
    refresh: async () => {
      await plugins.refresh()
    },
    setInstalled: list => plugins.setInstalled(list),
    install: refs => run('install', refs),
    upgrade: refs => run('upgrade', refs),
    uninstall: refs => run('uninstall', refs),
    disable: refs => run('disable', refs),
    enable: (refs, enableOptions) => run('enable', refs, enableOptions),
    approve: refs => plugins.approve(refs),
    reject: ref => plugins.reject(ref),
    cancel: () => plugins.cancel(),
    search: (refs, searchOptions) => plugins.search(refs, searchOptions),
    on,
  }
}
