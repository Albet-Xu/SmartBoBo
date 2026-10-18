/**
 * client/apply.ts — dsh-tauri 客户端插件体（browser half）：纯消息桥 + 侧边栏视觉微调。
 *
 * 本插件是壳层宿主 → iframe 四条协议的唯一接收方，宿主侧的发送方分别是：
 * - `src/layout/components/webview.tsx`：`dsh://sidebar:toggle`、`dsh://session:new`、
 *   `dsh://workspace:add`；
 * - `src/layout/components/iframe.tsx`：`dsh://zoom-shortcut`（iframe 内捕获后回报），
 *   以及插件错误上报 `dsh://plugin-error` 的落库端。
 *
 * 这些原先由桌面端注入的 `NAV_SHIM_JS` / `ZOOM_SHORTCUT_BRIDGE_JS` 承担，现在统一
 * 收敛到插件客户端；插件缺席时宿主控件只会空转，没有任何降级路径。
 */
import type { ClientContext } from './types'
import { accountSignInFeature } from './register/account'
import { registerAppearance } from './register/appearance'
import { navigationFeature } from './register/navigation'
import { shortcutsFeature } from './register/shortcuts'
import { sidebarFeature } from './register/sidebar'
import { sidebarTweaksFeature } from './register/sidebar-tweaks'
import { registerStyle } from './register/style'
import { zoomShortcutFeature } from './register/zoom-shortcut'

/** effect 标签（只有本文件消费，按常量归属规则留在消费方）。 */
const SIDEBAR_TOGGLE_EFFECT = 'dsh-tauri: sidebar (toggle command + collapsed report)'
const NAVIGATION_EFFECT = 'dsh-tauri: navigation (new session, add workspace)'
const ZOOM_SHORTCUT_EFFECT = 'dsh-tauri: zoom shortcuts (ctrl/cmd +/-/0)'
const SIDEBAR_TWEAKS_EFFECT = 'dsh-tauri: sidebar tweaks (hide collapse toggle, center brand)'
const STYLE_EFFECT = 'dsh-tauri: style (sidebar background)'
const ACCOUNT_SIGN_IN_EFFECT = 'dsh-tauri: account sign-in (auto-open the authorize url)'
const APPEARANCE_EFFECT = 'dsh-tauri: appearance'
const SHORTCUTS_EFFECT = 'dsh-tauri: shortcuts (catalog report + edit commands)'
/** 插件体：注册侧边栏桥、导航命令、缩放快捷键、账号登录接管与侧边栏 UI 微调。 */
export function apply(ctx: ClientContext): void {
  // issue #573：独立浏览器没有桌面宿主，保留原生侧栏控件与缩放快捷键。
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.parent === window)
    return

  ctx.effect(registerAppearance, APPEARANCE_EFFECT)
  ctx.effect(registerStyle, STYLE_EFFECT)
  ctx.effect(sidebarFeature, SIDEBAR_TOGGLE_EFFECT)
  ctx.effect(navigationFeature, NAVIGATION_EFFECT)
  ctx.effect(zoomShortcutFeature, ZOOM_SHORTCUT_EFFECT)
  ctx.effect(sidebarTweaksFeature, SIDEBAR_TWEAKS_EFFECT)
  ctx.effect(accountSignInFeature, ACCOUNT_SIGN_IN_EFFECT)
  ctx.effect(shortcutsFeature, SHORTCUTS_EFFECT)
}
