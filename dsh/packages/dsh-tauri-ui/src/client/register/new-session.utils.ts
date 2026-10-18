import { NEW_SESSION_LABELS, UNGROUPED_NEW_SESSION_LABELS, UNGROUPED_ROW_KEY } from '../constants'

/** 官方侧边栏「新建会话」按钮的 aria-label 判据（品牌按钮与工具栏按钮共用同一条文案）。 */
export function isNewSessionLabel(label: string | null): boolean {
  return label !== null && (NEW_SESSION_LABELS as readonly string[]).includes(label)
}

/** 官方工作区分组行的「+」用带工作区名字的文案，不在判据内，因此行为不受拦截影响。 */
export function newSessionButtonFrom(target: unknown): Element | null {
  if (!(target instanceof Element))
    return null
  const button = target.closest('button[aria-label]')
  return button !== null && isNewSessionLabel(button.getAttribute('aria-label')) ? button : null
}

/** 官方「未分组」分组行「+」的 aria-label 判据（仅 ≤0.1.6 需要，见 `ungroupedCreateButtonFrom`）。 */
export function isUngroupedNewSessionLabel(label: string | null): boolean {
  return label !== null && (UNGROUPED_NEW_SESSION_LABELS as readonly string[]).includes(label)
}

/**
 * 官方「未分组」分组行的「+」按钮。
 *
 * 官方 `onCreate` 在未分组桶（`group.workspaceId === undefined`）里是空实现，点击没有任何
 * 效果；这里把该按钮识别出来，交给与侧边栏「新建会话」相同的未分组开会话路径。
 *
 * 0.1.7 起分组行带 `data-row-key`（未分组桶的行键为 `workspace:`），按行键判定最稳且与语言
 * 无关；≤0.1.6 没有该属性，退化为官方词典里的「未分组」新建会话文案。
 */
export function ungroupedCreateButtonFrom(target: unknown): Element | null {
  if (!(target instanceof Element))
    return null
  const button = target.closest('button[aria-label]')
  if (button === null)
    return null
  const row = button.closest('[data-row-key]')
  if (row !== null)
    return row.getAttribute('data-row-key') === UNGROUPED_ROW_KEY ? button : null
  return isUngroupedNewSessionLabel(button.getAttribute('aria-label')) ? button : null
}
