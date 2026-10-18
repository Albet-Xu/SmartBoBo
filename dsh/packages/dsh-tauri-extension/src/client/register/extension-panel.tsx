import type { ClientContext, PanelHandle, SlotRegistry } from 'dsh-tauri/client'
import type { ReactElement } from 'react'
import { cssr, Icon, IconSparkleRegular, mountStyle, Panel, Puzzle, SlotOutlet } from 'dsh-tauri-ui/client'
import { definePanel, defineRegister, hidePanel } from 'dsh-tauri/client'
import { useSyncExternalStore } from 'react'
import { ExtensionPanel } from '../components/extension-panel'
import { MARKET_SERVICE_NAME, PANEL_ACTION_ORDER, PANEL_ID } from '../constants'
import { locale } from '../locales'
import { currentScope, hostsMarketPanel, readMarket } from '../service/market'
import { store } from '../store'
import { chooseWorkspace, sessionSnapshotOf, workspaceSnapshotOf } from './extension-panel.utils'

const pluginsStyle = cssr.c([
  cssr.c('[data-dsh-extension-plugins]', { position: 'relative' }),
  cssr.c('[data-dsh-extension-plugins] > [data-dsh-plugins-icon]', { display: 'none', position: 'absolute', top: '5px', left: 0, width: '22px', height: '22px', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }),
  cssr.c('[data-dsh-extension-plugins]:has([data-plugin-panel] > header[data-window-drag]) > [data-dsh-plugins-icon]', { display: 'inline-flex' }),
  cssr.c('[data-dsh-extension-plugins] [data-plugin-panel]', { height: 'auto', padding: 0, overflow: 'visible', gap: '14px' }),
  cssr.c('[data-dsh-extension-plugins] [data-plugin-panel] > header[data-window-drag]', { paddingTop: 0, flexWrap: 'wrap', alignItems: 'center', gap: '14px 10px' }),
  cssr.c('[data-dsh-extension-plugins] [data-plugin-panel] > header > div:first-child', { display: 'contents' }),
  cssr.c('[data-dsh-extension-plugins] [data-plugin-panel] > header h1', { margin: 0, paddingLeft: '32px', fontSize: '16px', lineHeight: '24px', fontWeight: 500 }),
  cssr.c('[data-dsh-extension-plugins] [data-plugin-panel] > header > div:first-child > div', { order: 2, width: '100%', margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }),
  cssr.c('[data-dsh-extension-plugins] [data-plugin-panel] > header > div:last-child', { marginLeft: 'auto' }),
  cssr.c('[data-dsh-extension-plugins] [data-plugin-panel] div[data-window-drag]', { paddingTop: '12px' }),
])

export const extensionPanelFeature = defineRegister<ClientContext>((controller, ctx, adapter) => {
  let panel: PanelHandle | undefined
  const embedMarket = hostsMarketPanel(currentScope())
  const slots = adapter.service<SlotRegistry>('slots')
  let restorePlugins: (() => void) | undefined

  function hasPlugins(): boolean {
    return typeof SlotOutlet === 'function'
      && typeof slots?.subscribe === 'function'
      && typeof slots?.entriesOfSlot === 'function'
      && slots.entriesOfSlot('main').some(entry => entry.options.key === 'plugins')
  }

  function subscribePlugins(listener: () => void): () => void {
    if (typeof slots?.subscribe !== 'function')
      return () => {}
    return slots.subscribe('main', listener)
  }

  function syncPlugins(): void {
    if (hasPlugins()) {
      restorePlugins ??= hidePanel(ctx, 'plugins', PANEL_ID)
    }
    else {
      restorePlugins?.()
      restorePlugins = undefined
    }
  }

  controller.add(mountStyle(pluginsStyle, `${PANEL_ID}-plugins`, PANEL_ID))
  if (typeof slots?.subscribe === 'function')
    controller.add(subscribePlugins(syncPlugins))
  syncPlugins()
  controller.add(() => restorePlugins?.())

  ctx.inject([MARKET_SERVICE_NAME], () => {
    if (!embedMarket)
      return
    const face = readMarket(ctx)
    if (face === undefined)
      return
    const restore = face.settingsVisible()
    face.setSettingsVisible(false)
    return () => face.setSettingsVisible(restore)
  })

  async function createSkill(): Promise<void> {
    const id = chooseWorkspace(
      sessionSnapshotOf(adapter.sessions.list?.getSnapshot()),
      workspaceSnapshotOf(adapter.workspaces.list?.getSnapshot()),
    )
    if (id === undefined)
      throw new Error(locale.text('workspaceUnavailable'))
    const sessionId = await adapter.workspaces.connectWorkspace?.(id)
    if (typeof sessionId !== 'string' || sessionId === '')
      throw new Error(locale.text('workspaceUnavailable'))
    store.prefill.add(sessionId)
    panel?.close()
    adapter.sessions.open?.(sessionId)
  }

  panel = definePanel(ctx, {
    id: PANEL_ID,
    order: PANEL_ACTION_ORDER,
    locale: locale.NS,
    label: () => locale.text('extension'),
    icon: props => <Icon as={Puzzle} size={props.size} />,
    render: function ExtensionPage() {
      const available = useSyncExternalStore(subscribePlugins, hasPlugins, hasPlugins)
      let plugins: ReactElement | undefined
      if (available && typeof SlotOutlet === 'function') {
        plugins = (
          <div data-dsh-extension-plugins>
            <span data-dsh-plugins-icon aria-hidden="true"><IconSparkleRegular size={16} /></span>
            <SlotOutlet slotKey="main" opts={{ entryKey: 'plugins' }} />
          </div>
        )
      }
      return (
        <Panel>
          <ExtensionPanel plugins={plugins} createSkill={createSkill} market={embedMarket ? readMarket(ctx) : undefined} />
        </Panel>
      )
    },
  })
  controller.add(panel.dispose)
})
