import type { PluginListener } from '@tauri-apps/api/core'
import type { NotificationExtra } from './use-notification-action'
import { onNotificationClicked } from '@choochmeque/tauri-plugin-notifications-api'
import { useEffect, useRef } from 'react'

/** `onNotificationClicked` 的事件体：`data` 就是发送时写进 `extra` 的对象。 */
export interface NotificationClickEvent {
  id?: number
  data?: NotificationExtra
}

/**
 * 订阅「点击通知本体」（`onNotificationClicked`），卸载时自动注销。
 *
 * 这个订阅同时是 Windows 端按钮可用的前提：插件只在有订阅者时才调用
 * `set_click_listener_active(true)`，而 Windows 后端只在那之后才给 toast 挂上
 * `Activated` 回调——只订阅 `useNotificationAction` 会收不到任何通知事件。
 *
 * 语义对齐 `useListen`：回调写入 ref（内联函数不会反复重订阅）；订阅是异步的，
 * 若在 resolve 前组件已卸载则立即注销；失败只记录日志，不打断调用方。
 */
export function useNotificationClicked(handler: (event: NotificationClickEvent) => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    let listener: PluginListener | undefined
    let disposed = false

    void onNotificationClicked((data) => {
      handlerRef.current((data as unknown as NotificationClickEvent | null) ?? {})
    })
      .then((unlisten) => {
        if (disposed)
          void unlisten.unregister()
        else
          listener = unlisten
      })
      .catch(error => console.error('[useNotificationClicked] failed to subscribe:', error))

    return () => {
      disposed = true
      void listener?.unregister()
    }
  }, [])
}
