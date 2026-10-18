/**
 * register/sidebar-tweaks.ts — 侧边栏 UI 微调（两处，纯样式）：
 *
 * 1. 隐藏官方侧边栏 logo 行自带的「收起侧边栏」按钮 —— 宿主导航栏已有侧边栏开关，
 *    应用内这枚属于重复控件（只匹配折叠态文案，窄栏恢复用的「打开侧边栏」按钮保留）；
 * 2. 品牌词标按钮（与工具栏「新建会话」按钮共用 aria-label）由 flex-start 改为水平居中。
 *
 * 一律用稳定的 aria-label 属性选择器，不用生成的 CSS module 类名：CSS 规则天然覆盖
 * React 后续重渲染，卸载时按同一个 style id 移除。
 */
import { PLUGIN_ID } from '../../shared/constants'
import { NEW_SESSION_SELECTOR } from '../constants'
import { CssRender } from '../modules/css-render'
import { reportPluginError } from '../utils/error'
import { defineRegister } from './index'

/** 官方「收起侧边栏」按钮：只匹配折叠态文案（中英各一条）。 */
const COLLAPSE_SIDEBAR_SELECTOR = 'button[aria-label="收起侧边栏"],button[aria-label="Collapse sidebar"]'

/** 侧边栏微调样式表的挂载 id（卸载时按同一个 id 移除）。 */
const SIDEBAR_TWEAKS_STYLE_ID = 'dsh-tauri:sidebar-tweaks'

export const sidebarTweaksFeature = defineRegister((controller) => {
  try {
    const { c } = CssRender()
    const style = c([
      c(COLLAPSE_SIDEBAR_SELECTOR, { display: 'none !important' }),
      c(NEW_SESSION_SELECTOR, { justifyContent: 'center !important' }),
    ])
    // 必须自报归属：宿主的客户端模块系统会把没有 `data-plugin` 的 <style> 认领给下一个
    // 物化的插件，并在它重载时一并删除（issue #655）。
    style.mount({ id: SIDEBAR_TWEAKS_STYLE_ID, head: true }).setAttribute('data-plugin', PLUGIN_ID)
    controller.add(() => style.unmount({ id: SIDEBAR_TWEAKS_STYLE_ID }))
  }
  catch (error) {
    // 样式挂载失败只是少了两条视觉微调：上报宿主即可，绝不让插件装配失败。
    reportPluginError(error)
  }
})
