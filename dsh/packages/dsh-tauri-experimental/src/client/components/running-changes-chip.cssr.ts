import { cssr } from 'dsh-tauri-ui/client'

const { bem: { b, e } } = cssr

/**
 * 运行中提示条（running-changes-chip.tsx）：输入框正上方居中的胶囊
 * 「N 个文件已更改 +x -y」，turn 结束后消失（官方同款位置与形态）。
 */
export default b('running-changes', {
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  margin: '0 0 6px',
  // 外层不拦点击：提示条是过程态信息，不该挡住上方内容或输入框。
  pointerEvents: 'none',
}, [
  e('chip', {
    pointerEvents: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    height: '28px',
    padding: '0 11px',
    border: '1px solid var(--dsw-alias-border-weak, rgba(127,127,127,0.2))',
    borderRadius: '10px',
    background: 'var(--dsw-alias-bg-base, #fff)',
    boxShadow: 'var(--dsw-shadow-lv2, 0 1px 3px rgba(0,0,0,0.06))',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: '13px',
    lineHeight: '18px',
    whiteSpace: 'nowrap',
  }),
  e('label', { color: 'var(--dsw-alias-label-primary)' }),
])
