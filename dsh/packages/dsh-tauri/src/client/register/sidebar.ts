/**
 * register/sidebar.ts — 侧边栏桥（宿主导航栏 ↔ iframe），两个方向各一件事：
 *
 * - 宿主 → iframe：导航栏开关把 `dsh://sidebar:toggle` 发进来，用 dsh 应用自己的布局
 *   服务（`ctx.layout.toggleSidebar()`）执行切换 —— 不依赖 DOM 结构与界面文案；
 * - iframe → 宿主：观察 AppFrame 的 `data-sidebar-collapsed`，变化即回报
 *   `dsh://sidebar:collapsed`，供宿主导航栏同步折叠图标。
 *
 * 协议字面量与宿主侧 `src/layout/components/webview.tsx` 逐字一致（只有本文件消费，
 * 按常量归属规则留在消费方）。
 */
import type { ClientContext, ParentMessage } from '../types'
import { invokeParent } from '../service/invoke-parent'
import { listenParent } from '../service/listen-parent'
import { reportPluginError } from '../utils/error'
import { defineRegister } from './index'

/** 宿主 → iframe：侧边栏切换命令。 */
const CMD_TOGGLE = 'dsh://sidebar:toggle'

/** iframe → 宿主：折叠状态回报（宿主导航栏据此同步折叠图标）。 */
const EVENT_SIDEBAR_COLLAPSED = 'dsh://sidebar:collapsed'

/** dsh 应用布局根（AppFrame）：`data-shell-overlay` 的父节点，带侧边栏折叠属性。 */
const SIDEBAR_FRAME_SELECTOR = '[data-shell-overlay]'
const SIDEBAR_COLLAPSED_ATTRIBUTE = 'data-sidebar-collapsed'
const MOBILE_SIDEBAR_ATTRIBUTE = 'data-dsh-mobile-sidebar'

function isMobileSidebarOwned(): boolean {
  return document.documentElement.hasAttribute(MOBILE_SIDEBAR_ATTRIBUTE)
}

/** 应用晚挂载时补报一次折叠状态的轮询参数（拿到 AppFrame 即停，有界）。 */
const SIDEBAR_TRACK_MAX_TRIES = 30
const SIDEBAR_TRACK_INTERVAL_MS = 500

/** AppFrame：dsh 应用布局的根。 */
function findFrame(): HTMLElement | null {
  if (typeof document === 'undefined')
    return null
  const overlay = document.querySelector<HTMLElement>(SIDEBAR_FRAME_SELECTOR)
  return overlay?.parentElement ?? null
}

/** 折叠状态回报（幂等：宿主只把它写进自己的状态）。 */
function reportCollapsed(): void {
  if (isMobileSidebarOwned())
    return
  invokeParent({
    type: EVENT_SIDEBAR_COLLAPSED,
    collapsed: findFrame()?.hasAttribute(SIDEBAR_COLLAPSED_ATTRIBUTE) === true,
  })
}

export const sidebarFeature = defineRegister<ClientContext>((controller, ctx) => {
  // 宿主命令 → dsh 布局服务；布局服务抛错只上报，不影响后续命令。
  controller.add(listenParent<ParentMessage>((data) => {
    if (data.type !== CMD_TOGGLE || isMobileSidebarOwned())
      return
    try {
      ctx.layout.toggleSidebar()
    }
    catch (error) {
      reportPluginError(error)
    }
  }, [CMD_TOGGLE]))

  // 属性翻转即回报（AppFrame 出现后的每次变化都会命中）。
  controller.observe(document.documentElement, reportCollapsed, {
    attributes: true,
    attributeFilter: [SIDEBAR_COLLAPSED_ATTRIBUTE, MOBILE_SIDEBAR_ATTRIBUTE],
    subtree: true,
  })

  // 首次回报：应用早于插件挂载时属性不会产生变化事件；应用晚挂载则轮询到
  // AppFrame 出现为止（有界，拿到即停）。
  reportCollapsed()
  let tries = 0
  const stopPoll = controller.interval(() => {
    if (findFrame() !== null) {
      reportCollapsed()
      stopPoll()
      return
    }
    if (++tries > SIDEBAR_TRACK_MAX_TRIES)
      stopPoll()
  }, SIDEBAR_TRACK_INTERVAL_MS)
})
