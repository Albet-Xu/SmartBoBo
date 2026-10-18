/** 缩放动作（与宿主 `src/utils/zoom.ts` 的 `ZoomAction` 同口径）。 */
export type ZoomAction = 'increase' | 'decrease' | 'reset'

/** 快捷键形态：只取判定所需字段，便于单测直接构造。 */
export interface ZoomShortcutLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/**
 * 缩放快捷键 → 动作：Ctrl/Cmd + `+` / `=` / `-` / `_` / `0`（Alt 组合不处理）。
 *
 * 与宿主 `src/utils/zoom.ts` 的 `zoomActionFromShortcut` 保持同一口径：同一组按键
 * 在壳层焦点与 iframe 焦点下都必须解析成同一动作，判定漂移会让两端行为不一致。
 */
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
