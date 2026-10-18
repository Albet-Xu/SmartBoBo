import { cssr } from 'dsh-tauri-ui/client'

const { bem: { b, e } } = cssr

/**
 * 变更计数（绿色 +N / 红色 -M）的共享样式。
 *
 * 「运行中」提示条渲染这组计数（官方 deliverables 行也是这个配色），
 * 组件面无差异，故按仓库约定放在 `client/styles/`。
 */
export default b('change-counts', {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: '6px',
  fontVariantNumeric: 'tabular-nums',
}, [
  e('add', { color: 'var(--dsw-alias-state-success-primary, #2f9e44)' }),
  e('del', { color: 'var(--dsw-alias-state-error-primary, #d93025)' }),
  e('binary', { color: 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary))' }),
])
