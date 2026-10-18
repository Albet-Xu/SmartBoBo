import type { NativeNotificationInput } from '../types'

/**
 * 宿主窗口补丁读取的 actions 项（`{ action, title, … }`，见 `NOTIFICATION_SHIM_JS`）。
 *
 * `input` / `inputPlaceholder` / `inputButtonTitle` 由补丁原样透传给宿主：Windows 用它们
 * 声明 toast 的 `<input>` 文本框，其他平台忽略。
 */
interface ShimAction {
  action: string
  title: string
  input?: boolean
  inputPlaceholder?: string
  inputButtonTitle?: string
}

interface ShimNotificationOptions {
  body?: string
  tag?: string
  sessionId?: string
  requireInteraction?: boolean
  /** Windows：置 true 让 toast 自己保持静音（提示音由帧内播放，见 `NativeNotificationInput.silent`）。 */
  silent?: boolean
  actions?: ShimAction[]
}

/** 宿主补丁回调 `onaction` 时给出的事件体。 */
interface ShimActionEvent {
  action?: string
  /** 带输入框的按钮：用户填的文本；没填时宿主给空串。 */
  inputValue?: string | null
}

/** 宿主补丁替换过的 Notification 额外带回调属性（标准 Notification 没有 `onaction`）。 */
interface ShimNotification {
  onclick: ((event: Event) => void) | null
  onaction?: ((event: ShimActionEvent) => void) | null
}

/**
 * 弹一条原生通知，并接住它的点击与按钮回调。
 *
 * 不直接 `invoke` Tauri 命令，而是走宿主窗口注入的 `window.Notification` 补丁：
 * 补丁把构造参数 postMessage 给宿主窗口（`dsh://native-notification`），宿主再调
 * `tauri-plugin-notifications` 发原生通知；等通知被点击（`onclick`）或按下按钮
 * （`onaction`）时，宿主通过 `dsh://notification-clicked` 回灌并回调本对象。
 */
export function showNativeNotification(input: NativeNotificationInput): void {
  if (typeof Notification === 'undefined')
    return
  const options: ShimNotificationOptions = {
    body: input.body,
    tag: input.tag,
    sessionId: input.sessionId,
    requireInteraction: input.requireInteraction ?? false,
    silent: input.silent ?? false,
  }
  if (input.actions && input.actions.length > 0) {
    options.actions = input.actions.map((action) => {
      const shim: ShimAction = { action: action.id, title: action.title }
      if (action.input) {
        shim.input = true
        if (action.inputPlaceholder)
          shim.inputPlaceholder = action.inputPlaceholder
        if (action.inputButtonTitle)
          shim.inputButtonTitle = action.inputButtonTitle
      }
      return shim
    })
  }
  const notification = new Notification(input.title, options as unknown as NotificationOptions) as Notification & ShimNotification
  notification.onclick = () => {
    input.onClick?.()
  }
  if (input.onAction) {
    notification.onaction = (event) => {
      const value = event?.inputValue
      input.onAction?.(String(event?.action ?? ''), typeof value === 'string' && value.length > 0 ? value : null)
    }
  }
}
