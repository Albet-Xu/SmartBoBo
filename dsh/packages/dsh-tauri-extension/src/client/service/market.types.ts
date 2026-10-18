import type { ReactElement } from 'react'

/** `market.render()` 入参：宿主希望面板初始停靠的子区（可带 `:查询串`，未知值被忽略）。 */
export interface MarketRenderProps {
  preferredSubsectionId?: string
}

/**
 * `dshmarket` 经 `ctx.provide('market', …)` 发布的宿主接入面。
 *
 * `version` / `setSettingsVisible` / `settingsVisible` 自 1.47.0 就有；
 * `render`（把市场自己的面板交给宿主渲染）随下一个版本发布，因此能力判据是它，不是 `version`。
 */
export interface MarketFace {
  version: number
  render: (props?: MarketRenderProps) => ReactElement
  setSettingsVisible: (visible: boolean) => void
  settingsVisible: () => boolean
}
