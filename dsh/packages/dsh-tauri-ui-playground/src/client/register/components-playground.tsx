import type { ClientContext } from 'dsh-tauri/client'
import { Icon, Panel, Puzzle } from 'dsh-tauri-ui/client'
import { definePanel, defineRegister, invoke } from 'dsh-tauri/client'
import { UI_COMPONENTS_PANEL_ID, UI_COMPONENTS_PANEL_ORDER } from '../constants'
import { locale } from '../locales'
import { UiComponentsPanel } from '../ui/components-playground/ui-components'

/** 仅 dev 构建挂载：插件侧没有可用的构建期开关，只能向宿主问 `is_dev_build`。 */
export const registerUiComponentsPanel = defineRegister<ClientContext>((controller, ctx) => {
  // 同一 profile 也服务普通浏览器标签：只有桌面 iframe 有宿主命令可问。
  if (typeof window === 'undefined' || window.parent === window)
    return

  invoke<boolean>('is_dev_build')
    .then((dev) => {
      if (!dev)
        return
      const panel = definePanel(ctx, {
        id: UI_COMPONENTS_PANEL_ID,
        order: UI_COMPONENTS_PANEL_ORDER,
        label: () => locale.text('uiComponents'),
        icon: props => <Icon as={Puzzle} size={props.size} />,
        render: () => <Panel><UiComponentsPanel /></Panel>,
      })
      controller.add(panel.dispose)
    })
    .catch((error: unknown) => {
      console.warn('[dsh-tauri-ui-playground] is_dev_build unavailable; UI components panel stays hidden', error)
    })
})
