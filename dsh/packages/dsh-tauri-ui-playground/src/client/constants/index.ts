import { PLUGIN_ID } from '../../shared/constants'

/** 面板 id / 顺序 / 样式挂载 id 沿用原 dsh-tauri-ui 取值：调试入口的位置与样式不随搬家改变。 */
export const UI_COMPONENTS_PANEL_ID = 'dsh-tauri-ui-components'
export const UI_COMPONENTS_PANEL_ORDER = 50
export const UI_COMPONENTS_STYLE_ID = 'dsh-tauri-ui-components-styles'

export const LOCALE_EFFECT = `${PLUGIN_ID}: locale`
export const UI_COMPONENTS_EFFECT = `${PLUGIN_ID}: ui components panel`
