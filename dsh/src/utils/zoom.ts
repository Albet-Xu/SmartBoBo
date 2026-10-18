import type { ZoomAction } from '@/store/modules/setting/types'

export interface ZoomShortcutLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** iframe 缩放桥消息：宿主按 `type` 分发（来源由 `useIframeMessage` 的 origin 校验负责）。 */
interface ZoomBridgeMessage {
  type: 'dsh://zoom-shortcut'
  action: ZoomAction
}

export function zoomActionFromShortcut(shortcut: ZoomShortcutLike): ZoomAction | null {
  if ((!shortcut.ctrlKey && !shortcut.metaKey) || shortcut.altKey)
    return null

  if (shortcut.key === '+' || shortcut.key === '=')
    return 'increase'
  if (shortcut.key === '-' || shortcut.key === '_')
    return 'decrease'
  if (shortcut.key === '0')
    return 'reset'
  return null
}

export function zoomActionFromBridgeMessage(value: unknown): ZoomAction | null {
  if (!value || typeof value !== 'object')
    return null

  const message = value as Partial<ZoomBridgeMessage>
  // 不再校验 `source`：宿主侧由 `useIframeMessage` 的 origin 校验保证来源，
  // 这里只认协议类型与动作（iframe 侧脚本仍会带 source 字段，多一个字段无影响）。
  if (message.type !== 'dsh://zoom-shortcut')
    return null
  if (message.action === 'increase' || message.action === 'decrease' || message.action === 'reset')
    return message.action
  return null
}
