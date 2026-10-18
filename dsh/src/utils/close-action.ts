export type CloseAction = 'tray' | 'quit'

export const CLOSE_ACTION_OPTIONS = ['tray', 'quit'] as const satisfies readonly CloseAction[]

// 只认 Rust 侧 `normalize_close_action` 白名单里的两个字面量，不做 trim / 大小写
// 折叠，避免两端语义漂移；非法值的最终判定责任仍在后端，这里只是收敛下发值。
export function normalizeCloseAction(value: unknown): CloseAction {
  return value === 'quit' ? 'quit' : 'tray'
}
