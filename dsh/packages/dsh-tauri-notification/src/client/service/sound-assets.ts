import type { BuiltinNotificationSound } from '../types'
import { PLUGIN_ID } from '../../shared/constants'

/**
 * 内置提示音资源（`public/notification.wav`、`public/classic.wav`）。
 *
 * 插件客户端跑在 DSH 的 iframe 里，与桌面壳层的 `public/` 不同源，直接
 * `new Audio('/notification.wav')` 只会 404；壳层读成 data URL 后按下面的协议送进来，
 * 这里只负责缓存与补齐。
 *
 * 协议（与 `src/layout/components/iframe.tsx` 的通知桥一致）：
 * - iframe → 壳层：`{ type: 'dsh://notification-sounds:request' }`
 * - 壳层 → iframe：`{ type: 'dsh://notification-sounds', sounds: { default, classic } }`
 */
export const SOUNDS_REQUEST_MESSAGE = 'dsh://notification-sounds:request'
export const SOUNDS_MESSAGE = 'dsh://notification-sounds'

/** 内置音效 id（`NotificationSound` 里除 `none` / `custom` 之外的两项）。 */
const BUILTIN_KEYS: readonly BuiltinNotificationSound[] = ['default', 'classic']

const assets = new Map<BuiltinNotificationSound, string>()
let listening = false

/** 只认音频 data URL：桥消息一律按不可信输入处理。 */
function isAudioDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:audio/')
}

/** 记录壳层送来的音效，返回是否至少认出一条。 */
function setBuiltinSounds(sources: unknown): boolean {
  if (sources === null || typeof sources !== 'object')
    return false
  const record = sources as Record<string, unknown>
  let filled = false
  for (const key of BUILTIN_KEYS) {
    const source = record[key]
    if (isAudioDataUrl(source)) {
      assets.set(key, source)
      filled = true
    }
  }
  return filled
}

/** 内置音效的 data URL；壳层还没送到时为 `undefined`，调用方退回合成音。 */
export function builtinSound(sound: BuiltinNotificationSound): string | undefined {
  return assets.get(sound)
}

/** 监听壳层推送的音效（幂等，注册一次即可）。 */
export function listenBuiltinSounds(): void {
  if (listening || typeof window === 'undefined')
    return
  listening = true
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown, sounds?: unknown } | null
    if (!data || typeof data !== 'object' || data.type !== SOUNDS_MESSAGE)
      return
    setBuiltinSounds(data.sounds)
  })
}

/**
 * 向壳层索要内置音效。
 *
 * 拿不到时静默返回：帧内会退回合成音，通知本身不受影响。
 */
export function requestBuiltinSounds(): void {
  if (typeof window === 'undefined' || window.parent === window)
    return
  listenBuiltinSounds()
  try {
    window.parent.postMessage({ source: 'dsh-notification-bridge', type: SOUNDS_REQUEST_MESSAGE }, '*')
  }
  catch (error) {
    console.warn(`[${PLUGIN_ID}] failed to request notification sounds`, error)
  }
}
