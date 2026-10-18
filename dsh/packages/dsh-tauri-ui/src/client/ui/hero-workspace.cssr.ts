import { cssr } from '../utils/cssr'

const { c } = cssr

const HERO_ROW = '[class$="heroWorkspaceRow"]'

/**
 * 官方 chip 与本插件 chip 共用 aria-label（官方 conversation 词典 `hero.chooseWorkspace`），
 * `:not()` 是两者的唯一区分；`:has()` 保证只在接管 chip 真的挂载后才隐藏官方入口。
 */
const OFFICIAL_CHIP = ['选择工作区', 'Choose workspace']
  .map(label => `${HERO_ROW}:has([data-hero-workspace]) button[aria-label="${label}"]:not([data-hero-workspace])`)
  .join(',')

export const HERO_WORKSPACE_STYLE_ID = 'dsh-tauri-ui-hero-workspace-styles'

/** 全局样式：只压官方英雄区的重复入口；插件自身的 chip 样式写在 `ui/hero-workspace.tsx` 的 className 上。 */
export default c([
  // 官方 chip 只在我们的 chip 真的挂载后隐藏：接管失败（条目崩溃退位）时官方入口原样回来。
  c(OFFICIAL_CHIP, { display: 'none !important' }),
])
