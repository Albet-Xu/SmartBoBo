import { PLUGIN_ID } from '../../shared/constants'

export const LOCALE_EFFECT = `${PLUGIN_ID}: locale dictionaries`

export const STYLES_EFFECT = `${PLUGIN_ID}: page styles`

export const MODELS_PAGE_EFFECT = `${PLUGIN_ID}: models page`

/** 面板样式标签 id，避免热更新重复挂载同一条样式。 */
export const STYLES_ID = `${PLUGIN_ID}-models-styles`

/** 布局覆盖样式的标签 id，与逐字对应上游的生成样式分开挂载。 */
export const OVERRIDES_STYLE_ID = `${PLUGIN_ID}-models-style-overrides`
