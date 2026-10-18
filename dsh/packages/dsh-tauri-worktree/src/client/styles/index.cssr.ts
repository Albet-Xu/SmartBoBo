import { cssr } from 'dsh-tauri-ui/client'
import { SESSION_ICON_ATTRIBUTE } from '../constants'

const { c } = cssr

// 全局样式：只压官方会话树（`[role="treeitem"]`）里我们自己插入的图标座位，
// 不涉及本插件的任何组件标记，因此保留 cssr；组件自身样式一律写在组件的 `className` 上。
export default c([
  c(`[${SESSION_ICON_ATTRIBUTE}]`, {
    width: '16px',
    height: '20px',
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: '2px',
    color: 'var(--dsw-alias-label-secondary)',
  }),
  c('[role="treeitem"]', { position: 'relative' }),
  c(`[role="treeitem"]:hover [${SESSION_ICON_ATTRIBUTE}]`, { visibility: 'hidden' }),
])
