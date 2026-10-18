export interface SettingsUiState {
  open: boolean
  activeId: string | undefined
  query: string
  railWidth: number | undefined
  /**
   * 官方 `settings.launcher` 座位是否已声明（官方条目在注册时声明，早于本插件时装好）。
   * 未声明（更老核心）时触发器渲染自有按钮——`SlotOutlet` 对未声明的槽位返回空，绝不能让
   * 设置入口消失。
   */
  launcherAvailable: boolean
  /**
   * 官方 `settings.open` 命令的生效按键：rc.2 起官方启动器座位渲染「Ctrl+,」提示。
   * 核心没有快捷键服务（老核心）或该命令未注册时为 undefined，座位拿不到就不显示提示。
   */
  launcherShortcut: { keys: readonly string[], aria?: string } | undefined
}

export type SettingsUiKey = 'back' | 'search' | 'settings' | 'noResults'
