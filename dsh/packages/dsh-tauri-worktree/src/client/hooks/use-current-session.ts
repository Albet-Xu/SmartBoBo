import type { SessionsRuntime } from '../service/session-switch.types'
import { useCallback, useSyncExternalStore } from 'react'

/** 订阅适配层的会话列表投影，读出当前选中会话（0.1.6 起由适配层把 `current` 投影回列表快照）。 */
export function useCurrentSession(sessions: Pick<SessionsRuntime, 'list'>): string | undefined {
  const subscribe = useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions])
  const getSnapshot = useCallback(() => sessions.list.getSnapshot().current, [sessions])
  return useSyncExternalStore(subscribe, getSnapshot)
}
