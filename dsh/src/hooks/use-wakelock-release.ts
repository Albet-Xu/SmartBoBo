import { useWakeLock, useWatch } from '@reause/core'

export function useWakelockRelease(): void {
  const wakelock = useWakeLock()
  useWatch(wakelock.isActive, () => {
    void wakelock.release()
  }, { immediate: true })
}
