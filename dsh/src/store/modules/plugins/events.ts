import type { PluginProcess, PluginProcessResult } from './types'
import { createEventHook } from '@reause/core'

export interface PluginsManagerEventMap {
  completed: PluginProcessResult[]
  allcompleted: PluginProcessResult[]
  error: PluginProcessResult[]
  approve: PluginProcess
}

export type PluginsManagerEvent = keyof PluginsManagerEventMap

const hooks = {
  completed: createEventHook<PluginProcessResult[]>(),
  allcompleted: createEventHook<PluginProcessResult[]>(),
  error: createEventHook<PluginProcessResult[]>(),
  approve: createEventHook<PluginProcess>(),
}

type Trigger<K extends PluginsManagerEvent> = (payload: PluginsManagerEventMap[K]) => void
type Subscribe<K extends PluginsManagerEvent> = (handler: (payload: PluginsManagerEventMap[K]) => void) => () => void

export function triggerPluginsManagerEvent<K extends PluginsManagerEvent>(
  event: K,
  payload: PluginsManagerEventMap[K],
): void {
  ;(hooks[event] as unknown as { trigger: Trigger<K> }).trigger(payload)
}

export function onPluginsManagerEvent<K extends PluginsManagerEvent>(
  event: K,
  handler: (payload: PluginsManagerEventMap[K]) => void,
): () => void {
  return (hooks[event] as unknown as { on: Subscribe<K> }).on(handler)
}
