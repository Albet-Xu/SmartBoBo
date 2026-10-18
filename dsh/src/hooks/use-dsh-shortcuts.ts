import { createGlobalState } from '@reause/core'

/** 核心回报的一行快捷键目录（`dsh-tauri` 的 `dsh://shortcuts` 投影）。 */
export interface DshShortcutRow {
  id: string
  label: string
  keys: readonly string[]
  aria?: string
  available?: boolean
}

export const DSH_VIEW_COMMANDS = [
  { action: 'desktop-toggle-sidebar', command: 'sidebar.left.toggle', label: 'menu.toggle_sidebar' },
  { action: 'desktop-toggle-right-panel', command: 'sidebar.right.toggle', label: 'menu.toggle_right_panel' },
  { action: 'desktop-open-terminal', command: 'terminal.new', label: 'menu.open_terminal' },
  { action: 'desktop-search-chats', command: 'session.search', label: 'menu.search_chats' },
] as const

export type DshViewCommand = typeof DSH_VIEW_COMMANDS[number]['command']

export const useDshShortcuts = createGlobalState<{ rows: readonly DshShortcutRow[] }>({ rows: [] })

/**
 * 菜单项右侧的按键提示：按命令 id 取键位文本，未注册（老核心 / 用户清空）即不显示。
 *
 * 只显示 dsh 应用真的会响应的绑定（`session.new`、`workspace.add`、`settings.open`…），
 * 壳层自己没实现的动作不留假提示。
 */
export function shortcutHint(rows: readonly DshShortcutRow[], id: string): string | undefined {
  const keys = rows.find(row => row.id === id)?.keys
  const text = keys?.join(' ')
  return text === undefined || text.length === 0 ? undefined : text
}
