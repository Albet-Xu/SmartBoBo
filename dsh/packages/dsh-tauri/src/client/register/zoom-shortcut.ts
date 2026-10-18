/**
 * register/zoom-shortcut.ts — iframe 内的缩放快捷键（Ctrl/Cmd + `+` / `-` / `0`）。
 *
 * 跨源 iframe 里的按键不会冒泡到桌面壳层，因此由本注册在 iframe 内以捕获阶段监听，
 * 命中后 `preventDefault` 并经父窗口桥上报动作；宿主（`src/layout/components/iframe.tsx`
 * 的 `dsh://zoom-shortcut` 分支）把它写进 `store.setting.zoom_factor` 真值，再由
 * `useZoomFactor` 应用到 WebView。
 *
 * 壳层自身获得焦点时的快捷键由宿主自己的监听处理，两端口径一致（见 `utils/zoom.ts`）。
 */
import { invokeParent } from '../service/invoke-parent'
import { zoomActionFromShortcut } from '../utils/zoom'
import { defineRegister } from './index'

/** iframe → 宿主：缩放快捷键动作（宿主写缩放真值）。 */
const TYPE_ZOOM_SHORTCUT = 'dsh://zoom-shortcut'

export const zoomShortcutFeature = defineRegister((controller) => {
  controller.listen('keydown', (event) => {
    const action = zoomActionFromShortcut(event)
    if (action === null)
      return
    event.preventDefault()
    invokeParent({ type: TYPE_ZOOM_SHORTCUT, action })
  }, { capture: true })
})
