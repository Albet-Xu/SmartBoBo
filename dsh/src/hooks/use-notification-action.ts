import type { PluginListener } from '@tauri-apps/api/core'
import { onAction } from '@choochmeque/tauri-plugin-notifications-api'
import { useEffect, useRef } from 'react'

/** 发送通知时写进 `extra` 的会话标识：点击 / 按钮事件原样带回，用于定位到会话。 */
export interface NotificationExtra {
  sessionId?: string
  title?: string
  tag?: string
}

/**
 * `onAction` 的事件体：`actionId` 为 `'tap'` 表示点了通知本体，否则是按钮的 action id。
 * 带输入框的按钮另外把用户输入放在 `inputValue`（vender 补丁让按钮的 arguments 携带
 * JSON，冷启动也能带回 `extra`）。
 *
 * `extra` 才是定位会话的唯一可靠来源：`notification` 只是应用内（热）激活时的通知快照，
 * 进程外 COM 激活（点通知栏里的历史通知）拿到的事件里它是 `null`。
 */
export interface NotificationActionEvent {
  actionId?: string
  /** 带输入框的按钮：用户在系统通知文本框里填的内容。 */
  inputValue?: string | null
  /** 会话标识：与发送时写进通知 `extra` 的内容一致，两条激活通路都会带回。 */
  extra?: NotificationExtra | null
  notification?: { extra?: NotificationExtra } | null
}

/**
 * 订阅系统通知的按钮动作（`onAction`），卸载时自动注销。
 *
 * 语义对齐 `useListen`：
 * - 回调在渲染期写入 ref（同款「latest ref」），调用方传内联函数不会反复重订阅；
 * - 竞态防护：订阅是异步的，若在 resolve 前组件已卸载则立即注销，避免监听泄漏；
 * - 订阅失败（非 Tauri 环境等）只记录日志，不打断调用方。
 */
export function useNotificationAction(handler: (event: NotificationActionEvent) => void): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    let listener: PluginListener | undefined
    let disposed = false

    void onAction((payload) => {
      handlerRef.current((payload as unknown as NotificationActionEvent | null) ?? {})
    })
      .then((unlisten) => {
        if (disposed)
          void unlisten.unregister()
        else
          listener = unlisten
      })
      .catch(error => console.error('[useNotificationAction] failed to subscribe:', error))

    return () => {
      disposed = true
      void listener?.unregister()
    }
  }, [])
}
