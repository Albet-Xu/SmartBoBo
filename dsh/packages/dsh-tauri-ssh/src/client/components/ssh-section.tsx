import type { ReactNode } from 'react'
import type { SshKey } from '../locales/index'
import { Button, Globe, Icon, SegmentedControl } from 'dsh-tauri-ui/client'
import { cn, useListenParent, useStore } from 'dsh-tauri/client'
import { useEffect, useState } from 'react'
import { SETTINGS_OPEN_MESSAGE, SETTINGS_SECTION_ID, SSH_TAB_MACHINES, SSH_TAB_SYNC, SSH_TABS_ID } from '../constants/index'
import * as service from '../service/machines'
import { store } from '../store/index'
import { errorTextOf } from '../utils/error'
import { MachinesSection } from './machines-section'
import { SyncPanel } from './sync-panel'

type SshTab = typeof SSH_TAB_MACHINES | typeof SSH_TAB_SYNC

interface SshSectionProps {
  t: (key: SshKey) => string
}

const TAB_KEYS: Record<SshTab, SshKey> = {
  [SSH_TAB_MACHINES]: 'tabs.machines',
  [SSH_TAB_SYNC]: 'tabs.sync',
}

export function SshSection({ t }: SshSectionProps): ReactNode {
  const state = useStore(store.machines)
  const [tab, setTab] = useState<SshTab>(SSH_TAB_MACHINES)
  const [visited, setVisited] = useState<ReadonlySet<SshTab>>(() => new Set<SshTab>([SSH_TAB_MACHINES]))

  function openTab(next: SshTab): void {
    setTab(next)
    setVisited(previous => previous.has(next) ? previous : new Set<SshTab>([...previous, next]))
  }

  useEffect(() => {
    if (store.machines.enabled === null)
      void service.loadSettings()
  }, [])

  useListenParent(SETTINGS_OPEN_MESSAGE, (message) => {
    if (message.section !== SETTINGS_SECTION_ID)
      return
    if (message.tab === SSH_TAB_MACHINES || message.tab === SSH_TAB_SYNC)
      openTab(message.tab)
  })

  if (state.enabled === null) {
    return (
      <div className="flex flex-col gap-[12px] max-w-[960px] text-primary" data-testid="ssh-section">
        <p className="m-0 text-[12px] leading-[18px] text-tertiary">{t('loading')}</p>
      </div>
    )
  }

  if (state.enabled === false) {
    return (
      <div className="flex flex-col gap-[12px] max-w-[960px] text-primary" data-testid="ssh-section">
        <div className="mt-[4px] flex flex-col items-center gap-[12px] rounded-[12px] border-[0.5px] border-border-l2 bg-layer-1 px-[24px] py-[40px] text-center" data-testid="ssh-hero">
          <span className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-full bg-[var(--dsw-alias-surface-tinted)] text-brand" aria-hidden="true">
            <Icon as={Globe} size={22} />
          </span>
          <h2 className="m-0 text-[22px] leading-[32px] font-semibold text-primary">{t('hero.title')}</h2>
          <p className="m-0 max-w-[460px] text-[13px] leading-[21px] text-secondary">{t('hero.desc')}</p>
          {state.error !== null
            ? <p className="m-0 text-[12px] leading-[18px] text-error" role="alert" data-testid="ssh-hero-error">{errorTextOf(state.error, t)}</p>
            : null}
          <Button
            variant="primary"
            size="sm"
            disabled={state.enabling}
            data-testid="ssh-enable"
            onClick={() => void service.setEnabled(true)}
          >
            {state.enabling ? t('hero.enabling') : t('hero.enable')}
          </Button>
        </div>
      </div>
    )
  }

  const tabs: SshTab[] = [SSH_TAB_MACHINES, SSH_TAB_SYNC]

  return (
    <div className="flex flex-col gap-[12px] max-w-[960px] text-primary" data-testid="ssh-section">
      <div className="flex flex-wrap justify-between items-center gap-[8px]" data-testid="ssh-tabs">
        <SegmentedControl
          id={SSH_TABS_ID}
          label={t('nav')}
          value={tab}
          options={tabs.map(value => ({ value, label: t(TAB_KEYS[value]) }))}
          onChange={(next) => {
            if (next === SSH_TAB_MACHINES || next === SSH_TAB_SYNC)
              openTab(next)
          }}
        />
        <Button variant="ghost" size="sm" disabled={state.enabling} onClick={() => void service.setEnabled(false)}>
          {t('disable')}
        </Button>
      </div>
      {tabs.filter(value => value === tab || visited.has(value)).map((value) => {
        const selected = value === tab
        return (
          <div
            key={value}
            id={`${SSH_TABS_ID}-${value}-panel`}
            className={cn('min-w-0 flex-col gap-[12px]', selected ? 'flex' : 'hidden')}
            role="tabpanel"
            aria-labelledby={`${SSH_TABS_ID}-${value}`}
            hidden={!selected}
          >
            {value === SSH_TAB_MACHINES
              ? <MachinesSection t={t} />
              : <SyncPanel t={t} />}
          </div>
        )
      })}
    </div>
  )
}
