/* eslint-disable react/exhaustive-deps */
import { useIntervalFn } from '@reause/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { useIframePost } from './use-iframe-post'

const VISIBILITY_POLL_INTERVAL = 5000
const appWindow = getCurrentWindow()

export function useSyncVisibility(iframeRef: React.RefObject<HTMLIFrameElement | null>) {
  const post = useIframePost(iframeRef)

  function syncVisibility() {
    void (async () => {
      try {
        const appWindow = getCurrentWindow()
        const [minimized, visible, focused] = await Promise.all([
          appWindow.isMinimized(),
          appWindow.isVisible(),
          appWindow.isFocused(),
        ])
        // 未聚焦也必须算后台：窗口还开着但用户切去别的应用时，只看 visible
        // 会把「仅未聚焦时通知」直接判成前台，会话就再也收不到完成提醒。
        post({ type: 'dsh://visibility-state', hidden: minimized || !visible || !focused })
      }
      catch (error) {
        console.error('[notification] sync visibility failed:', error)
      }
    })()
  }

  // 窗口焦点/尺寸变化时即时同步可见性（Tauri 窗口事件非 `listen`，保留 effect 承担注销）
  useEffect(() => {
    let disposed = false
    let unlisteners: Array<() => void> = []
    void (async () => {
      try {
        syncVisibility()
        const unFocus = await appWindow.onFocusChanged(() => {
          void syncVisibility()
        })
        const unResized = await appWindow.onResized(() => {
          void syncVisibility()
        })
        // 订阅完成前若已卸载则立即释放，避免回调泄漏
        if (disposed) {
          unFocus()
          unResized()
        }
        else {
          unlisteners = [unFocus, unResized]
        }
      }
      catch (error) {
        console.error('[notification] visibility listeners failed:', error)
      }
    })()
    return () => {
      disposed = true
      unlisteners.forEach(fn => fn())
    }
  }, [])

  // 兜底轮询：覆盖监听不到的状态变化（如任务栏切换）；主路径是窗口焦点/尺寸事件
  useIntervalFn(syncVisibility, VISIBILITY_POLL_INTERVAL)
}
