import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId, SessionListState } from 'dsh-tauri/client'
import type { ReactElement } from 'react'
import type { SelectorHook } from '../types/selector'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { SlotOutlet } from '@deepseek-ai/dsh-client-ui-renderer'
import { cn, uniq, useStore } from 'dsh-tauri/client'
import { useCallback, useState } from 'react'
import { Gear } from '../components/icons'
import {
  SETTINGS_LAUNCHER_SLOT,
  SETTINGS_ONBOARDING_SLOT,
  SETTINGS_TRIGGER_SLOT,
} from '../constants'
import { locale } from '../locales'
import { store } from '../store'

interface RetainedSessionLike {
  retainedBy?: Readonly<Record<string, number | undefined>>
}

/**
 * `useSessions` 快照的读取面：0.1.7 起核心不再把选中态放进列表快照（改由 `uiSession` 持有），
 * 适配层会把 `current` 投影补回，因此按可选成员声明。
 *
 * `byId` 放宽为裸字符串索引：核心按 branded `SessionId` 建索引，而 `current` 经投影回落后
 * 是裸字符串，二者在读取处需能互相寻址。
 */
export type SessionListStateLike = Omit<SessionListState, 'byId'> & {
  current?: string
  byId: Record<string, SessionListState['byId'][SessionId]>
}

export interface SettingsTriggerProps {
  wide: boolean
  useSessions: SelectorHook<SessionListStateLike>
  useWorkspaces?: unknown
}

// 0.1.7 起列表快照不再带 current，「当前会话」改由主视图持有的 reference 表达。
function isMainViewRetained(session: RetainedSessionLike): boolean {
  return (session.retainedBy?.mainView ?? 0) > 0
}

export function SettingsTrigger({ wide, useSessions }: SettingsTriggerProps): ReactElement {
  const { open, launcherAvailable, launcherShortcut } = useStore(store.settings)
  const { onboarding } = useStore(store.sections)
  const [completed, setCompleted] = useState<string[]>([])

  const onboardingActive = useSessions((state) => {
    if (state.phase !== 'ready')
      return false
    if (state.current !== undefined)
      return state.byId[state.current]?.blank === true
    const main = Object.values(state.byId).find(session => isMainViewRetained(session))
    return main === undefined || main.blank === true
  })

  if (!onboardingActive && completed.length > 0)
    setCompleted([])

  const step = onboardingActive ? onboarding.find(s => !completed.includes(s.id)) : undefined

  const completeStep = useCallback((id: string) => {
    setCompleted(previous => uniq([...previous, id]))
  }, [])

  const openSection = useCallback((id: string) => {
    store.settings.openAt(id)
  }, [])

  const [menuOpen, setMenuOpen] = useState(false)
  locale.useLocale()
  // 官方账号菜单占据设置座位时它就是「设置菜单」；座位缺席（更老核心 / 浏览器直开）时
  // 由壳层自己给菜单——两者条目结构一致，宠物等插件按「含『设置』条目」补条目。
  const menuItems: MenuEntry[] = [
    { id: 'settings', label: locale.text('settings'), icon: <Gear width={16} height={16} /> },
  ]

  const trigger = (
    <button
      type="button"
      aria-haspopup={launcherAvailable ? 'dialog' : 'menu'}
      // 触发器同时是「设置菜单」和「设置侧栏」的入口：菜单开着或侧栏开着都算展开，
      // 这样桌面载体（官方账号菜单直接开侧栏）与浏览器态（先开菜单再选设置）语义一致。
      aria-expanded={open || menuOpen}
      onClick={() => {
        if (launcherAvailable) {
          store.settings.openAt()
          return
        }
        setMenuOpen(value => !value)
      }}
      data-settings-trigger="dsh-tauri-ui"
      className={cn(
        'box-border flex flex-none items-center gap-[8px] w-[calc(100%+4px)] h-[42px] my-[4px] -mx-[2px] pr-[10px] pl-[8px] border-none rounded-[12px] bg-transparent [font-family:inherit] text-[14px] leading-[22px] text-primary overflow-hidden cursor-pointer hover:bg-hover',
        !wide && 'justify-center gap-0 w-[36px] h-[36px] mt-[8px] mb-[10px] mx-0 p-0 rounded-full',
      )}
    >
      <SlotOutlet slotKey={SETTINGS_TRIGGER_SLOT} ownerProps={{ wide }} />
    </button>
  )

  return (
    <>
      {launcherAvailable
        ? (
            <SlotOutlet
              slotKey={SETTINGS_LAUNCHER_SLOT}
              ownerProps={{
                wide,
                // 0.1.7-rc.2 起官方账号菜单把「设置面板刚打开」当作一次刷新时机。
                settingsOpen: open,
                // 同一代官方座位用 `settingsShortcut` 渲染「Ctrl+,」提示（老核心不传）。
                ...launcherShortcut === undefined ? {} : { settingsShortcut: launcherShortcut },
                openSettings: () => store.settings.openAt(),
                openOnboarding: (id: string) => store.settings.openAt(id),
              }}
              opts={{ fallback: trigger }}
            />
          )
        : (
            <Menu
              open={menuOpen}
              side="top"
              align="start"
              portal
              autoFocus
              // 官方 primitives 的 Menu anchor 包裹层（`.root`）是收缩盒，且其样式不在 layer 里；
              // 我们的工具类在 `@layer utilities`，不加 `!` 压不过它，触发器就不再占满整行。
              className="block! w-full!"
              items={menuItems}
              anchor={trigger}
              onSelect={(id: string) => {
                setMenuOpen(false)
                if (id === 'settings')
                  store.settings.openAt()
              }}
              onClose={() => setMenuOpen(false)}
            />
          )}
      {step !== undefined && (
        <SlotOutlet
          slotKey={SETTINGS_ONBOARDING_SLOT}
          ownerProps={{
            stepId: step.id,
            complete: () => completeStep(step.id),
            openSection,
          }}
          opts={{ only: step.id }}
        />
      )}
    </>
  )
}
