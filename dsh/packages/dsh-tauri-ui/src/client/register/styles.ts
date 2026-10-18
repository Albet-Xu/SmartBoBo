import type { ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import globalStyle, { GLOBAL_STYLE_ID } from '../styles/global.cssr'
import taiwindcss from '../styles/index'
import heroWorkspaceStyle, { HERO_WORKSPACE_STYLE_ID } from '../ui/hero-workspace.cssr'
import { mountStyle } from '../utils/style'

/** 生成的 Tailwind 产物（`scripts/taiwindcss.ts`），由 UI 包自己挂载，避免跨插件重载被回收。 */
const TAILWIND_STYLE_ID = 'dsh-tauri-ui-tailwind-styles'

export const registerStyles = defineRegister<ClientContext>((controller) => {
  controller.add(mountStyle(taiwindcss, TAILWIND_STYLE_ID))
  controller.add(mountStyle(globalStyle, GLOBAL_STYLE_ID))
  controller.add(mountStyle(heroWorkspaceStyle, HERO_WORKSPACE_STYLE_ID))
})
