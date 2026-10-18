import type { ReactNode } from 'react'

/**
 * dsh-im 客户端反射服务（4.22.0 起经 `ctx.provide('dshImClient', ...)` 发布）。
 *
 * `render()` 每次返回新 element（完整管理面板，含语言刷新与局部错误保护），
 * `setSettingsVisible()` 只影响当前客户端内存中的「设置 → IM机器人」入口。
 */
export interface DshImClient {
  readonly version: number
  render: (props?: { preferredSectionId?: string }) => ReactNode
  setSettingsVisible: (visible: boolean) => void
  settingsVisible: () => boolean
}
