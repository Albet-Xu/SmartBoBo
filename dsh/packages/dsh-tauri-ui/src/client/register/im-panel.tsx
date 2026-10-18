import type { ClientContext } from 'dsh-tauri/client'
import { definePanel, defineRegister } from 'dsh-tauri/client'
import { Icon } from '../components/icon'
import { Comments } from '../components/icons'
import { Panel } from '../components/panel'
import { DSH_IM_CLIENT_SERVICE } from '../constants'
import { locale } from '../locales'
import { readDshImClient } from '../service/dsh-im'

/** 带插件前缀：dsh-im 源码仓库另有一个手动安装的同名接入（id `dsh-im`），同 id 会撞槽位。 */
const IM_PANEL_ID = 'dsh-tauri-ui-im'
/** 排在定时任务（30）之后。 */
const IM_PANEL_ORDER = 40

export const registerImPanel = defineRegister<ClientContext>((_controller, ctx) => {
  // 同一 profile 也服务普通浏览器标签：只有桌面 iframe 接管，浏览器保留设置页入口。
  if (typeof window === 'undefined' || window.parent === window)
    return

  // 服务由 dsh-im 客户端插件发布，apply 顺序不保证，旧版 dsh-im 也没有它：
  // inject 只在服务到位时激活本接入，缺席时不注册面板、不动设置页。
  // 交由返回的 disposer（而非 effect）回收：服务被撤下时同样要恢复设置页入口。
  ctx.inject([DSH_IM_CLIENT_SERVICE], () => {
    const im = readDshImClient(ctx)
    if (im === undefined)
      return

    const panel = definePanel(ctx, {
      id: IM_PANEL_ID,
      order: IM_PANEL_ORDER,
      label: () => locale.text('im'),
      icon: props => <Icon as={Comments} size={props.size} />,
      render: () => <Panel>{im.render()}</Panel>,
    })
    // 撤下重复入口前记住原状态：退出时恢复到「我们发现它时」的样子。
    const restoreSettings = im.settingsVisible()
    im.setSettingsVisible(false)

    return () => {
      im.setSettingsVisible(restoreSettings)
      panel.dispose()
    }
  })
})
