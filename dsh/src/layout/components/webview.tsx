import type { DshShortcutRow, DshViewCommand } from '@/hooks/use-dsh-shortcuts'
import { useWatch } from '@reause/core'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { type } from '@tauri-apps/plugin-os'
import { useRef, useState } from 'react'
import { If } from 'react-if-lite'
import { useStore } from 'valtio-define'
import { useAppearance } from '@/hooks/use-appearance'
import { DSH_VIEW_COMMANDS, shortcutHint, useDshShortcuts } from '@/hooks/use-dsh-shortcuts'
import { useDshStyle } from '@/hooks/use-dsh-style'
import { useIframeMessage } from '@/hooks/use-iframe-message'
import { useIframePost } from '@/hooks/use-iframe-post'
import { useListen } from '@/hooks/use-listen'
import { store } from '@/store'
import { Recovery } from '@/ui/plugin/recovery'
import { Iframe } from './iframe'
import { Navbar } from './navbar'
import { Setup } from './setup'
import { PreinstallSetup } from './setup-preinstall'

interface NavBridgeMessage {
  type?: string
  collapsed?: boolean
  rows?: unknown
}

export function Webview() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const appearanceCss = useAppearance(iframeRef)
  const post = useIframePost(iframeRef)

  const [dshStyle] = useDshStyle()
  const [{ rows: shortcutRows }, setDshShortcuts] = useDshShortcuts()

  const { status, serviceHealthy } = useStore(store.harness)
  const { recovery } = useStore(store.recovery)
  const [remoteView, setRemoteView] = useState({ url: '', tint: null as string | null })
  const { url: activeTunnelUrl, tint: borderTint } = remoteView
  const remoteMode = activeTunnelUrl !== ''
  const live = status === 'ready' && (remoteMode || serviceHealthy)

  function syncViewMenu() {
    if (type() !== 'macos')
      return
    void invoke('sync_view_menu', {
      entries: DSH_VIEW_COMMANDS.map(item => ({
        id: item.action,
        enabled: live && shortcutRows.some(row => row.id === item.command && row.available === true),
        shortcut: shortcutHint(shortcutRows, item.command) ?? null,
      })),
    }).catch(error => console.error('[Webview] failed to sync View menu:', error))
  }

  useWatch([shortcutRows, live], syncViewMenu, { immediate: true })
  useWatch(activeTunnelUrl, () => setDshShortcuts({ rows: [] }))
  useWatch(live, (ready) => {
    if (!ready)
      setDshShortcuts({ rows: [] })
  })
  useListen('tauri://focus', syncViewMenu, { target: getCurrentWindow().label })
  useListen('macos-menu-rebuilt', syncViewMenu, { target: getCurrentWindow().label })

  function handleRemoteChange(url: string, tint: string | null) {
    setRemoteView({ url, tint })
  }

  useIframeMessage<NavBridgeMessage>(iframeRef, (data) => {
    if (data.type === 'dsh://sidebar:collapsed') {
      setSidebarCollapsed(Boolean(data.collapsed))
    }
    else if (data.type === 'dsh://shortcuts') {
      setDshShortcuts({ rows: parseShortcutRows(data.rows) })
    }
  })

  const renderContent = () => {
    switch (status) {
      case 'error':
        return (
          <If cond={recovery.required} else={<Setup />}>
            <Recovery fullScreen />
          </If>
        )
      case 'preinstall':
        return <PreinstallSetup />
      case 'ready':
        return (
          <Iframe
            iframeRef={iframeRef}
            srcOverride={remoteMode ? activeTunnelUrl : null}
            borderTint={borderTint}
          />
        )
      default:
        return <Setup />
    }
  }

  const bridge = live
    ? {
        onToggleSidebar: () => post({ type: 'dsh://sidebar:toggle' }),
        onNewChat: () => post({ type: 'dsh://session:new' }),
        onOpenFolder: () => post({ type: 'dsh://workspace:add' }),
        onOpenShortcuts: () => post({ type: 'dsh://shortcuts:open' }),
        onViewCommand: (command: DshViewCommand) => post({ type: 'dsh://view:command', command }),
      }
    : {}

  return (
    <main className="relative flex flex-col min-h-0 flex-1" style={dshStyle.frame || {}}>
      {/* 挂在 Iframe 外：启动页/预装引导/恢复页先于 Iframe 渲染，否则拿不到透明与调色板 token */}
      <style>{appearanceCss}</style>
      <Navbar onRemoteChange={handleRemoteChange} sidebarCollapsed={sidebarCollapsed} {...bridge} />
      <div className="flex min-h-0 flex-1">
        {renderContent()}
      </div>
    </main>
  )
}

function parseShortcutRows(rows: unknown): DshShortcutRow[] {
  if (!Array.isArray(rows))
    return []
  const out: DshShortcutRow[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null)
      continue
    const entry = row as { id?: unknown, label?: unknown, keys?: unknown, aria?: unknown, available?: unknown }
    if (typeof entry.id !== 'string' || typeof entry.label !== 'string')
      continue
    out.push({
      id: entry.id,
      label: entry.label,
      keys: Array.isArray(entry.keys) ? entry.keys.filter((key): key is string => typeof key === 'string') : [],
      ...typeof entry.aria === 'string' ? { aria: entry.aria } : {},
      available: entry.available === true,
    })
  }
  return out
}
